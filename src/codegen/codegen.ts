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
} from "../ast/nodes.js";

import { StringTable } from "./string-table.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { type StructuredError, wasmValidationError } from "../errors/structured-errors.js";
import { collectStrings } from "./collect-strings.js";
import { generateWasmBuiltins } from "../builtins/registry.js";
import {
    type CompilationContext,
    type CompileResult,
    type CompileSuccess,
    type CompileFailure,
    type CompileOptions,
    type FunctionSig,
    type DebugMetadata,

    type FieldLayout,
    type EnumVariantLayout,
    type EnumLayout,
    type RecordLayout,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { inferImportSignatures } from "./imports.js";
import { compileExpr, inferExprWasmType } from "./compile-expr.js";

// Re-export types for backwards compatibility
export type { CompileResult, CompileSuccess, CompileFailure, CompileOptions, DebugMetadata };
export type { FieldLayout, EnumVariantLayout, EnumLayout, RecordLayout };

// Re-export expression compilation functions (moved to compile-expr.ts)
export { compileExpr, inferExprWasmType };





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

        // Debug metadata: map function names → AST nodeIds (always built, zero-cost side-table)
        const fnMap: Record<string, string> = {};
        const debugFnNamePtrs = new Map<string, number>();
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                fnMap[def.name] = def.id;
            }
        }

        // Debug mode: intern function names BEFORE toMemorySegments so they're in the data section
        if (options?.debugMode) {
            for (const name of Object.keys(fnMap)) {
                const interned = strings.intern(name);
                debugFnNamePtrs.set(name, interned.offset);
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
        mod.addGlobal("__heap_start", binaryen.i32, false, mod.i32.const(heapStart));
        mod.addGlobal("__heap_ptr", binaryen.i32, true, mod.i32.const(heapStart));

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
                const wasmParamTypes: binaryen.Type[] = [binaryen.i32]; // __env
                for (const p of def.params) {
                    wasmParamTypes.push(edictTypeToWasm(p.type!));
                }
                fnSigs.set(def.name, {
                    returnType: def.returnType ? edictTypeToWasm(def.returnType) : (options?.typeInfo?.inferredReturnTypes.get(def.id) ? edictTypeToWasm(options.typeInfo.inferredReturnTypes.get(def.id)!) : binaryen.i32),
                    paramTypes: wasmParamTypes,
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

        // Import builtins — String params are single i32 (length-prefixed pointer)
        for (const [name, builtin] of BUILTIN_FUNCTIONS) {
            const [importModule, importBase] = builtin.wasmImport;
            // WASM-native builtins (HOFs) are generated as internal functions, not imported
            if (importModule === "__wasm") continue;
            const wasmParams: binaryen.Type[] = builtin.type.params.map(p => edictTypeToWasm(p));
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
        // Use declared types when available, fall back to inference for untyped imports
        const importedNames = new Set<string>();
        const typedImportNames = new Set<string>();
        for (const imp of module.imports) {
            for (const name of imp.names) {
                if (!BUILTIN_FUNCTIONS.has(name)) {
                    const declaredType = imp.types?.[name];
                    if (declaredType && declaredType.kind === "fn_type") {
                        // Typed import — derive WASM signature from declared type
                        const wasmParams: binaryen.Type[] = declaredType.params.map(p => edictTypeToWasm(p));
                        const wasmReturnType = edictTypeToWasm(declaredType.returnType);
                        mod.addFunctionImport(
                            name,
                            imp.module,
                            name,
                            wasmParams.length > 0
                                ? binaryen.createType(wasmParams)
                                : binaryen.none,
                            wasmReturnType,
                        );
                        fnSigs.set(name, { returnType: wasmReturnType, paramTypes: wasmParams });
                        typedImportNames.add(name);
                    } else {
                        importedNames.add(name);
                    }
                }
            }
        }

        if (importedNames.size > 0) {
            // Fallback: infer WASM types from call sites for untyped imports
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
            typeInfo: options?.typeInfo,
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

        // Debug mode: import trace host functions
        if (options?.debugMode) {
            mod.addFunctionImport(
                "__trace_enter", "debug", "__trace_enter",
                binaryen.createType([binaryen.i32]), binaryen.none,
            );
            mod.addFunctionImport(
                "__trace_exit", "debug", "__trace_exit",
                binaryen.createType([binaryen.i32]), binaryen.none,
            );
        }

        // Compile each function
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                compileFunction(def, cc, options?.debugMode ? debugFnNamePtrs : undefined);
            }
        }

        // Generate WASM-native HOF builtins from the unified registry
        generateWasmBuiltins(mod);

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

        // Arena reset — restore __heap_ptr to __heap_start (full arena wipe)
        mod.addFunction(
            "__heap_reset", binaryen.none, binaryen.none, [],
            mod.global.set("__heap_ptr", mod.global.get("__heap_start", binaryen.i32)),
        );
        mod.addFunctionExport("__heap_reset", "__heap_reset");

        // Heap start getter — expose the arena base address
        mod.addFunction(
            "__get_heap_start", binaryen.none, binaryen.i32, [],
            mod.global.get("__heap_start", binaryen.i32),
        );
        mod.addFunctionExport("__get_heap_start", "__get_heap_start");

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

        const result: CompileSuccess = { ok: true, wasm, ...(wat ? { wat } : {}) };
        if (options?.debugMode) {
            result.debugMetadata = { fnMap };
        }
        return result;
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
    debugFnNamePtrs?: Map<string, number>,
): void {
    const { mod } = cc;
    const params = fn.params.map((p) => {
        const resolvedType = cc.typeInfo?.inferredLambdaParamTypes.get(p.id) ?? p.type!;
        return {
            name: p.name,
            edictType: resolvedType,
            wasmType: edictTypeToWasm(resolvedType),
            edictTypeName: resolvedType.kind === "named" ? resolvedType.name : resolvedType.kind === "option" ? "Option" : resolvedType.kind === "result" ? "Result" : (resolvedType.kind === "basic" && resolvedType.name === "String") ? "String" : undefined,
        };
    });

    // Closure convention: all user functions have __env:i32 as first WASM param.
    // String params are just i32 (length-prefixed pointer) — no widening needed.
    const allParams: { name: string; wasmType: binaryen.Type; edictTypeName: string | undefined }[] = [
        { name: "__env", wasmType: binaryen.i32 as binaryen.Type, edictTypeName: undefined },
    ];
    for (const p of params) {
        allParams.push({ name: p.name, wasmType: p.wasmType, edictTypeName: p.edictTypeName });
    }

    const ctx = new FunctionContext(allParams);

    const returnType = fn.returnType
        ? edictTypeToWasm(fn.returnType)
        : (cc.typeInfo?.inferredReturnTypes.get(fn.id)
            ? edictTypeToWasm(cc.typeInfo.inferredReturnTypes.get(fn.id)!)
            : (fn.body.length > 0
                ? inferExprWasmType(fn.body[fn.body.length - 1]!, cc, ctx)
                : binaryen.none));
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

    // Debug mode: wrap body with __trace_enter at entry and __trace_exit at exit
    if (debugFnNamePtrs) {
        const namePtr = debugFnNamePtrs.get(fn.name);
        if (namePtr !== undefined) {
            const enterCall = mod.call("__trace_enter", [mod.i32.const(namePtr)], binaryen.none);
            const exitCall = mod.call("__trace_exit", [mod.i32.const(namePtr)], binaryen.none);

            if (returnType === binaryen.none) {
                // void function: enter, body, exit
                bodyExprs.unshift(enterCall);
                bodyExprs.push(exitCall);
            } else {
                // function with return value: enter, save result to temp, exit, return temp
                const tmpIdx = ctx.addLocal("__debug_ret", returnType);
                bodyExprs.unshift(enterCall);
                // Replace final expr with: set temp = final, exit, get temp
                const finalExpr = bodyExprs.pop()!;
                bodyExprs.push(mod.local.set(tmpIdx, finalExpr));
                bodyExprs.push(exitCall);
                bodyExprs.push(mod.local.get(tmpIdx, returnType));
            }
        }
    }

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


