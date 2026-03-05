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

import { StringTable } from "./string-table.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { type StructuredError, wasmValidationError } from "../errors/structured-errors.js";
import { collectStrings } from "./collect-strings.js";
import { generateArrayMap, generateArrayFilter, generateArrayReduce } from "./hof-generators.js";
import {
    type CompilationContext,
    type CompileResult,
    type CompileSuccess,
    type CompileFailure,
    type CompileOptions,
    type FunctionSig,

    type FieldLayout,
    type EnumVariantLayout,
    type EnumLayout,
    type RecordLayout,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { inferImportSignatures } from "./imports.js";
import { collectFreeVariables, allocClosurePair } from "./closures.js";

// Re-export types for backwards compatibility
export type { CompileResult, CompileSuccess, CompileFailure, CompileOptions };
export type { FieldLayout, EnumVariantLayout, EnumLayout, RecordLayout };


// =============================================================================
// Compile-time WASM type inference for expressions
// =============================================================================

/**
 * Infer the WASM type an expression will produce at runtime.
 * Used to dispatch i32 vs f64 instructions in binops, unops, and block types.
 */
function inferExprWasmType(
    expr: Expression,
    cc: CompilationContext,
    ctx: FunctionContext,
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
            const globalType = cc.constGlobals.get(expr.name);
            if (globalType) return globalType;
            return binaryen.i32;
        }
        case "binop": {
            // Comparison/logical ops always return i32 (boolean)
            const cmpOps = ["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"];
            if (cmpOps.includes(expr.op)) return binaryen.i32;
            // Arithmetic: infer from left operand
            return inferExprWasmType(expr.left, cc, ctx);
        }
        case "unop":
            if (expr.op === "not") return binaryen.i32;
            return inferExprWasmType(expr.operand, cc, ctx);
        case "call": {
            if (expr.fn.kind === "ident") {
                const sig = cc.fnSigs.get(expr.fn.name);
                if (sig) return sig.returnType;
            }
            return binaryen.i32;
        }
        case "if":
            // Type of if is the type of the then branch's last expression
            if (expr.then.length > 0) {
                return inferExprWasmType(expr.then[expr.then.length - 1]!, cc, ctx);
            }
            return binaryen.i32;
        case "let":
            return binaryen.none; // let is a statement (local.set), returns void
        case "block":
            if (expr.body.length > 0) {
                return inferExprWasmType(expr.body[expr.body.length - 1]!, cc, ctx);
            }
            return binaryen.none;
        case "match":
            // Type of match is the type of the first arm's body
            if (expr.arms.length > 0 && expr.arms[0]!.body.length > 0) {
                const firstBody = expr.arms[0]!.body;
                return inferExprWasmType(firstBody[firstBody.length - 1]!, cc, ctx);
            }
            return binaryen.i32;
        case "array":
        case "tuple_expr":
        case "enum_constructor":
        case "record_expr":
            return binaryen.i32; // heap pointer
        case "string_interp":
            return binaryen.i32; // string pointer
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
                const layout = cc.recordLayouts.get(recordTypeName);
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
// Compiler
// =============================================================================

export function compile(module: EdictModule, options?: CompileOptions): CompileResult {
    const mod = new binaryen.Module();
    const strings = new StringTable();
    const errors: StructuredError[] = [];
    const maxPages = options?.maxMemoryPages ?? 16;

    try {
        // Pre-scan: intern all string literals
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                collectStrings(def.body, strings);
            }
            if (def.kind === "const") {
                collectStrings([def.value], strings);
            }
        }

        // Setup memory with string data segments
        const segments = strings.toMemorySegments(mod);
        const pages = Math.max(1, Math.ceil(strings.totalBytes / 65536));
        mod.setMemory(pages, maxPages, "memory", segments);

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

        // Register built-in Option enum layout: None (tag 0), Some(value) (tag 1)
        // Guard lets user-defined Option enums override the built-in.
        if (!enumLayouts.has("Option")) {
            enumLayouts.set("Option", {
                variants: [
                    { name: "None", tag: 0, fields: [], totalSize: 8 },
                    { name: "Some", tag: 1, fields: [{ name: "value", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
                ],
            });
        }

        // Register built-in Result enum layout: Ok (tag 0), Err (tag 1)
        // Guard lets user-defined Result enums override the built-in.
        if (!enumLayouts.has("Result")) {
            enumLayouts.set("Result", {
                variants: [
                    { name: "Ok", tag: 0, fields: [{ name: "value", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
                    { name: "Err", tag: 1, fields: [{ name: "error", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
                ],
            });
        }

        // Initialize bump allocator heap pointer
        // Ensure heap starts at an 8-byte aligned offset after the string table, min 8
        const heapStart = Math.max(8, Math.ceil(strings.totalBytes / 8) * 8);
        mod.addGlobal("__heap_ptr", binaryen.i32, true, mod.i32.const(heapStart));

        // Global for passing dynamic string result lengths from host builtins
        mod.addGlobal("__str_ret_len", binaryen.i32, true, mod.i32.const(0));

        // Pre-scan: build function signature registry
        const fnSigs = new Map<string, FunctionSig>();

        // Register builtins in fnSigs so the generic call path has correct
        // return types and can coerce arguments (e.g. i32→f64 for sqrt)
        for (const [name, builtin] of BUILTIN_FUNCTIONS) {
            fnSigs.set(name, {
                returnType: edictTypeToWasm(builtin.type.returnType),
                paramTypes: builtin.type.params.map(p => edictTypeToWasm(p)),
            });
        }

        for (const def of module.definitions) {
            if (def.kind === "fn") {
                // Closure convention: all user functions have __env:i32 as first WASM param
                fnSigs.set(def.name, {
                    returnType: edictTypeToWasm(def.returnType),
                    paramTypes: [binaryen.i32, ...def.params.map((p) => edictTypeToWasm(p.type))],
                });
            }
        }

        // HOF support: function table for indirect calls (call_indirect)
        // Pre-assign table indices to user-defined functions.
        // Lambdas will be appended during compilation.
        const tableFunctions: string[] = [];
        const fnTableIndices = new Map<string, number>();
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                fnTableIndices.set(def.name, tableFunctions.length);
                tableFunctions.push(def.name);
            }
        }

        // Import builtins — compute WASM-level params from Edict signatures
        // Each String param becomes two i32 values (ptr, len) at the WASM level
        for (const [name, builtin] of BUILTIN_FUNCTIONS) {
            const [importModule, importBase] = builtin.wasmImport;
            // WASM-native builtins (HOFs) are generated as internal functions, not imported
            if (importModule === "__wasm") continue;
            const wasmParams: binaryen.Type[] = [];
            for (const param of builtin.type.params) {
                if (param.kind === "basic" && param.name === "String") {
                    wasmParams.push(binaryen.i32, binaryen.i32); // ptr, len
                } else {
                    wasmParams.push(edictTypeToWasm(param));
                }
            }
            mod.addFunctionImport(
                name,
                importModule,
                importBase,
                wasmParams.length > 0
                    ? binaryen.createType(wasmParams)
                    : binaryen.none,
                edictTypeToWasm(builtin.type.returnType),
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

        // Create the compilation context — bundles compile-wide state
        const cc: CompilationContext = {
            mod, strings, fnSigs, errors,
            constGlobals, recordLayouts, enumLayouts, fnTableIndices, tableFunctions,
            lambdaCounter: 0,
        };

        for (const def of module.definitions) {
            if (def.kind === "const") {
                const wasmType = edictTypeToWasm(def.type);
                // Create a temporary context for compiling the const init expression
                const tmpCtx = new FunctionContext([]);
                const initExpr = compileExpr(
                    def.value, cc, tmpCtx,
                );
                mod.addGlobal(def.name, wasmType, false, initExpr);
                constGlobals.set(def.name, wasmType);
            }
        }

        // Compile each function
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                compileFunction(def, cc);
            }
        }

        // =====================================================================
        // Generate WASM-native HOF array builtins
        // These need call_indirect to invoke closure arguments, so they
        // must be generated as internal WASM functions (not host imports).
        // Array layout in memory: [length:i32][elem0:i32][elem1:i32]...
        // Closure pair layout: [table_index:i32][env_ptr:i32]
        // =====================================================================
        generateArrayMap(mod);
        generateArrayFilter(mod);
        generateArrayReduce(mod);

        // Build function table for indirect calls (call_indirect)
        // This must happen after all functions (including lambdas) are compiled
        if (tableFunctions.length > 0) {
            mod.addTable("__fn_table", tableFunctions.length, tableFunctions.length);
            mod.addActiveElementSegment(
                "__fn_table", "__fn_elems", tableFunctions, mod.i32.const(0),
            );
        }

        // Export the "main" function if it exists
        const mainDef = module.definitions.find(
            (d) => d.kind === "fn" && d.name === "main",
        );
        if (mainDef) {
            mod.addFunctionExport("main", "main");
        }

        // Export getter/setter functions for globals needed by host builtins.
        // Mutable globals can't be directly exported in baseline WASM,
        // so we use function wrappers instead.
        mod.addFunction(
            "__get_heap_ptr", binaryen.none, binaryen.i32, [],
            mod.global.get("__heap_ptr", binaryen.i32),
        );
        mod.addFunctionExport("__get_heap_ptr", "__get_heap_ptr");

        mod.addFunction(
            "__set_heap_ptr", binaryen.createType([binaryen.i32]), binaryen.none, [],
            mod.global.set("__heap_ptr", mod.local.get(0, binaryen.i32)),
        );
        mod.addFunctionExport("__set_heap_ptr", "__set_heap_ptr");

        mod.addFunction(
            "__get_str_ret_len", binaryen.none, binaryen.i32, [],
            mod.global.get("__str_ret_len", binaryen.i32),
        );
        mod.addFunctionExport("__get_str_ret_len", "__get_str_ret_len");

        mod.addFunction(
            "__set_str_ret_len", binaryen.createType([binaryen.i32]), binaryen.none, [],
            mod.global.set("__str_ret_len", mod.local.get(0, binaryen.i32)),
        );
        mod.addFunctionExport("__set_str_ret_len", "__set_str_ret_len");

        // Memory is already exported via setMemory's exportName parameter

        // Validate
        if (errors.length > 0) {
            return { ok: false, errors };
        }

        if (!mod.validate()) {
            errors.push(wasmValidationError("binaryen validation failed"));
            return { ok: false, errors };
        }

        // Optimize
        mod.optimize();

        const wat = options?.emitWat ? mod.emitText() : undefined;
        const wasm = mod.emitBinary();

        return { ok: true, wasm, ...(wat ? { wat } : {}) };
    } catch (e) {
        errors.push(wasmValidationError(e instanceof Error ? e.message : String(e)));
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
    cc: CompilationContext,
): void {
    const { mod } = cc;
    const params = fn.params.map((p) => ({
        name: p.name,
        edictType: p.type,
        wasmType: edictTypeToWasm(p.type),
        edictTypeName: p.type.kind === "named" ? p.type.name : p.type.kind === "option" ? "Option" : p.type.kind === "result" ? "Result" : undefined,
    }));

    // Closure convention: all user functions have __env:i32 as first WASM param.
    // The __env param is ignored for non-lambda functions but ensures uniform
    // call_indirect signatures when functions are used as values.
    const allParams = [
        { name: "__env", wasmType: binaryen.i32 as binaryen.Type, edictTypeName: undefined },
        ...params.map((p) => ({ name: p.name, wasmType: p.wasmType, edictTypeName: p.edictTypeName })),
    ];

    const ctx = new FunctionContext(allParams);

    const returnType = edictTypeToWasm(fn.returnType);
    const paramTypes = allParams.map((p) => p.wasmType);
    const paramType =
        paramTypes.length > 0
            ? binaryen.createType(paramTypes)
            : binaryen.none;

    // Compile body — wrap non-final expressions in drop() per WASM semantics
    const bodyExprs = fn.body.map((expr, i) => {
        const compiled = compileExpr(expr, cc, ctx);
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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    switch (expr.kind) {
        case "literal":
            return compileLiteral(expr, cc);

        case "ident":
            return compileIdent(expr, cc, ctx);

        case "binop":
            return compileBinop(expr, cc, ctx);

        case "unop":
            return compileUnop(expr, cc, ctx);

        case "call":
            return compileCall(expr, cc, ctx);

        case "if":
            return compileIf(expr, cc, ctx);

        case "let":
            return compileLet(expr, cc, ctx);

        case "block":
            return compileBlock(expr, cc, ctx);

        case "match":
            return compileMatch(expr, cc, ctx);

        case "record_expr":
            return compileRecordExpr(expr, cc, ctx);

        case "tuple_expr":
            return compileTupleExpr(expr, cc, ctx);

        case "enum_constructor":
            return compileEnumConstructor(expr, cc, ctx);

        case "access":
            return compileAccess(expr, cc, ctx);

        case "array":
            return compileArrayExpr(expr as Expression & { kind: "array" }, cc, ctx);

        case "lambda":
            return compileLambdaExpr(expr as Expression & { kind: "lambda" }, cc, ctx);

        case "string_interp":
            return compileStringInterp(expr as Expression & { kind: "string_interp" }, cc, ctx);

        default:
            cc.errors.push(wasmValidationError(`unsupported expression kind: ${(expr as any).kind}`));
            return cc.mod.unreachable();
    }
}

function compileLiteral(
    expr: Expression & { kind: "literal" },
    cc: CompilationContext,
): binaryen.ExpressionRef {
    const { mod, strings } = cc;
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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const local = ctx.getLocal(expr.name);
    if (local) {
        return mod.local.get(local.index, local.type);
    }
    // Check module-level const globals
    const globalType = cc.constGlobals.get(expr.name);
    if (globalType !== undefined) {
        return mod.global.get(expr.name, globalType);
    }
    // Check function table — return a closure pair (table_index, env_ptr=0)
    // This enables `let f = myFunc` to store a function reference as a closure
    const tableIndex = cc.fnTableIndices.get(expr.name);
    if (tableIndex !== undefined) {
        return allocClosurePair(
            mod, ctx,
            mod.i32.const(tableIndex),
            mod.i32.const(0),
            `ident_${expr.name}`,
        );
    }
    return mod.unreachable();
}

function compileBinop(
    expr: Expression & { kind: "binop" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs, errors } = cc;
    const left = compileExpr(expr.left, cc, ctx);
    const right = compileExpr(expr.right, cc, ctx);

    // Determine the WASM type from the left operand.
    // Type checker guarantees matching types for both operands.
    const opType = inferExprWasmType(expr.left, cc, ctx);
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
                errors.push(wasmValidationError(`modulo (%) not supported for Float`));
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
            errors.push(wasmValidationError(`unsupported binop: ${expr.op}`));
            return mod.unreachable();
    }
}

function compileUnop(
    expr: Expression & { kind: "unop" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs, errors } = cc;
    const operand = compileExpr(expr.operand, cc, ctx);
    const opType = inferExprWasmType(expr.operand, cc, ctx);
    const isFloat = opType === binaryen.f64;

    switch (expr.op) {
        case "-":
            return isFloat
                ? mod.f64.neg(operand)
                : mod.i32.sub(mod.i32.const(0), operand);
        case "not":
            return mod.i32.eqz(operand);
        default:
            errors.push(wasmValidationError(`unsupported unop: ${expr.op}`));
            return mod.unreachable();
    }
}

function compileCall(
    expr: Expression & { kind: "call" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings, fnSigs } = cc;
    // Determine if this is a direct call (fn is ident resolving to a known function)
    // or an indirect call (fn is a variable, lambda, or expression)
    const isDirectCall = expr.fn.kind === "ident"
        && !ctx.getLocal(expr.fn.name)  // Not a local variable holding a fn ref
        && (fnSigs.has(expr.fn.name) || BUILTIN_FUNCTIONS.has(expr.fn.name));

    if (isDirectCall && expr.fn.kind === "ident") {
        // === Direct call path (optimized, no call_indirect overhead) ===
        const fnName = expr.fn.name;
        const builtin = BUILTIN_FUNCTIONS.get(fnName);

        // Special handling for builtins that take String params:
        // Strings are (ptr, len) pairs at the WASM level, so String args must
        // be expanded. Check whether this builtin has any String params.
        if (builtin) {
            const hasStringParam = builtin.type.params.some(
                p => p.kind === "basic" && p.name === "String",
            );
            if (hasStringParam) {
                const wasmArgs: binaryen.ExpressionRef[] = [];

                for (let i = 0; i < expr.args.length; i++) {
                    const arg = expr.args[i]!;
                    const paramType = builtin.type.params[i];
                    const isStringParam = paramType?.kind === "basic" && paramType.name === "String";

                    if (isStringParam) {
                        if (arg.kind === "literal" && typeof arg.value === "string") {
                            // String literal — ptr and len known at compile time
                            const interned = strings.intern(arg.value);
                            wasmArgs.push(mod.i32.const(interned.offset));
                            wasmArgs.push(mod.i32.const(interned.length));
                        } else {
                            // Non-literal string arg — compile to get ptr,
                            // read __str_ret_len for the length
                            const ptrExpr = compileExpr(arg, cc, ctx);
                            wasmArgs.push(ptrExpr);
                            wasmArgs.push(mod.global.get("__str_ret_len", binaryen.i32));
                        }
                    } else {
                        // Non-string param — compile normally
                        wasmArgs.push(compileExpr(arg, cc, ctx));
                    }
                }

                const sig = fnSigs.get(fnName);
                const returnType = sig ? sig.returnType : binaryen.i32;
                return mod.call(fnName, wasmArgs, returnType);
            }
        }

        // Generic direct function call
        // User-defined functions have __env as first WASM param; builtins and imports do not.
        // fnTableIndices contains exactly the user-defined functions.
        const isUserFn = cc.fnTableIndices.has(fnName);
        const args = expr.args.map((a, i) => {
            const compiled = compileExpr(a, cc, ctx);
            // Coerce i32→f64 if function expects f64 but arg infers to i32
            const sig = fnSigs.get(fnName);
            // For user functions, paramTypes[0] is __env, so Edict arg i maps to paramTypes[i+1]
            // For builtins, paramTypes maps directly (no __env)
            const paramIdx = isUserFn ? i + 1 : i;
            if (sig?.paramTypes && sig.paramTypes[paramIdx] === binaryen.f64) {
                const argType = inferExprWasmType(a, cc, ctx);
                if (argType === binaryen.i32) {
                    return mod.f64.convert_s.i32(compiled);
                }
            }
            return compiled;
        });
        // Look up signature for correct return type
        const sig = fnSigs.get(fnName);
        const returnType = sig ? sig.returnType : binaryen.i32;
        // Prepend dummy __env = 0 only for user-defined functions (not builtins)
        const callArgs = isUserFn ? [mod.i32.const(0), ...args] : args;
        return mod.call(fnName, callArgs, returnType);
    }

    // === Indirect call path (call_indirect via function table) ===
    // The fn expression evaluates to a closure pair pointer: [table_index, env_ptr]
    const closurePtr = compileExpr(expr.fn, cc, ctx);

    // We need to decompose the closure pair, so store it in a temp local
    const closurePtrLocal = ctx.addLocal(`__call_closure_${expr.id}`, binaryen.i32);

    // Compile arguments
    const args = expr.args.map(a =>
        compileExpr(a, cc, ctx),
    );

    // Determine the WASM type signature for call_indirect:
    // - params: __env (i32) + inferred from compiled argument types
    // - result: infer from the overall call expression type
    const argWasmTypes = expr.args.map(a => inferExprWasmType(a, cc, ctx));
    const allParamTypes = [binaryen.i32, ...argWasmTypes]; // __env + user args
    const paramType = binaryen.createType(allParamTypes);
    const resultType = inferExprWasmType(expr as Expression, cc, ctx);

    // Load table_index and env_ptr from the closure pair
    const tableIdx = mod.i32.load(0, 0, mod.local.get(closurePtrLocal, binaryen.i32));
    const envPtr = mod.i32.load(4, 0, mod.local.get(closurePtrLocal, binaryen.i32));

    return mod.block(null, [
        // Store closure pointer in temp
        mod.local.set(closurePtrLocal, closurePtr),
        // call_indirect with env_ptr prepended to args
        mod.call_indirect("__fn_table", tableIdx, [envPtr, ...args], paramType, resultType),
    ], resultType);
}

function compileIf(
    expr: Expression & { kind: "if" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
    const cond = compileExpr(expr.condition, cc, ctx);

    // Infer the result type from the then-branch's last expression
    const resultType = expr.then.length > 0
        ? inferExprWasmType(expr.then[expr.then.length - 1]!, cc, ctx)
        : binaryen.i32;

    const thenExprs = expr.then.map((e) =>
        compileExpr(e, cc, ctx),
    );
    const thenBody =
        thenExprs.length === 1
            ? thenExprs[0]!
            : mod.block(null, thenExprs, resultType);

    if (expr.else) {
        const elseExprs = expr.else.map((e) =>
            compileExpr(e, cc, ctx),
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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings, fnSigs } = cc;
    const wasmType = expr.type
        ? edictTypeToWasm(expr.type)
        : inferExprWasmType(expr.value, cc, ctx);

    let edictTypeName: string | undefined;
    if (expr.type && expr.type.kind === "named") {
        edictTypeName = expr.type.name;
    } else if (expr.type && expr.type.kind === "option") {
        edictTypeName = "Option";
    } else if (expr.type && expr.type.kind === "result") {
        edictTypeName = "Result";
    } else if (expr.value.kind === "record_expr") {
        edictTypeName = expr.value.name;
    } else if (expr.value.kind === "enum_constructor") {
        edictTypeName = expr.value.enumName;
    }

    const index = ctx.addLocal(expr.name, wasmType, edictTypeName);
    const value = compileExpr(expr.value, cc, ctx);
    const localSet = mod.local.set(index, value);

    // For String-type let bindings from literals, also set __str_ret_len
    // so downstream string builtins can read the correct length.
    // For calls to string-returning builtins, __str_ret_len is already set by the host.
    const isStringType = expr.type?.kind === "basic" && expr.type.name === "String";
    if (isStringType && expr.value.kind === "literal" && typeof expr.value.value === "string") {
        const interned = strings.intern(expr.value.value);
        return mod.block(null, [
            localSet,
            mod.global.set("__str_ret_len", mod.i32.const(interned.length)),
        ], binaryen.none);
    }

    return localSet;
}

function compileBlock(
    expr: Expression & { kind: "block" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
    const bodyExprs = expr.body.map((e) =>
        compileExpr(e, cc, ctx),
    );
    if (bodyExprs.length === 0) return mod.nop();
    if (bodyExprs.length === 1) return bodyExprs[0]!;
    const blockType = inferExprWasmType(expr.body[expr.body.length - 1]!, cc, ctx);
    return mod.block(null, bodyExprs, blockType);
}

function compileMatch(
    expr: Expression & { kind: "match" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings, fnSigs, errors } = cc;
    // Attempt to determine the Edict type name of the target for enum matching
    let targetEdictTypeName: string | undefined;
    if (expr.target.kind === "ident") {
        const local = ctx.getLocal(expr.target.name);
        targetEdictTypeName = local?.edictTypeName;
    } else if (expr.target.kind === "call") {
        // Can't easily infer return named type yet without a type env here,
        // but let's be pragmatic if it's annotated
    } else if ("type" in expr.target && expr.target.type && expr.target.type.kind === "named") {
        targetEdictTypeName = expr.target.type.name;
    } else if ("type" in expr.target && expr.target.type && expr.target.type.kind === "option") {
        targetEdictTypeName = "Option";
    } else if ("type" in expr.target && expr.target.type && expr.target.type.kind === "result") {
        targetEdictTypeName = "Result";
    }

    // Infer the target and result types
    const targetType = inferExprWasmType(expr.target, cc, ctx);
    const matchResultType = inferExprWasmType(expr as Expression, cc, ctx);

    // Evaluate target once and store in a temporary local
    const targetExpr = compileExpr(expr.target, cc, ctx);
    const tmpIndex = ctx.addLocal(`__match_${expr.id}`, targetType);
    const setTarget = mod.local.set(tmpIndex, targetExpr);
    const getTarget = () => mod.local.get(tmpIndex, targetType);

    // Compile body of a match arm (list of expressions → single expression)
    function compileArmBody(body: Expression[]): binaryen.ExpressionRef {
        const compiled = body.map((e) =>
            compileExpr(e, cc, ctx),
        );
        if (compiled.length === 0) return mod.nop();
        if (compiled.length === 1) return compiled[0]!;
        const bodyType = body.length > 0
            ? inferExprWasmType(body[body.length - 1]!, cc, ctx)
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
                    errors.push(wasmValidationError(`float literal patterns not yet supported in match`));
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
                    const enumLayout = cc.enumLayouts.get(targetEdictTypeName);
                    if (enumLayout) {
                        const variantLayout = enumLayout.variants.find(v => v.name === pattern.name);
                        if (variantLayout) {
                            tagValue = variantLayout.tag;
                        } else {
                            errors.push(wasmValidationError(`unknown variant ${pattern.name} for enum ${targetEdictTypeName}`));
                            return null;
                        }
                    } else {
                        errors.push(wasmValidationError(`unknown enum ${targetEdictTypeName}`));
                        return null;
                    }
                } else {
                    errors.push(wasmValidationError(`cannot infer enum type for match target ${expr.id}`));
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
                const enumLayout = cc.enumLayouts.get(targetEdictTypeName);
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
                                errors.push(wasmValidationError(`nested patterns inside constructor patterns not yet supported`));
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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const layout = cc.recordLayouts.get(expr.name);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${expr.name}`));
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
            errors.push(wasmValidationError(`unknown field '${fieldInit.name}' on record '${expr.name}'`));
            continue;
        }

        const valueExpr = compileExpr(fieldInit.value, cc, ctx);

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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
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
        const valWasm = compileExpr(elExpr, cc, ctx);
        const valType = inferExprWasmType(elExpr, cc, ctx);
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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const enumLayout = cc.enumLayouts.get(expr.enumName);
    if (!enumLayout) {
        errors.push(wasmValidationError(`Enum layout not found for ${expr.enumName}`));
        return mod.unreachable();
    }

    const variantLayout = enumLayout.variants.find(v => v.name === expr.variant);
    if (!variantLayout) {
        errors.push(wasmValidationError(`Variant layout not found for ${expr.enumName}.${expr.variant}`));
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
        const valWasm = compileExpr(fieldInit.value, cc, ctx);
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
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
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
        errors.push(wasmValidationError(`cannot resolve record type for field access '${expr.field}'`));
        return mod.unreachable();
    }

    const layout = cc.recordLayouts.get(recordTypeName);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${recordTypeName}`));
        return mod.unreachable();
    }

    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
    if (!fieldLayout) {
        errors.push(wasmValidationError(`unknown field '${expr.field}' on record '${recordTypeName}'`));
        return mod.unreachable();
    }

    const ptrExpr = compileExpr(expr.target, cc, ctx);

    if (fieldLayout.wasmType === binaryen.f64) {
        return mod.f64.load(fieldLayout.offset, 0, ptrExpr);
    } else {
        return mod.i32.load(fieldLayout.offset, 0, ptrExpr);
    }
}


// =============================================================================
// Array expression compilation
// =============================================================================

function compileArrayExpr(
    expr: Expression & { kind: "array" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
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
        const valueExpr = compileExpr(elements[i]!, cc, ctx);
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

function compileLambdaExpr(
    expr: Expression & { kind: "lambda" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
    // Compile as a module-level helper function with a generated name
    const lambdaName = `__lambda_${cc.lambdaCounter++}`;

    const params = expr.params.map((p) => ({
        name: p.name,
        wasmType: edictTypeToWasm(p.type),
    }));

    // Detect free variables (captures from enclosing scope)
    const paramNames = new Set(expr.params.map(p => p.name));
    const freeVars = collectFreeVariables(
        expr.body, paramNames, cc.constGlobals, fnSigs,
    );

    // Resolve WASM types for free variables from the enclosing context
    const captures: { name: string; wasmType: binaryen.Type; offset: number }[] = [];
    let envOffset = 0;
    for (const [name] of freeVars) {
        const local = ctx.getLocal(name);
        const wasmType = local ? local.type : binaryen.i32;
        captures.push({ name, wasmType, offset: envOffset });
        envOffset += 8; // 8-byte slots (supports both i32 and f64)
    }

    // Build lambda context with __env as first param + lambda's own params
    const allLambdaParams = [
        { name: "__env", wasmType: binaryen.i32 as binaryen.Type },
        ...params.map(p => ({ name: p.name, wasmType: p.wasmType })),
    ];

    const lambdaCtx = new FunctionContext(allLambdaParams);

    // For captured variables, add locals that load from __env at known offsets.
    // We put the loads at the top of the function body.
    const envLoads: binaryen.ExpressionRef[] = [];
    for (const capture of captures) {
        const localIndex = lambdaCtx.addLocal(capture.name, capture.wasmType);
        if (capture.wasmType === binaryen.f64) {
            envLoads.push(
                mod.local.set(localIndex,
                    mod.f64.load(capture.offset, 0,
                        mod.local.get(0, binaryen.i32), // __env is param 0
                    ),
                ),
            );
        } else {
            envLoads.push(
                mod.local.set(localIndex,
                    mod.i32.load(capture.offset, 0,
                        mod.local.get(0, binaryen.i32), // __env is param 0
                    ),
                ),
            );
        }
    }

    const allParamTypes = allLambdaParams.map(p => p.wasmType);
    const paramType = binaryen.createType(allParamTypes);

    // Infer return type from last body expression
    let returnType = binaryen.i32;
    if (expr.body.length > 0) {
        returnType = inferExprWasmType(expr.body[expr.body.length - 1]!, cc, lambdaCtx);
    }

    // Compile body
    const bodyExprs = expr.body.map((e, i) => {
        const compiled = compileExpr(e, cc, lambdaCtx);
        if (i < expr.body.length - 1 && e.kind !== "let") {
            return mod.drop(compiled);
        }
        return compiled;
    });

    // Prepend env loads to body
    const allBodyExprs = [...envLoads, ...bodyExprs];

    let body: binaryen.ExpressionRef;
    if (allBodyExprs.length === 0) {
        body = mod.nop();
    } else if (allBodyExprs.length === 1) {
        body = allBodyExprs[0]!;
    } else {
        body = mod.block(null, allBodyExprs, returnType);
    }

    mod.addFunction(lambdaName, paramType, returnType, lambdaCtx.varTypes, body);
    fnSigs.set(lambdaName, { returnType, paramTypes: allParamTypes });

    // Register lambda in the function table for indirect calls
    // The table is built after all functions are compiled
    const tableIndex = cc.tableFunctions.length;
    cc.fnTableIndices.set(lambdaName, tableIndex);
    cc.tableFunctions.push(lambdaName);

    // Allocate environment record on the heap (if there are captures)
    let envPtrExpr: binaryen.ExpressionRef;
    if (captures.length > 0) {
        const envSize = captures.length * 8;
        const envPtrLocal = ctx.addLocal(`__env_ptr_${lambdaName}`, binaryen.i32);

        // Allocate env record: store each captured value
        const envStores: binaryen.ExpressionRef[] = [
            // envPtr = __heap_ptr
            mod.local.set(envPtrLocal, mod.global.get("__heap_ptr", binaryen.i32)),
            // __heap_ptr += envSize
            mod.global.set(
                "__heap_ptr",
                mod.i32.add(
                    mod.local.get(envPtrLocal, binaryen.i32),
                    mod.i32.const(envSize),
                ),
            ),
        ];

        for (const capture of captures) {
            // Load captured value from enclosing ctx
            const capturedValue = (() => {
                const local = ctx.getLocal(capture.name);
                if (local) return mod.local.get(local.index, local.type);
                const globalType = cc.constGlobals.get(capture.name);
                if (globalType !== undefined) return mod.global.get(capture.name, globalType);
                return mod.unreachable();
            })();

            if (capture.wasmType === binaryen.f64) {
                envStores.push(
                    mod.f64.store(capture.offset, 0,
                        mod.local.get(envPtrLocal, binaryen.i32),
                        capturedValue,
                    ),
                );
            } else {
                envStores.push(
                    mod.i32.store(capture.offset, 0,
                        mod.local.get(envPtrLocal, binaryen.i32),
                        capturedValue,
                    ),
                );
            }
        }

        // Build env allocation block that returns the env pointer
        envPtrExpr = mod.block(null, [
            ...envStores,
            mod.local.get(envPtrLocal, binaryen.i32),
        ], binaryen.i32);
    } else {
        envPtrExpr = mod.i32.const(0);
    }

    // Return a closure pair: [table_index, env_ptr]
    return allocClosurePair(
        mod, ctx,
        mod.i32.const(tableIndex),
        envPtrExpr,
        lambdaName,
    );
}

function compileStringInterp(
    expr: Expression & { kind: "string_interp" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings } = cc;
    const parts = expr.parts;

    // Edge case: no parts → empty string
    if (parts.length === 0) {
        const empty = strings.intern("");
        // Set __str_ret_len so downstream consumers read correct length
        return mod.block(null, [
            mod.global.set("__str_ret_len", mod.i32.const(empty.length)),
            mod.i32.const(empty.offset),
        ], binaryen.i32);
    }

    // Single part → compile directly (no concat needed)
    // For string literals, must also set __str_ret_len
    if (parts.length === 1) {
        const part = parts[0]!;
        if (part.kind === "literal" && typeof part.value === "string") {
            const interned = strings.intern(part.value);
            return mod.block(null, [
                mod.global.set("__str_ret_len", mod.i32.const(interned.length)),
                mod.i32.const(interned.offset),
            ], binaryen.i32);
        }
        // Non-literal — __str_ret_len already set by callee
        return compileExpr(part, cc, ctx);
    }

    // Helper: compile a part and return [ptrExpr, lenExpr]
    function compilePart(part: Expression): [binaryen.ExpressionRef, binaryen.ExpressionRef] {
        if (part.kind === "literal" && typeof part.value === "string") {
            const interned = strings.intern(part.value);
            return [mod.i32.const(interned.offset), mod.i32.const(interned.length)];
        }
        const ptrExpr = compileExpr(part, cc, ctx);
        return [ptrExpr, mod.global.get("__str_ret_len", binaryen.i32)];
    }

    // Left-fold: concat(concat(concat(parts[0], parts[1]), parts[2]), ...)
    // Must save intermediate results to temp locals to prevent __str_ret_len clobbering.
    const stmts: binaryen.ExpressionRef[] = [];

    // Compile first part, save ptr+len to temp locals
    const [ptr0, len0] = compilePart(parts[0]!);
    const accPtrIdx = ctx.addLocal(`__interp_ptr_${expr.id}`, binaryen.i32);
    const accLenIdx = ctx.addLocal(`__interp_len_${expr.id}`, binaryen.i32);
    stmts.push(mod.local.set(accPtrIdx, ptr0));
    stmts.push(mod.local.set(accLenIdx, len0));

    // For each subsequent part, concat with accumulator
    for (let i = 1; i < parts.length; i++) {
        const [partPtr, partLen] = compilePart(parts[i]!);

        // Save part ptr+len to temp locals (partLen may reference __str_ret_len
        // which gets overwritten by the concat call)
        const tmpPartPtrIdx = ctx.addLocal(`__interp_p${i}_ptr_${expr.id}`, binaryen.i32);
        const tmpPartLenIdx = ctx.addLocal(`__interp_p${i}_len_${expr.id}`, binaryen.i32);
        stmts.push(mod.local.set(tmpPartPtrIdx, partPtr));
        stmts.push(mod.local.set(tmpPartLenIdx, partLen));

        // Call string_concat(accPtr, accLen, partPtr, partLen)
        const concatResult = mod.call("string_concat", [
            mod.local.get(accPtrIdx, binaryen.i32),
            mod.local.get(accLenIdx, binaryen.i32),
            mod.local.get(tmpPartPtrIdx, binaryen.i32),
            mod.local.get(tmpPartLenIdx, binaryen.i32),
        ], binaryen.i32);

        // Save result ptr and new __str_ret_len
        stmts.push(mod.local.set(accPtrIdx, concatResult));
        stmts.push(mod.local.set(accLenIdx, mod.global.get("__str_ret_len", binaryen.i32)));
    }

    // Return the final accumulated pointer
    stmts.push(mod.local.get(accPtrIdx, binaryen.i32));
    return mod.block(null, stmts, binaryen.i32);
}

