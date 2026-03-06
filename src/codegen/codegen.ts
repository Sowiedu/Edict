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
} from "../ast/nodes.js";

import { StringTable } from "./string-table.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { type StructuredError, wasmValidationError } from "../errors/structured-errors.js";
import { collectStrings } from "./collect-strings.js";
import { generateArrayMap, generateArrayFilter, generateArrayReduce, generateArrayFind, generateArraySort } from "./hof-generators.js";
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
import { compileLiteral, compileIdent, compileBinop, compileUnop, compileIf, compileLet, compileBlock } from "./compile-scalars.js";
import { compileCall, compileLambdaExpr } from "./compile-calls.js";
import { compileRecordExpr, compileTupleExpr, compileEnumConstructor, compileAccess, compileArrayExpr, compileStringInterp } from "./compile-data.js";
import { compileMatch } from "./compile-match.js";

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
export function inferExprWasmType(
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
        generateArrayFind(mod);
        generateArraySort(mod);

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

export function compileExpr(
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

