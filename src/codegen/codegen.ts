// =============================================================================
// WASM Code Generator — compile(module) → CompileResult
// =============================================================================
// Transforms a validated Edict module AST into WASM bytecode via binaryen.
// Handles: Int/Float/Bool/String literals, binops, unops, calls, if/else,
// let bindings, blocks, and the `print` builtin.

import binaryen from "binaryen";
import type {
    EdictModule,
    FunctionDef,
    Expression,
    Pattern,
} from "../ast/nodes.js";
import type { TypeExpr } from "../ast/types.js";
import { StringTable } from "./string-table.js";
import { BUILTIN_FUNCTIONS } from "./builtins.js";

// =============================================================================
// Types
// =============================================================================

export interface CompileSuccess {
    ok: true;
    wasm: Uint8Array;
    wat: string; // WAT text for debugging
}

export interface CompileFailure {
    ok: false;
    errors: string[];
}

export type CompileResult = CompileSuccess | CompileFailure;

// =============================================================================
// Function signature registry (for cross-function call return types)
// =============================================================================

interface FunctionSig {
    returnType: binaryen.Type;
    paramTypes?: binaryen.Type[];
}

// =============================================================================
// Edict → WASM type mapping
// =============================================================================

function edictTypeToWasm(type: TypeExpr): binaryen.Type {
    if (type.kind === "basic") {
        switch (type.name) {
            case "Int":
                return binaryen.i32;
            case "Float":
                return binaryen.f64;
            case "Bool":
                return binaryen.i32;
            case "String":
                // Strings are (ptr, len) → we use i32 for the pointer.
                // The full string is represented as two i32s, but at the ABI
                // level we pass two separate i32 params. For return values
                // of builtin print, we return just the ptr (i32).
                return binaryen.i32;
        }
    }
    if (type.kind === "unit_type") {
        return binaryen.none;
    }
    // Fallback for anything else
    return binaryen.i32;
}

// =============================================================================
// Compile-time WASM type inference for expressions
// =============================================================================

/**
 * Infer the WASM type an expression will produce at runtime.
 * Used to dispatch i32 vs f64 instructions in binops, unops, and block types.
 */
function inferExprWasmType(
    expr: Expression,
    ctx: FunctionContext,
    fnSigs: Map<string, FunctionSig>,
): binaryen.Type {
    switch (expr.kind) {
        case "literal": {
            // If the literal has an explicit type annotation, use it
            if (expr.type) return edictTypeToWasm(expr.type);
            const val = expr.value;
            if (typeof val === "number" && !Number.isInteger(val)) return binaryen.f64;
            return binaryen.i32; // int, bool, string → i32
        }
        case "ident": {
            const local = ctx.getLocal(expr.name);
            if (local) return local.type;
            const globalType = ctx.constGlobals.get(expr.name);
            if (globalType) return globalType;
            return binaryen.i32;
        }
        case "binop": {
            // Comparison/logical ops always return i32 (boolean)
            const cmpOps = ["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"];
            if (cmpOps.includes(expr.op)) return binaryen.i32;
            // Arithmetic: infer from left operand
            return inferExprWasmType(expr.left, ctx, fnSigs);
        }
        case "unop":
            if (expr.op === "not") return binaryen.i32;
            return inferExprWasmType(expr.operand, ctx, fnSigs);
        case "call": {
            if (expr.fn.kind === "ident") {
                const sig = fnSigs.get(expr.fn.name);
                if (sig) return sig.returnType;
            }
            return binaryen.i32;
        }
        case "if":
            // Type of if is the type of the then branch's last expression
            if (expr.then.length > 0) {
                return inferExprWasmType(expr.then[expr.then.length - 1]!, ctx, fnSigs);
            }
            return binaryen.i32;
        case "let":
            return binaryen.none; // let is a statement (local.set), returns void
        case "block":
            if (expr.body.length > 0) {
                return inferExprWasmType(expr.body[expr.body.length - 1]!, ctx, fnSigs);
            }
            return binaryen.none;
        case "match":
            // Type of match is the type of the first arm's body
            if (expr.arms.length > 0 && expr.arms[0]!.body.length > 0) {
                const firstBody = expr.arms[0]!.body;
                return inferExprWasmType(firstBody[firstBody.length - 1]!, ctx, fnSigs);
            }
            return binaryen.i32;
        case "array":
        case "tuple_expr":
        case "enum_constructor":
        case "record_expr":
            return binaryen.i32; // heap pointer
        case "access": {
            let recordTypeName: string | undefined;
            if (expr.target.kind === "ident") {
                const local = ctx.getLocal(expr.target.name);
                if (local && local.edictTypeName) {
                    recordTypeName = local.edictTypeName;
                }
            } else if (expr.target.kind === "record_expr") {
                recordTypeName = expr.target.name;
            }
            if (recordTypeName) {
                const layout = ctx.recordLayouts.get(recordTypeName);
                if (layout) {
                    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
                    if (fieldLayout) return fieldLayout.wasmType;
                }
            }
            return binaryen.i32; // fallback
        }
        default:
            return binaryen.i32;
    }
}

// =============================================================================
// Compiler context (per-function)
// =============================================================================

interface LocalEntry {
    index: number;
    type: binaryen.Type;
    edictTypeName?: string;
}

export interface FieldLayout {
    name: string;
    offset: number;
    wasmType: binaryen.Type;
}

export interface RecordLayout {
    fields: FieldLayout[];
    totalSize: number;
}

class FunctionContext {
    private nextIndex: number;
    private locals = new Map<string, LocalEntry>();
    readonly varTypes: binaryen.Type[] = [];
    readonly constGlobals: Map<string, binaryen.Type>;
    readonly recordLayouts: Map<string, RecordLayout>;
    readonly enumLayouts: Map<string, EnumLayout>;

    constructor(
        params: { name: string; wasmType: binaryen.Type; edictTypeName?: string }[],
        constGlobals: Map<string, binaryen.Type> = new Map(),
        recordLayouts: Map<string, RecordLayout> = new Map(),
        enumLayouts: Map<string, EnumLayout> = new Map(),
    ) {
        this.nextIndex = 0;
        this.constGlobals = constGlobals;
        this.recordLayouts = recordLayouts;
        this.enumLayouts = enumLayouts;
        for (const p of params) {
            this.locals.set(p.name, { index: this.nextIndex, type: p.wasmType, edictTypeName: p.edictTypeName });
            this.nextIndex++;
        }
    }

    getLocal(name: string): LocalEntry | undefined {
        return this.locals.get(name);
    }

    addLocal(name: string, type: binaryen.Type, edictTypeName?: string): number {
        const index = this.nextIndex++;
        this.locals.set(name, { index, type, edictTypeName });
        this.varTypes.push(type);
        return index;
    }
}

// =============================================================================
// Compiler
// =============================================================================

export function compile(module: EdictModule): CompileResult {
    const mod = new binaryen.Module();
    const strings = new StringTable();
    const errors: string[] = [];

    try {
        // Pre-scan: intern all string literals
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                collectStrings(def.body, strings);
            }
            if (def.kind === "const") {
                collectStringExpr(def.value, strings);
            }
        }

        // Setup memory with string data segments
        const segments = strings.toMemorySegments(mod);
        const pages = Math.max(1, Math.ceil(strings.totalBytes / 65536));
        mod.setMemory(pages, 16, "memory", segments);

        // Build RecordLayout registry
        const recordLayouts = new Map<string, RecordLayout>();
        const enumLayouts = new Map<string, EnumLayout>();
        for (const def of module.definitions) {
            if (def.kind === "record") {
                const fields = def.fields.map((f, i) => ({
                    name: f.name,
                    offset: i * 8, // 8-byte slots for all fields
                    wasmType: edictTypeToWasm(f.type),
                }));
                recordLayouts.set(def.name, { fields, totalSize: def.fields.length * 8 });
            } else if (def.kind === "enum") {
                const variants = def.variants.map((v, tag) => {
                    const fields = v.fields.map((f, i) => ({
                        name: f.name,
                        offset: 8 + i * 8, // tag is at offset 0, fields start at 8
                        wasmType: edictTypeToWasm(f.type),
                    }));
                    return {
                        name: v.name,
                        tag,
                        fields,
                        totalSize: 8 + v.fields.length * 8 // tag + fields
                    };
                });
                enumLayouts.set(def.name, { variants });
            }
        }

        // Initialize bump allocator heap pointer
        // Ensure heap starts at an 8-byte aligned offset after the string table, min 8
        const heapStart = Math.max(8, Math.ceil(strings.totalBytes / 8) * 8);
        mod.addGlobal("__heap_ptr", binaryen.i32, true, mod.i32.const(heapStart));

        // Pre-scan: build function signature registry
        const fnSigs = new Map<string, FunctionSig>();
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                fnSigs.set(def.name, {
                    returnType: edictTypeToWasm(def.returnType),
                    paramTypes: def.params.map((p) => edictTypeToWasm(p.type)),
                });
            }
        }

        // Import builtins
        for (const [name, builtin] of BUILTIN_FUNCTIONS) {
            const [importModule, importBase] = builtin.wasmImport;
            // print(ptr: i32, len: i32) → i32
            mod.addFunctionImport(
                name,
                importModule,
                importBase,
                binaryen.createType([binaryen.i32, binaryen.i32]),
                binaryen.i32,
            );
        }

        // Import module-level imports as WASM host imports
        // Infer param/return types from call sites in the module's functions
        const importedNames = new Set<string>();
        for (const imp of module.imports) {
            for (const name of imp.names) {
                if (!BUILTIN_FUNCTIONS.has(name)) {
                    importedNames.add(name);
                }
            }
        }

        if (importedNames.size > 0) {
            // Scan function bodies for calls to imported names to infer types
            const importSigs = inferImportSignatures(module, importedNames);
            for (const [name, sig] of importSigs) {
                const imp = module.imports.find(i => i.names.includes(name));
                const importModule = imp ? imp.module : "host";
                mod.addFunctionImport(
                    name,
                    importModule,
                    name,
                    sig.paramTypes.length > 0
                        ? binaryen.createType(sig.paramTypes)
                        : binaryen.none,
                    sig.returnType,
                );
                fnSigs.set(name, { returnType: sig.returnType, paramTypes: sig.paramTypes });
            }
        }

        // Compile const definitions as WASM globals
        const constGlobals = new Map<string, binaryen.Type>();
        for (const def of module.definitions) {
            if (def.kind === "const") {
                const wasmType = edictTypeToWasm(def.type);
                // Create a temporary context for compiling the const init expression
                const tmpCtx = new FunctionContext([]);
                const initExpr = compileExpr(
                    def.value, mod, tmpCtx, strings, fnSigs, errors,
                );
                mod.addGlobal(def.name, wasmType, false, initExpr);
                constGlobals.set(def.name, wasmType);
            }
        }

        // Compile each function
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                compileFunction(def, mod, strings, fnSigs, constGlobals, recordLayouts, enumLayouts, errors);
            }
        }

        // Export the "main" function if it exists
        const mainDef = module.definitions.find(
            (d) => d.kind === "fn" && d.name === "main",
        );
        if (mainDef) {
            mod.addFunctionExport("main", "main");
        }

        // Memory is already exported via setMemory's exportName parameter

        // Validate
        if (!mod.validate()) {
            errors.push("binaryen validation failed");
            return { ok: false, errors };
        }

        // Optimize
        mod.optimize();

        const wat = mod.emitText();
        const wasm = mod.emitBinary();

        return { ok: true, wasm, wat };
    } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        return { ok: false, errors };
    } finally {
        mod.dispose();
    }
}

// =============================================================================
// Function compilation
// =============================================================================

function compileFunction(
    fn: FunctionDef,
    mod: binaryen.Module,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    constGlobals: Map<string, binaryen.Type>,
    recordLayouts: Map<string, RecordLayout>,
    enumLayouts: Map<string, EnumLayout>,
    errors: string[],
): void {
    const params = fn.params.map((p) => ({
        name: p.name,
        edictType: p.type,
        wasmType: edictTypeToWasm(p.type),
        edictTypeName: p.type.kind === "named" ? p.type.name : undefined,
    }));

    const ctx = new FunctionContext(
        params.map((p) => ({ name: p.name, wasmType: p.wasmType, edictTypeName: p.edictTypeName })),
        constGlobals,
        recordLayouts,
        enumLayouts,
    );

    const returnType = edictTypeToWasm(fn.returnType);
    const paramTypes = params.map((p) => p.wasmType);
    const paramType =
        paramTypes.length > 0
            ? binaryen.createType(paramTypes)
            : binaryen.none;

    // Compile body — wrap non-final expressions in drop() per WASM semantics
    const bodyExprs = fn.body.map((expr, i) => {
        const compiled = compileExpr(expr, mod, ctx, strings, fnSigs, errors);
        // Non-final expressions that produce values must be dropped
        if (i < fn.body.length - 1 && expr.kind !== "let") {
            return mod.drop(compiled);
        }
        return compiled;
    });

    let body: binaryen.ExpressionRef;
    if (bodyExprs.length === 0) {
        body = mod.nop();
    } else if (bodyExprs.length === 1) {
        body = bodyExprs[0]!;
    } else {
        body = mod.block(null, bodyExprs, returnType);
    }

    mod.addFunction(fn.name, paramType, returnType, ctx.varTypes, body);
}

// =============================================================================
// Expression compilation
// =============================================================================

function compileExpr(
    expr: Expression,
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    switch (expr.kind) {
        case "literal":
            return compileLiteral(expr, mod, strings);

        case "ident":
            return compileIdent(expr, mod, ctx);

        case "binop":
            return compileBinop(expr, mod, ctx, strings, fnSigs, errors);

        case "unop":
            return compileUnop(expr, mod, ctx, strings, fnSigs, errors);

        case "call":
            return compileCall(expr, mod, ctx, strings, fnSigs, errors);

        case "if":
            return compileIf(expr, mod, ctx, strings, fnSigs, errors);

        case "let":
            return compileLet(expr, mod, ctx, strings, fnSigs, errors);

        case "block":
            return compileBlock(expr, mod, ctx, strings, fnSigs, errors);

        case "match":
            return compileMatch(expr, mod, ctx, strings, fnSigs, errors);

        case "record_expr":
            return compileRecordExpr(expr, mod, ctx, strings, fnSigs, errors);

        case "tuple_expr":
            return compileTupleExpr(expr, mod, ctx, strings, fnSigs, errors);

        case "enum_constructor":
            return compileEnumConstructor(expr, mod, ctx, strings, fnSigs, errors);

        case "access":
            return compileAccess(expr, mod, ctx, strings, fnSigs, errors);

        case "array":
            return compileArrayExpr(expr as Expression & { kind: "array" }, mod, ctx, strings, fnSigs, errors);

        case "lambda":
            return compileLambdaExpr(expr as Expression & { kind: "lambda" }, mod, ctx, strings, fnSigs, errors);

        default:
            errors.push(`unsupported expression kind: ${expr.kind}`);
            return mod.unreachable();
    }
}

function compileLiteral(
    expr: Expression & { kind: "literal" },
    mod: binaryen.Module,
    strings: StringTable,
): binaryen.ExpressionRef {
    const val = expr.value;

    if (typeof val === "boolean") {
        return mod.i32.const(val ? 1 : 0);
    }
    if (typeof val === "number") {
        // Check type annotation first — 0.0 is integer in JS but Float in Edict
        if (expr.type && expr.type.kind === "basic" && expr.type.name === "Float") {
            return mod.f64.const(val);
        }
        if (Number.isInteger(val)) {
            return mod.i32.const(val);
        }
        return mod.f64.const(val);
    }
    if (typeof val === "string") {
        const interned = strings.intern(val);
        // Return the pointer (offset). The caller/callee will also need
        // the length — for builtin calls we handle this specially in compileCall.
        return mod.i32.const(interned.offset);
    }
    return mod.unreachable();
}

function compileIdent(
    expr: Expression & { kind: "ident" },
    mod: binaryen.Module,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const local = ctx.getLocal(expr.name);
    if (local) {
        return mod.local.get(local.index, local.type);
    }
    // Check module-level const globals
    const globalType = ctx.constGlobals.get(expr.name);
    if (globalType !== undefined) {
        return mod.global.get(expr.name, globalType);
    }
    // Could be a function reference — return unreachable for now
    return mod.unreachable();
}

function compileBinop(
    expr: Expression & { kind: "binop" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const left = compileExpr(expr.left, mod, ctx, strings, fnSigs, errors);
    const right = compileExpr(expr.right, mod, ctx, strings, fnSigs, errors);

    // Determine the WASM type from the left operand.
    // Type checker guarantees matching types for both operands.
    const opType = inferExprWasmType(expr.left, ctx, fnSigs);
    const isFloat = opType === binaryen.f64;

    switch (expr.op) {
        case "+":
            return isFloat ? mod.f64.add(left, right) : mod.i32.add(left, right);
        case "-":
            return isFloat ? mod.f64.sub(left, right) : mod.i32.sub(left, right);
        case "*":
            return isFloat ? mod.f64.mul(left, right) : mod.i32.mul(left, right);
        case "/":
            return isFloat ? mod.f64.div(left, right) : mod.i32.div_s(left, right);
        case "%":
            if (isFloat) {
                errors.push(`modulo (%) not supported for Float`);
                return mod.unreachable();
            }
            return mod.i32.rem_s(left, right);
        case "==":
            return isFloat ? mod.f64.eq(left, right) : mod.i32.eq(left, right);
        case "!=":
            return isFloat ? mod.f64.ne(left, right) : mod.i32.ne(left, right);
        case "<":
            return isFloat ? mod.f64.lt(left, right) : mod.i32.lt_s(left, right);
        case ">":
            return isFloat ? mod.f64.gt(left, right) : mod.i32.gt_s(left, right);
        case "<=":
            return isFloat ? mod.f64.le(left, right) : mod.i32.le_s(left, right);
        case ">=":
            return isFloat ? mod.f64.ge(left, right) : mod.i32.ge_s(left, right);
        case "and":
            return mod.i32.and(left, right);
        case "or":
            return mod.i32.or(left, right);
        case "implies":
            // A implies B ≡ (not A) or B
            return mod.i32.or(mod.i32.eqz(left), right);
        default:
            errors.push(`unsupported binop: ${expr.op}`);
            return mod.unreachable();
    }
}

function compileUnop(
    expr: Expression & { kind: "unop" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const operand = compileExpr(expr.operand, mod, ctx, strings, fnSigs, errors);
    const opType = inferExprWasmType(expr.operand, ctx, fnSigs);
    const isFloat = opType === binaryen.f64;

    switch (expr.op) {
        case "-":
            return isFloat
                ? mod.f64.neg(operand)
                : mod.i32.sub(mod.i32.const(0), operand);
        case "not":
            return mod.i32.eqz(operand);
        default:
            errors.push(`unsupported unop: ${expr.op}`);
            return mod.unreachable();
    }
}

function compileCall(
    expr: Expression & { kind: "call" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    // The fn expression should be an ident for direct calls
    if (expr.fn.kind !== "ident") {
        errors.push("indirect calls not yet supported");
        return mod.unreachable();
    }

    const fnName = expr.fn.name;
    const builtin = BUILTIN_FUNCTIONS.get(fnName);

    if (builtin && fnName === "print") {
        // Special handling: print takes a single Edict String argument.
        // At the WASM level, we need to pass (ptr, len).
        const arg = expr.args[0]!;

        if (arg.kind === "literal" && typeof arg.value === "string") {
            // String literal — we know ptr and len at compile time
            const interned = strings.intern(arg.value);
            return mod.call(
                "print",
                [mod.i32.const(interned.offset), mod.i32.const(interned.length)],
                binaryen.i32,
            );
        }

        // For non-literal string args (e.g. variable), we compile the
        // expression which gives us the ptr, but we need the length too.
        // For now, this is a limitation — we'd need a proper string ABI.
        // Fall through to generic call with just the ptr.
        const ptrExpr = compileExpr(arg, mod, ctx, strings, fnSigs, errors);
        // Pass ptr and 0 length as fallback (host can handle this)
        return mod.call(
            "print",
            [ptrExpr, mod.i32.const(0)],
            binaryen.i32,
        );
    }

    // Generic function call
    const args = expr.args.map((a, i) => {
        const compiled = compileExpr(a, mod, ctx, strings, fnSigs, errors);
        // Coerce i32→f64 if function expects f64 but arg infers to i32
        const sig = fnSigs.get(fnName);
        if (sig?.paramTypes && sig.paramTypes[i] === binaryen.f64) {
            const argType = inferExprWasmType(a, ctx, fnSigs);
            if (argType === binaryen.i32) {
                return mod.f64.convert_s.i32(compiled);
            }
        }
        return compiled;
    });
    // Look up signature for correct return type
    const sig = fnSigs.get(fnName);
    const returnType = sig ? sig.returnType : binaryen.i32;
    return mod.call(fnName, args, returnType);
}

function compileIf(
    expr: Expression & { kind: "if" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const cond = compileExpr(expr.condition, mod, ctx, strings, fnSigs, errors);

    // Infer the result type from the then-branch's last expression
    const resultType = expr.then.length > 0
        ? inferExprWasmType(expr.then[expr.then.length - 1]!, ctx, fnSigs)
        : binaryen.i32;

    const thenExprs = expr.then.map((e) =>
        compileExpr(e, mod, ctx, strings, fnSigs, errors),
    );
    const thenBody =
        thenExprs.length === 1
            ? thenExprs[0]!
            : mod.block(null, thenExprs, resultType);

    if (expr.else) {
        const elseExprs = expr.else.map((e) =>
            compileExpr(e, mod, ctx, strings, fnSigs, errors),
        );
        const elseBody =
            elseExprs.length === 1
                ? elseExprs[0]!
                : mod.block(null, elseExprs, resultType);
        return mod.if(cond, thenBody, elseBody);
    }

    return mod.if(cond, thenBody);
}

function compileLet(
    expr: Expression & { kind: "let" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const wasmType = expr.type
        ? edictTypeToWasm(expr.type)
        : inferExprWasmType(expr.value, ctx, fnSigs);

    let edictTypeName: string | undefined;
    if (expr.type && expr.type.kind === "named") {
        edictTypeName = expr.type.name;
    } else if (expr.value.kind === "record_expr") {
        edictTypeName = expr.value.name;
    } else if (expr.value.kind === "enum_constructor") {
        edictTypeName = expr.value.enumName;
    }

    const index = ctx.addLocal(expr.name, wasmType, edictTypeName);
    const value = compileExpr(expr.value, mod, ctx, strings, fnSigs, errors);
    return mod.local.set(index, value);
}

function compileBlock(
    expr: Expression & { kind: "block" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const bodyExprs = expr.body.map((e) =>
        compileExpr(e, mod, ctx, strings, fnSigs, errors),
    );
    if (bodyExprs.length === 0) return mod.nop();
    if (bodyExprs.length === 1) return bodyExprs[0]!;
    const blockType = inferExprWasmType(expr.body[expr.body.length - 1]!, ctx, fnSigs);
    return mod.block(null, bodyExprs, blockType);
}

function compileMatch(
    expr: Expression & { kind: "match" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    // Attempt to determine the Edict type name of the target for enum matching
    let targetEdictTypeName: string | undefined;
    if (expr.target.kind === "ident") {
        const local = ctx.getLocal(expr.target.name);
        targetEdictTypeName = local?.edictTypeName;
    } else if (expr.target.kind === "call") {
        // Can't easily infer return named type yet without a type env here,
        // but let's be pragmatic if it's annotated
    } else if (expr.target.type && expr.target.type.kind === "named") {
        targetEdictTypeName = expr.target.type.name;
    }

    // Infer the target and result types
    const targetType = inferExprWasmType(expr.target, ctx, fnSigs);
    const matchResultType = inferExprWasmType(expr as Expression, ctx, fnSigs);

    // Evaluate target once and store in a temporary local
    const targetExpr = compileExpr(expr.target, mod, ctx, strings, fnSigs, errors);
    const tmpIndex = ctx.addLocal(`__match_${expr.id}`, targetType);
    const setTarget = mod.local.set(tmpIndex, targetExpr);
    const getTarget = () => mod.local.get(tmpIndex, targetType);

    // Compile body of a match arm (list of expressions → single expression)
    function compileArmBody(body: Expression[]): binaryen.ExpressionRef {
        const compiled = body.map((e) =>
            compileExpr(e, mod, ctx, strings, fnSigs, errors),
        );
        if (compiled.length === 0) return mod.nop();
        if (compiled.length === 1) return compiled[0]!;
        const bodyType = body.length > 0
            ? inferExprWasmType(body[body.length - 1]!, ctx, fnSigs)
            : binaryen.i32;
        return mod.block(null, compiled, bodyType);
    }

    // Build condition for a pattern match against the target
    function compilePatternCondition(pattern: Pattern): binaryen.ExpressionRef | null {
        switch (pattern.kind) {
            case "literal_pattern": {
                const val = pattern.value;
                if (typeof val === "number" && Number.isInteger(val)) {
                    return mod.i32.eq(getTarget(), mod.i32.const(val));
                }
                if (typeof val === "boolean") {
                    return mod.i32.eq(getTarget(), mod.i32.const(val ? 1 : 0));
                }
                // String/float literal patterns — compare i32 representation
                if (typeof val === "number") {
                    // Float literal pattern — not yet supported in i32 mode
                    errors.push(`float literal patterns not yet supported in match`);
                    return null;
                }
                if (typeof val === "string") {
                    const interned = strings.intern(val);
                    return mod.i32.eq(getTarget(), mod.i32.const(interned.offset));
                }
                return null;
            }
            case "wildcard":
                return null; // always matches
            case "binding":
                return null; // always matches (binding is set up in compileArmWithBinding)
            case "constructor": {
                // Determine the tag value from the enum layout
                let tagValue = -1;

                if (targetEdictTypeName) {
                    const enumLayout = ctx.enumLayouts.get(targetEdictTypeName);
                    if (enumLayout) {
                        const variantLayout = enumLayout.variants.find(v => v.name === pattern.name);
                        if (variantLayout) {
                            tagValue = variantLayout.tag;
                        } else {
                            errors.push(`unknown variant ${pattern.name} for enum ${targetEdictTypeName}`);
                            return null;
                        }
                    } else {
                        errors.push(`unknown enum ${targetEdictTypeName}`);
                        return null;
                    }
                } else {
                    errors.push(`cannot infer enum type for match target ${expr.id}`);
                    return null;
                }

                if (tagValue === -1) return null;

                // Load tag at offset 0 from the heap pointer (target)
                const loadTag = mod.i32.load(0, 0, getTarget());
                return mod.i32.eq(loadTag, mod.i32.const(tagValue));
            }
        }
    }

    // Pre-register binding locals so they're available during body compilation.
    // We must do this before compiling arm bodies, otherwise ident lookups
    // for bound names will fail.
    const bindingLocals = new Map<number, number>(); // arm index → local index
    const constructorFieldBindings = new Map<number, { localIndex: number, offset: number, wasmType: binaryen.Type }[]>();

    for (let i = 0; i < expr.arms.length; i++) {
        const pattern = expr.arms[i]!.pattern;
        if (pattern.kind === "binding") {
            const bindIndex = ctx.addLocal(pattern.name, targetType);
            bindingLocals.set(i, bindIndex);
        } else if (pattern.kind === "constructor") {
            if (targetEdictTypeName) {
                const enumLayout = ctx.enumLayouts.get(targetEdictTypeName);
                if (enumLayout) {
                    const variantLayout = enumLayout.variants.find(v => v.name === pattern.name);
                    if (variantLayout) {
                        const fieldBindings: { localIndex: number, offset: number, wasmType: binaryen.Type }[] = [];
                        for (let j = 0; j < pattern.fields.length; j++) {
                            const subPattern = pattern.fields[j]!;
                            if (subPattern.kind === "binding") {
                                const fieldLayout = variantLayout.fields[j];
                                if (fieldLayout) {
                                    const bindIndex = ctx.addLocal(subPattern.name, fieldLayout.wasmType);
                                    fieldBindings.push({
                                        localIndex: bindIndex,
                                        offset: fieldLayout.offset,
                                        wasmType: fieldLayout.wasmType
                                    });
                                }
                            } else if (subPattern.kind !== "wildcard") {
                                errors.push(`nested patterns inside constructor patterns not yet supported`);
                            }
                        }
                        constructorFieldBindings.set(i, fieldBindings);
                    }
                }
            }
        }
    }

    // Build nested if/else chain from arms (right to left)
    // Start from the last arm and work backwards
    let result: binaryen.ExpressionRef = mod.unreachable();

    for (let i = expr.arms.length - 1; i >= 0; i--) {
        const arm = expr.arms[i]!;
        const bodyExpr = compileArmBody(arm.body);

        // Wrap with binding set if this is a binding pattern
        let armExpr = bodyExpr;
        const bindIndex = bindingLocals.get(i);
        if (bindIndex !== undefined) {
            const setBinding = mod.local.set(bindIndex, getTarget());
            armExpr = mod.block(null, [setBinding, bodyExpr], matchResultType);
        } else if (arm.pattern.kind === "constructor") {
            const fieldBindings = constructorFieldBindings.get(i);
            if (fieldBindings && fieldBindings.length > 0) {
                const sets: binaryen.ExpressionRef[] = [];
                for (const binding of fieldBindings) {
                    const loadField = binding.wasmType === binaryen.f64
                        ? mod.f64.load(binding.offset, 0, getTarget())
                        : mod.i32.load(binding.offset, 0, getTarget());
                    sets.push(mod.local.set(binding.localIndex, loadField));
                }
                armExpr = mod.block(null, [...sets, bodyExpr], matchResultType);
            }
        }

        const condition = compilePatternCondition(arm.pattern);

        if (condition === null) {
            // Wildcard or binding — this arm always matches
            // It becomes the else (or the whole result if it's the only/last arm)
            result = armExpr;
        } else {
            // Conditional arm — if condition then this arm else previous result
            result = mod.if(condition, armExpr, result);
        }
    }

    // Wrap: set target, then evaluate the if/else chain
    return mod.block(null, [setTarget, result], matchResultType);
}

function compileRecordExpr(
    expr: Expression & { kind: "record_expr" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const layout = ctx.recordLayouts.get(expr.name);
    if (!layout) {
        errors.push(`unknown record type: ${expr.name}`);
        return mod.unreachable();
    }

    // Allocate heap space
    // ptr = __heap_ptr
    // __heap_ptr = ptr + layout.totalSize
    const ptrIndex = ctx.addLocal(`__record_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(layout.totalSize)
        )
    );

    // Evaluate and store each field
    const stores: binaryen.ExpressionRef[] = [];
    for (const fieldInit of expr.fields) {
        const fieldLayout = layout.fields.find((f) => f.name === fieldInit.name);
        if (!fieldLayout) {
            errors.push(`unknown field '${fieldInit.name}' on record '${expr.name}'`);
            continue;
        }

        const valueExpr = compileExpr(fieldInit.value, mod, ctx, strings, fnSigs, errors);

        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(
                mod.f64.store(
                    fieldLayout.offset,
                    0, // align
                    mod.local.get(ptrIndex, binaryen.i32),
                    valueExpr
                )
            );
        } else {
            stores.push(
                mod.i32.store(
                    fieldLayout.offset,
                    0, // align
                    mod.local.get(ptrIndex, binaryen.i32),
                    valueExpr
                )
            );
        }
    }

    // Return the pointer
    const returnPtr = mod.local.get(ptrIndex, binaryen.i32);

    return mod.block(null, [setPtr, incrementHeap, ...stores, returnPtr], binaryen.i32);
}

function compileTupleExpr(
    expr: Expression & { kind: "tuple_expr" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const totalSize = expr.elements.length * 8;
    const ptrIndex = ctx.addLocal(`__tuple_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(totalSize)
        )
    );

    const stores: binaryen.ExpressionRef[] = [];
    for (let i = 0; i < expr.elements.length; i++) {
        const elExpr = expr.elements[i]!;
        const valWasm = compileExpr(elExpr, mod, ctx, strings, fnSigs, errors);
        const valType = inferExprWasmType(elExpr, ctx, fnSigs);
        const offset = i * 8;

        const ptrExpr = mod.local.get(ptrIndex, binaryen.i32);
        if (valType === binaryen.f64) {
            stores.push(mod.f64.store(offset, 0, ptrExpr, valWasm));
        } else {
            stores.push(mod.i32.store(offset, 0, ptrExpr, valWasm));
        }
    }

    const returnPtr = mod.local.get(ptrIndex, binaryen.i32);
    return mod.block(null, [setPtr, incrementHeap, ...stores, returnPtr], binaryen.i32);
}

function compileEnumConstructor(
    expr: Expression & { kind: "enum_constructor" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const enumLayout = ctx.enumLayouts.get(expr.enumName);
    if (!enumLayout) {
        errors.push(`Enum layout not found for ${expr.enumName}`);
        return mod.unreachable();
    }

    const variantLayout = enumLayout.variants.find(v => v.name === expr.variant);
    if (!variantLayout) {
        errors.push(`Variant layout not found for ${expr.enumName}.${expr.variant}`);
        return mod.unreachable();
    }

    const ptrIndex = ctx.addLocal(`__enum_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(variantLayout.totalSize)
        )
    );

    const stores: binaryen.ExpressionRef[] = [];

    // Store tag
    const ptrExpr = mod.local.get(ptrIndex, binaryen.i32);
    stores.push(mod.i32.store(0, 0, ptrExpr, mod.i32.const(variantLayout.tag)));

    // Store fields
    for (const fieldInit of expr.fields) {
        const valWasm = compileExpr(fieldInit.value, mod, ctx, strings, fnSigs, errors);
        const fieldLayout = variantLayout.fields.find(f => f.name === fieldInit.name);
        if (!fieldLayout) continue; // Should be caught by type checker

        const ptrExprForField = mod.local.get(ptrIndex, binaryen.i32);
        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(mod.f64.store(fieldLayout.offset, 0, ptrExprForField, valWasm));
        } else {
            stores.push(mod.i32.store(fieldLayout.offset, 0, ptrExprForField, valWasm));
        }
    }

    const returnPtr = mod.local.get(ptrIndex, binaryen.i32);
    return mod.block(null, [setPtr, incrementHeap, ...stores, returnPtr], binaryen.i32);
}

function compileAccess(
    expr: Expression & { kind: "access" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    let recordTypeName: string | undefined;

    // Try to infer record type from target
    if (expr.target.kind === "ident") {
        const local = ctx.getLocal(expr.target.name);
        if (local && local.edictTypeName) {
            recordTypeName = local.edictTypeName;
        }
    } else if (expr.target.kind === "record_expr") {
        recordTypeName = expr.target.name;
    }

    if (!recordTypeName) {
        errors.push(`cannot resolve record type for field access '${expr.field}'`);
        return mod.unreachable();
    }

    const layout = ctx.recordLayouts.get(recordTypeName);
    if (!layout) {
        errors.push(`unknown record type: ${recordTypeName}`);
        return mod.unreachable();
    }

    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
    if (!fieldLayout) {
        errors.push(`unknown field '${expr.field}' on record '${recordTypeName}'`);
        return mod.unreachable();
    }

    const ptrExpr = compileExpr(expr.target, mod, ctx, strings, fnSigs, errors);

    if (fieldLayout.wasmType === binaryen.f64) {
        return mod.f64.load(fieldLayout.offset, 0, ptrExpr);
    } else {
        return mod.i32.load(fieldLayout.offset, 0, ptrExpr);
    }
}

// =============================================================================
// Import signature inference (for module-level imports)
// =============================================================================

interface ImportSig {
    paramTypes: binaryen.Type[];
    returnType: binaryen.Type;
}

/**
 * Scan function bodies for calls to imported names and infer WASM types
 * from the function's declared param/return types at call sites.
 */
function inferImportSignatures(
    module: EdictModule,
    importedNames: Set<string>,
): Map<string, ImportSig> {
    const sigs = new Map<string, ImportSig>();

    // Initialize with defaults
    for (const name of importedNames) {
        sigs.set(name, { paramTypes: [], returnType: binaryen.i32 });
    }

    // Multi-pass: run inference until stable (handles ordering deps like pow→sqrt)
    for (let pass = 0; pass < 3; pass++) {
        for (const def of module.definitions) {
            if (def.kind !== "fn") continue;
            inferFromExprs(def.body, def, sigs, importedNames);
        }
    }

    return sigs;
}

function inferFromExprs(
    exprs: Expression[],
    enclosingFn: FunctionDef,
    sigs: Map<string, ImportSig>,
    importedNames: Set<string>,
): void {
    for (const expr of exprs) {
        inferFromExpr(expr, enclosingFn, sigs, importedNames);
    }
}

function inferFromExpr(
    expr: Expression,
    enclosingFn: FunctionDef,
    sigs: Map<string, ImportSig>,
    importedNames: Set<string>,
): void {
    if (expr.kind === "call" && expr.fn.kind === "ident" && importedNames.has(expr.fn.name)) {
        const name = expr.fn.name;
        // Infer param types from arguments
        const paramTypes = expr.args.map(arg => inferTypeFromExpr(arg, enclosingFn, sigs));
        // If any param is f64, promote all i32 numeric params to f64
        // (JSON can't distinguish 2.0 from 2; Edict doesn't mix int/float in one function)
        const hasFloat = paramTypes.some(t => t === binaryen.f64);
        if (hasFloat) {
            for (let j = 0; j < paramTypes.length; j++) {
                if (paramTypes[j] === binaryen.i32 && expr.args[j]?.kind === "literal" &&
                    typeof (expr.args[j] as Expression & { kind: "literal" }).value === "number") {
                    paramTypes[j] = binaryen.f64;
                }
            }
        }
        // Infer return type from the enclosing function's return type
        // (if this call is the last expression in the function body, it determines the return type)
        const lastExprInBody = enclosingFn.body.length > 0
            ? enclosingFn.body[enclosingFn.body.length - 1]
            : null;
        const returnType = isExprOrContains(lastExprInBody, expr)
            ? edictTypeToWasm(enclosingFn.returnType)
            : binaryen.i32;
        sigs.set(name, { paramTypes, returnType });
    }

    // Recurse into sub-expressions
    switch (expr.kind) {
        case "binop": inferFromExpr(expr.left, enclosingFn, sigs, importedNames); inferFromExpr(expr.right, enclosingFn, sigs, importedNames); break;
        case "unop": inferFromExpr(expr.operand, enclosingFn, sigs, importedNames); break;
        case "call": inferFromExpr(expr.fn, enclosingFn, sigs, importedNames); for (const a of expr.args) inferFromExpr(a, enclosingFn, sigs, importedNames); break;
        case "if": inferFromExpr(expr.condition, enclosingFn, sigs, importedNames); inferFromExprs(expr.then, enclosingFn, sigs, importedNames); if (expr.else) inferFromExprs(expr.else, enclosingFn, sigs, importedNames); break;
        case "let": inferFromExpr(expr.value, enclosingFn, sigs, importedNames); break;
        case "block": inferFromExprs(expr.body, enclosingFn, sigs, importedNames); break;
        case "match": inferFromExpr(expr.target, enclosingFn, sigs, importedNames); for (const arm of expr.arms) inferFromExprs(arm.body, enclosingFn, sigs, importedNames); break;
        case "lambda": inferFromExprs(expr.body, enclosingFn, sigs, importedNames); break;
        case "array": for (const el of expr.elements) inferFromExpr(el, enclosingFn, sigs, importedNames); break;
        case "record_expr": for (const f of expr.fields) inferFromExpr(f.value, enclosingFn, sigs, importedNames); break;
        case "access": inferFromExpr(expr.target, enclosingFn, sigs, importedNames); break;
        default: break;
    }
}

/**
 * Infer the WASM type of an expression from its AST structure.
 * Used during import signature inference (before we have a FunctionContext).
 */
function inferTypeFromExpr(
    expr: Expression,
    enclosingFn: FunctionDef,
    sigs?: Map<string, ImportSig>,
): binaryen.Type {
    if (expr.kind === "literal") {
        if (expr.type) return edictTypeToWasm(expr.type);
        if (typeof expr.value === "number" && !Number.isInteger(expr.value)) return binaryen.f64;
        return binaryen.i32;
    }
    if (expr.kind === "ident") {
        const param = enclosingFn.params.find(p => p.name === expr.name);
        if (param) return edictTypeToWasm(param.type);
        return binaryen.i32;
    }
    if (expr.kind === "binop") {
        // Arithmetic result type follows left operand
        const cmpOps = ["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"];
        if (cmpOps.includes(expr.op)) return binaryen.i32;
        return inferTypeFromExpr(expr.left, enclosingFn, sigs);
    }
    if (expr.kind === "call" && expr.fn.kind === "ident") {
        // Check inferred import sigs first, then fn defs
        if (sigs?.has(expr.fn.name)) {
            return sigs.get(expr.fn.name)!.returnType;
        }
        // Check enclosing module's function definitions
        return binaryen.i32;
    }
    return binaryen.i32;
}

/**
 * Check if target expression is or contains the needle (by reference).
 */
function isExprOrContains(target: Expression | null | undefined, needle: Expression): boolean {
    if (!target) return false;
    if (target === needle) return true;
    switch (target.kind) {
        case "call": return target.args.some(a => isExprOrContains(a, needle)) || isExprOrContains(target.fn, needle);
        case "binop": return isExprOrContains(target.left, needle) || isExprOrContains(target.right, needle);
        case "unop": return isExprOrContains(target.operand, needle);
        default: return false;
    }
}

// =============================================================================
// Array expression compilation
// =============================================================================

function compileArrayExpr(
    expr: Expression & { kind: "array" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    const elements = expr.elements;
    // Layout: [length: i32] [elem0: i32] [elem1: i32] ...
    const headerSize = 4; // i32 for length
    const elemSize = 4;   // i32 per element
    const totalSize = headerSize + elements.length * elemSize;

    const ptrIndex = ctx.addLocal(`__array_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(totalSize),
        ),
    );

    // Store length at offset 0
    const storeLength = mod.i32.store(
        0, 0,
        mod.local.get(ptrIndex, binaryen.i32),
        mod.i32.const(elements.length),
    );

    // Store each element
    const stores: binaryen.ExpressionRef[] = [];
    for (let i = 0; i < elements.length; i++) {
        const valueExpr = compileExpr(elements[i]!, mod, ctx, strings, fnSigs, errors);
        stores.push(
            mod.i32.store(
                headerSize + i * elemSize,
                0,
                mod.local.get(ptrIndex, binaryen.i32),
                valueExpr,
            ),
        );
    }

    return mod.block(null, [
        setPtr,
        incrementHeap,
        storeLength,
        ...stores,
        mod.local.get(ptrIndex, binaryen.i32), // return pointer
    ], binaryen.i32);
}

// =============================================================================
// Lambda expression compilation
// =============================================================================

// Counter for generating unique lambda function names
let lambdaCounter = 0;

function compileLambdaExpr(
    expr: Expression & { kind: "lambda" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: string[],
): binaryen.ExpressionRef {
    // Compile as a module-level helper function with a generated name
    const lambdaName = `__lambda_${lambdaCounter++}`;

    const params = expr.params.map((p) => ({
        name: p.name,
        wasmType: edictTypeToWasm(p.type),
    }));

    const lambdaCtx = new FunctionContext(
        params.map(p => ({ name: p.name, wasmType: p.wasmType })),
        ctx.constGlobals,
        ctx.recordLayouts,
        ctx.enumLayouts,
    );

    const paramTypes = params.map(p => p.wasmType);
    const paramType = paramTypes.length > 0
        ? binaryen.createType(paramTypes)
        : binaryen.none;

    // Infer return type from last body expression
    let returnType = binaryen.i32;
    if (expr.returnType) {
        returnType = edictTypeToWasm(expr.returnType);
    } else if (expr.body.length > 0) {
        returnType = inferExprWasmType(expr.body[expr.body.length - 1]!, lambdaCtx, fnSigs);
    }

    // Compile body
    const bodyExprs = expr.body.map((e, i) => {
        const compiled = compileExpr(e, mod, lambdaCtx, strings, fnSigs, errors);
        if (i < expr.body.length - 1 && e.kind !== "let") {
            return mod.drop(compiled);
        }
        return compiled;
    });

    let body: binaryen.ExpressionRef;
    if (bodyExprs.length === 0) {
        body = mod.nop();
    } else if (bodyExprs.length === 1) {
        body = bodyExprs[0]!;
    } else {
        body = mod.block(null, bodyExprs, returnType);
    }

    mod.addFunction(lambdaName, paramType, returnType, lambdaCtx.varTypes, body);
    fnSigs.set(lambdaName, { returnType, paramTypes: paramTypes });

    // Return the function index as an i32 (for indirect calls / function references)
    // For now, we add it to a table so it can be called indirectly
    // Use a simple approach: return an i32 identifier that the caller can use
    // The function is registered; callers that use it via direct name will resolve it
    return mod.i32.const(lambdaCounter - 1);
}

// =============================================================================
// String literal collector (pre-scan)
// =============================================================================

function collectStrings(exprs: Expression[], strings: StringTable): void {
    for (const expr of exprs) {
        collectStringExpr(expr, strings);
    }
}

function collectStringExpr(expr: Expression, strings: StringTable): void {
    switch (expr.kind) {
        case "literal":
            if (typeof expr.value === "string") {
                strings.intern(expr.value);
            }
            break;
        case "binop":
            collectStringExpr(expr.left, strings);
            collectStringExpr(expr.right, strings);
            break;
        case "unop":
            collectStringExpr(expr.operand, strings);
            break;
        case "call":
            collectStringExpr(expr.fn, strings);
            for (const arg of expr.args) collectStringExpr(arg, strings);
            break;
        case "if":
            collectStringExpr(expr.condition, strings);
            collectStrings(expr.then, strings);
            if (expr.else) collectStrings(expr.else, strings);
            break;
        case "let":
            collectStringExpr(expr.value, strings);
            break;
        case "block":
            collectStrings(expr.body, strings);
            break;
        case "match":
            collectStringExpr(expr.target, strings);
            for (const arm of expr.arms) collectStrings(arm.body, strings);
            break;
        case "lambda":
            collectStrings(expr.body, strings);
            break;
        case "record_expr":
            for (const field of expr.fields) {
                collectStringExpr(field.value, strings);
            }
            break;
        case "tuple_expr":
            for (const el of expr.elements) {
                collectStringExpr(el, strings);
            }
            break;
        case "enum_constructor":
            for (const field of expr.fields) {
                collectStringExpr(field.value, strings);
            }
            break;
        case "access":
            collectStringExpr(expr.target, strings);
            break;
        // ident, array, tuple_expr, enum_constructor
        // — no string literals directly
    }
}
