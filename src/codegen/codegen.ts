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
import { type StructuredError, wasmValidationError } from "../errors/structured-errors.js";
import { collectStrings } from "./collect-strings.js";
import {
    type CompileResult,
    type CompileSuccess,
    type CompileFailure,
    type CompileOptions,
    type FunctionSig,
    type LocalEntry,
    type FieldLayout,
    type EnumVariantLayout,
    type EnumLayout,
    type RecordLayout,
    FunctionContext,
} from "./types.js";

// Re-export types for backwards compatibility
export type { CompileResult, CompileSuccess, CompileFailure, CompileOptions };
export type { FieldLayout, EnumVariantLayout, EnumLayout, RecordLayout };

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
// Free variable collection (for closures)
// =============================================================================

/**
 * Walk a lambda body and collect identifiers that reference variables from
 * the enclosing scope ("free variables"). These are the values that must be
 * stored in a closure environment record.
 */
function collectFreeVariables(
    body: Expression[],
    paramNames: Set<string>,
    constGlobals: Map<string, binaryen.Type>,
    fnSigs: Map<string, FunctionSig>,
): Map<string, { wasmType: binaryen.Type }> {
    const free = new Map<string, { wasmType: binaryen.Type }>();
    const locallyDefined = new Set<string>();

    function walk(expr: Expression): void {
        switch (expr.kind) {
            case "ident":
                if (
                    !paramNames.has(expr.name) &&
                    !constGlobals.has(expr.name) &&
                    !fnSigs.has(expr.name) &&
                    !BUILTIN_FUNCTIONS.has(expr.name) &&
                    !locallyDefined.has(expr.name) &&
                    !free.has(expr.name)
                ) {
                    // This is a free variable — we'll determine its WASM type later
                    // during compilation when we have access to the enclosing context.
                    free.set(expr.name, { wasmType: binaryen.i32 }); // placeholder
                }
                break;
            case "let":
                walk(expr.value);
                locallyDefined.add(expr.name);
                break;
            case "binop":
                walk(expr.left);
                walk(expr.right);
                break;
            case "unop":
                walk(expr.operand);
                break;
            case "call":
                walk(expr.fn);
                for (const a of expr.args) walk(a);
                break;
            case "if":
                walk(expr.condition);
                for (const e of expr.then) walk(e);
                if (expr.else) for (const e of expr.else) walk(e);
                break;
            case "block":
                for (const e of expr.body) walk(e);
                break;
            case "match":
                walk(expr.target);
                for (const arm of expr.arms) {
                    for (const e of arm.body) walk(e);
                }
                break;
            case "lambda":
                // Nested lambda — its params shadow, but we still walk its body
                // to find free variables from OUR scope
                {
                    const innerParams = new Set(expr.params.map(p => p.name));
                    const innerFree = collectFreeVariables(
                        expr.body,
                        innerParams,
                        constGlobals,
                        fnSigs,
                    );
                    // Any free var from the inner lambda that isn't our param
                    // or locally defined is also free in our scope
                    for (const [name, info] of innerFree) {
                        if (
                            !paramNames.has(name) &&
                            !locallyDefined.has(name) &&
                            !constGlobals.has(name) &&
                            !fnSigs.has(name) &&
                            !BUILTIN_FUNCTIONS.has(name) &&
                            !free.has(name)
                        ) {
                            free.set(name, info);
                        }
                    }
                }
                break;
            case "array":
                for (const e of expr.elements) walk(e);
                break;
            case "tuple_expr":
                for (const e of expr.elements) walk(e);
                break;
            case "record_expr":
                for (const f of expr.fields) walk(f.value);
                break;
            case "enum_constructor":
                for (const f of expr.fields) walk(f.value);
                break;
            case "access":
                walk(expr.target);
                break;
            case "string_interp":
                for (const p of expr.parts) walk(p);
                break;
            case "literal":
                break;
        }
    }

    for (const expr of body) walk(expr);
    return free;
}

// =============================================================================
// Closure helpers
// =============================================================================

/**
 * Allocate a closure pair on the heap: [table_index: i32, env_ptr: i32].
 * Returns a block expression that evaluates to the pair's heap pointer.
 */
function allocClosurePair(
    mod: binaryen.Module,
    ctx: FunctionContext,
    tableIndexExpr: binaryen.ExpressionRef,
    envPtrExpr: binaryen.ExpressionRef,
    uniqueId: string,
): binaryen.ExpressionRef {
    const ptrIndex = ctx.addLocal(`__closure_ptr_${uniqueId}`, binaryen.i32);

    return mod.block(null, [
        // ptr = __heap_ptr
        mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32)),
        // __heap_ptr += 8
        mod.global.set(
            "__heap_ptr",
            mod.i32.add(
                mod.local.get(ptrIndex, binaryen.i32),
                mod.i32.const(8),
            ),
        ),
        // store table_index at offset 0
        mod.i32.store(0, 0,
            mod.local.get(ptrIndex, binaryen.i32),
            tableIndexExpr,
        ),
        // store env_ptr at offset 4
        mod.i32.store(4, 0,
            mod.local.get(ptrIndex, binaryen.i32),
            envPtrExpr,
        ),
        // return the pair pointer
        mod.local.get(ptrIndex, binaryen.i32),
    ], binaryen.i32);
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
                compileFunction(def, mod, strings, fnSigs, constGlobals, recordLayouts, enumLayouts, errors, fnTableIndices, tableFunctions);
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
    mod: binaryen.Module,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    constGlobals: Map<string, binaryen.Type>,
    recordLayouts: Map<string, RecordLayout>,
    enumLayouts: Map<string, EnumLayout>,
    errors: StructuredError[],
    fnTableIndices: Map<string, number> = new Map(),
    tableFunctions: string[] = [],
): void {
    const params = fn.params.map((p) => ({
        name: p.name,
        edictType: p.type,
        wasmType: edictTypeToWasm(p.type),
        edictTypeName: p.type.kind === "named" ? p.type.name : undefined,
    }));

    // Closure convention: all user functions have __env:i32 as first WASM param.
    // The __env param is ignored for non-lambda functions but ensures uniform
    // call_indirect signatures when functions are used as values.
    const allParams = [
        { name: "__env", wasmType: binaryen.i32 as binaryen.Type, edictTypeName: undefined },
        ...params.map((p) => ({ name: p.name, wasmType: p.wasmType, edictTypeName: p.edictTypeName })),
    ];

    const ctx = new FunctionContext(
        allParams,
        constGlobals,
        recordLayouts,
        enumLayouts,
        fnTableIndices,
        tableFunctions,
    );

    const returnType = edictTypeToWasm(fn.returnType);
    const paramTypes = allParams.map((p) => p.wasmType);
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
    errors: StructuredError[],
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

        case "string_interp":
            return compileStringInterp(expr as Expression & { kind: "string_interp" }, mod, ctx, strings, fnSigs, errors);

        default:
            errors.push(wasmValidationError(`unsupported expression kind: ${(expr as any).kind}`));
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
    // Check function table — return a closure pair (table_index, env_ptr=0)
    // This enables `let f = myFunc` to store a function reference as a closure
    const tableIndex = ctx.fnTableIndices.get(expr.name);
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
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
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
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
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
            errors.push(wasmValidationError(`unsupported unop: ${expr.op}`));
            return mod.unreachable();
    }
}

function compileCall(
    expr: Expression & { kind: "call" },
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
): binaryen.ExpressionRef {
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
                            const ptrExpr = compileExpr(arg, mod, ctx, strings, fnSigs, errors);
                            wasmArgs.push(ptrExpr);
                            wasmArgs.push(mod.global.get("__str_ret_len", binaryen.i32));
                        }
                    } else {
                        // Non-string param — compile normally
                        wasmArgs.push(compileExpr(arg, mod, ctx, strings, fnSigs, errors));
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
        const isUserFn = ctx.fnTableIndices.has(fnName);
        const args = expr.args.map((a, i) => {
            const compiled = compileExpr(a, mod, ctx, strings, fnSigs, errors);
            // Coerce i32→f64 if function expects f64 but arg infers to i32
            const sig = fnSigs.get(fnName);
            // For user functions, paramTypes[0] is __env, so Edict arg i maps to paramTypes[i+1]
            // For builtins, paramTypes maps directly (no __env)
            const paramIdx = isUserFn ? i + 1 : i;
            if (sig?.paramTypes && sig.paramTypes[paramIdx] === binaryen.f64) {
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
        // Prepend dummy __env = 0 only for user-defined functions (not builtins)
        const callArgs = isUserFn ? [mod.i32.const(0), ...args] : args;
        return mod.call(fnName, callArgs, returnType);
    }

    // === Indirect call path (call_indirect via function table) ===
    // The fn expression evaluates to a closure pair pointer: [table_index, env_ptr]
    const closurePtr = compileExpr(expr.fn, mod, ctx, strings, fnSigs, errors);

    // We need to decompose the closure pair, so store it in a temp local
    const closurePtrLocal = ctx.addLocal(`__call_closure_${expr.id}`, binaryen.i32);

    // Compile arguments
    const args = expr.args.map(a =>
        compileExpr(a, mod, ctx, strings, fnSigs, errors),
    );

    // Determine the WASM type signature for call_indirect:
    // - params: __env (i32) + inferred from compiled argument types
    // - result: infer from the overall call expression type
    const argWasmTypes = expr.args.map(a => inferExprWasmType(a, ctx, fnSigs));
    const allParamTypes = [binaryen.i32, ...argWasmTypes]; // __env + user args
    const paramType = binaryen.createType(allParamTypes);
    const resultType = inferExprWasmType(expr as Expression, ctx, fnSigs);

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
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
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
    errors: StructuredError[],
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
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
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
    errors: StructuredError[],
): binaryen.ExpressionRef {
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
                    const enumLayout = ctx.enumLayouts.get(targetEdictTypeName);
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
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
): binaryen.ExpressionRef {
    const layout = ctx.recordLayouts.get(expr.name);
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
    errors: StructuredError[],
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
    errors: StructuredError[],
): binaryen.ExpressionRef {
    const enumLayout = ctx.enumLayouts.get(expr.enumName);
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
    errors: StructuredError[],
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
        errors.push(wasmValidationError(`cannot resolve record type for field access '${expr.field}'`));
        return mod.unreachable();
    }

    const layout = ctx.recordLayouts.get(recordTypeName);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${recordTypeName}`));
        return mod.unreachable();
    }

    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
    if (!fieldLayout) {
        errors.push(wasmValidationError(`unknown field '${expr.field}' on record '${recordTypeName}'`));
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
    errors: StructuredError[],
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
    errors: StructuredError[],
): binaryen.ExpressionRef {
    // Compile as a module-level helper function with a generated name
    const lambdaName = `__lambda_${lambdaCounter++}`;

    const params = expr.params.map((p) => ({
        name: p.name,
        wasmType: edictTypeToWasm(p.type),
    }));

    // Detect free variables (captures from enclosing scope)
    const paramNames = new Set(expr.params.map(p => p.name));
    const freeVars = collectFreeVariables(
        expr.body, paramNames, ctx.constGlobals, fnSigs,
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

    const lambdaCtx = new FunctionContext(
        allLambdaParams,
        ctx.constGlobals,
        ctx.recordLayouts,
        ctx.enumLayouts,
        ctx.fnTableIndices,
        ctx.tableFunctions,
    );

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
    const tableIndex = ctx.tableFunctions.length;
    ctx.fnTableIndices.set(lambdaName, tableIndex);
    ctx.tableFunctions.push(lambdaName);

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
                const globalType = ctx.constGlobals.get(capture.name);
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
    mod: binaryen.Module,
    ctx: FunctionContext,
    strings: StringTable,
    fnSigs: Map<string, FunctionSig>,
    errors: StructuredError[],
): binaryen.ExpressionRef {
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
        return compileExpr(part, mod, ctx, strings, fnSigs, errors);
    }

    // Helper: compile a part and return [ptrExpr, lenExpr]
    function compilePart(part: Expression): [binaryen.ExpressionRef, binaryen.ExpressionRef] {
        if (part.kind === "literal" && typeof part.value === "string") {
            const interned = strings.intern(part.value);
            return [mod.i32.const(interned.offset), mod.i32.const(interned.length)];
        }
        const ptrExpr = compileExpr(part, mod, ctx, strings, fnSigs, errors);
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

// =============================================================================
// HOF Array Builtin WASM Generation
// =============================================================================
// These builtins need call_indirect to invoke closure arguments, so they
// are generated as internal WASM functions rather than host imports.
//
// Array layout: [length:i32][elem0:i32][elem1:i32]...
// Closure pair: [table_index:i32][env_ptr:i32]
// Closure calling convention: call_indirect(table, idx, [env_ptr, ...args])

/**
 * Generate array_map(arrPtr: i32, closurePtr: i32) → i32
 *
 * Allocates a new array, maps each element through the closure, returns result ptr.
 */
function generateArrayMap(mod: binaryen.Module): void {
    // Params: arrPtr=0, closurePtr=1
    // Locals: length=2, tableIdx=3, envPtr=4, resultPtr=5, i=6
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // resultPtr
        binaryen.i32, // i
    ];

    const arrPtr = 0, closurePtr = 1, length = 2, tableIdx = 3, envPtr = 4, resultPtr = 5, idx = 6;

    // callbackType: (env:i32, elem:i32) → i32
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32]);

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // resultPtr = __heap_ptr
        mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
        // __heap_ptr += 4 + length * 4
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.global.get("__heap_ptr", binaryen.i32),
            mod.i32.add(mod.i32.const(4), mod.i32.mul(mod.local.get(length, binaryen.i32), mod.i32.const(4))),
        )),
        // i32.store(resultPtr, 0, length)
        mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.local.get(length, binaryen.i32)),
        // i = 0
        mod.local.set(idx, mod.i32.const(0)),
        // loop
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("map_loop", mod.block(null, [
                // result[i] = call_indirect(tableIdx, [envPtr, arr[i]])
                mod.i32.store(
                    4, 0, // offset 4 + i*4 from resultPtr
                    mod.i32.add(mod.local.get(resultPtr, binaryen.i32), mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4))),
                    mod.call_indirect(
                        "__fn_table",
                        mod.local.get(tableIdx, binaryen.i32),
                        [
                            mod.local.get(envPtr, binaryen.i32),
                            // arr[i] = i32.load(arrPtr + 4 + i*4)
                            mod.i32.load(4, 0, mod.i32.add(
                                mod.local.get(arrPtr, binaryen.i32),
                                mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                            )),
                        ],
                        callbackParamType,
                        binaryen.i32,
                    ),
                ),
                // i++
                mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                // br_if map_loop (i < length)
                mod.br("map_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),
        // return resultPtr
        mod.local.get(resultPtr, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_map", paramType, binaryen.i32, vars, body);
}

/**
 * Generate array_filter(arrPtr: i32, closurePtr: i32) → i32
 *
 * Single-pass overalloc: allocates max-length result, filters in one pass,
 * then writes actual count. Tail waste is acceptable (arena allocator).
 */
function generateArrayFilter(mod: binaryen.Module): void {
    // Params: arrPtr=0, closurePtr=1
    // Locals: length=2, tableIdx=3, envPtr=4, resultPtr=5, i=6, count=7, elem=8
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // resultPtr
        binaryen.i32, // i
        binaryen.i32, // count
        binaryen.i32, // elem
    ];

    const arrPtr = 0, closurePtr = 1, length = 2, tableIdx = 3, envPtr = 4, resultPtr = 5, idx = 6, count = 7, elem = 8;

    // callbackType: (env:i32, elem:i32) → i32 (bool)
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32]);

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // resultPtr = __heap_ptr (overalloc: 4 + length*4)
        mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.global.get("__heap_ptr", binaryen.i32),
            mod.i32.add(mod.i32.const(4), mod.i32.mul(mod.local.get(length, binaryen.i32), mod.i32.const(4))),
        )),
        // count = 0, i = 0
        mod.local.set(count, mod.i32.const(0)),
        mod.local.set(idx, mod.i32.const(0)),
        // loop
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("filter_loop", mod.block(null, [
                // elem = arr[i]
                mod.local.set(elem, mod.i32.load(4, 0, mod.i32.add(
                    mod.local.get(arrPtr, binaryen.i32),
                    mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                ))),
                // if call_indirect(tableIdx, [envPtr, elem]) != 0
                mod.if(
                    mod.call_indirect(
                        "__fn_table",
                        mod.local.get(tableIdx, binaryen.i32),
                        [
                            mod.local.get(envPtr, binaryen.i32),
                            mod.local.get(elem, binaryen.i32),
                        ],
                        callbackParamType,
                        binaryen.i32,
                    ),
                    mod.block(null, [
                        // result[count] = elem
                        mod.i32.store(
                            4, 0,
                            mod.i32.add(mod.local.get(resultPtr, binaryen.i32), mod.i32.mul(mod.local.get(count, binaryen.i32), mod.i32.const(4))),
                            mod.local.get(elem, binaryen.i32),
                        ),
                        // count++
                        mod.local.set(count, mod.i32.add(mod.local.get(count, binaryen.i32), mod.i32.const(1))),
                    ], binaryen.none),
                ),
                // i++
                mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                // br_if filter_loop (i < length)
                mod.br("filter_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),
        // Write actual count as result length
        mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.local.get(count, binaryen.i32)),
        // return resultPtr
        mod.local.get(resultPtr, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_filter", paramType, binaryen.i32, vars, body);
}

/**
 * Generate array_reduce(arrPtr: i32, init: i32, closurePtr: i32) → i32
 *
 * Folds array elements into an accumulator via the closure.
 */
function generateArrayReduce(mod: binaryen.Module): void {
    // Params: arrPtr=0, init=1, closurePtr=2
    // Locals: length=3, tableIdx=4, envPtr=5, acc=6, i=7
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // acc
        binaryen.i32, // i
    ];

    const arrPtr = 0, init = 1, closurePtr = 2, length = 3, tableIdx = 4, envPtr = 5, acc = 6, idx = 7;

    // callbackType: (env:i32, acc:i32, elem:i32) → i32
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]);

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // acc = init
        mod.local.set(acc, mod.local.get(init, binaryen.i32)),
        // i = 0
        mod.local.set(idx, mod.i32.const(0)),
        // loop
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("reduce_loop", mod.block(null, [
                // acc = call_indirect(tableIdx, [envPtr, acc, arr[i]])
                mod.local.set(acc, mod.call_indirect(
                    "__fn_table",
                    mod.local.get(tableIdx, binaryen.i32),
                    [
                        mod.local.get(envPtr, binaryen.i32),
                        mod.local.get(acc, binaryen.i32),
                        mod.i32.load(4, 0, mod.i32.add(
                            mod.local.get(arrPtr, binaryen.i32),
                            mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                        )),
                    ],
                    callbackParamType,
                    binaryen.i32,
                )),
                // i++
                mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                // br_if reduce_loop (i < length)
                mod.br("reduce_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),
        // return acc
        mod.local.get(acc, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_reduce", paramType, binaryen.i32, vars, body);
}
