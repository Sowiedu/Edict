// =============================================================================
// WASM Code Generator — compile(module) → CompileResult
// =============================================================================
// Transforms a validated Edict module AST into WASM bytecode via a pure-JS WASM encoder.
// Uses the IR pipeline: AST → lower → optimize → codegen.
//
// The IR carries pre-resolved types on every expression node, eliminating
// heuristic type inference (inferExprWasmType, isStringExpr, edictTypeName).

import * as binaryen from "./wasm-encoder.js";
import type { EdictModule } from "../ast/nodes.js";

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
import { compileIRExpr } from "./compile-ir-expr.js";
import { lowerModule } from "../ir/lower.js";
import { optimize } from "../ir/optimize.js";
import type { IRFunction, IRModule as IRModuleType, IRExpr } from "../ir/types.js";

// Re-export types for backwards compatibility
export type { CompileResult, CompileSuccess, CompileFailure, CompileOptions, DebugMetadata };
export type { FieldLayout, EnumVariantLayout, EnumLayout, RecordLayout };





// =============================================================================
// Compiler
// =============================================================================

/**
 * Compile a validated Edict module AST into WASM bytecode.
 *
 * Handles: Int/Float/Bool/String literals, binary/unary ops, function calls,
 * if/else, let bindings, blocks, match expressions, records, enums, lambdas,
 * closures, and all builtin functions.
 *
 * @param module - A fully checked Edict module AST
 * @param options - Optional compilation settings (typeInfo, debugMode, maxMemoryPages, emitWat)
 * @returns `{ ok: true, wasm }` on success, or `{ ok: false, errors }` on failure
 */
export function compile(module: EdictModule, options?: CompileOptions): CompileResult {
    const mod = new binaryen.Module();
    const strings = new StringTable();
    const errors: StructuredError[] = [];
    const maxPages = options?.maxMemoryPages ?? 16;

    try {
        // ─── IR Pipeline: lower AST → optimize → codegen ──────────────
        // The typeInfo is required for lowering. If not provided, create
        // a minimal stub (allows compilation of programs without type info,
        // though type-resolved info will be empty).
        const typeInfo = options?.typeInfo ?? {
            inferredReturnTypes: new Map(),
            inferredLetTypes: new Map(),
            inferredLambdaParamTypes: new Map(),
            callArgCoercions: new Map(),
            stringInterpCoercions: new Map(),
            resolvedCallSiteEffects: new Map(),
        };
        const irModule = optimize(lowerModule(module, typeInfo));

        // Pre-scan: intern all string literals (still walks AST — IR doesn't
        // change string locations and the AST is readily available)
        for (const def of module.definitions) {
            if (def.kind === "fn") {
                collectStrings(def.body, strings);
            }
            if (def.kind === "const") {
                collectStrings([def.value], strings);
            }
        }

        // Also collect strings from the optimized IR — constant folding can create
        // new string values (e.g. "hello " + "world" → "hello world") not in the AST
        collectIRStrings(irModule, strings);

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

        // Build RecordLayout / EnumLayout registries from IR definitions
        const recordLayouts = new Map<string, RecordLayout>();
        const enumLayouts = new Map<string, EnumLayout>();
        for (const rec of irModule.records) {
            const fields = rec.fields.map((f, i) => ({
                name: f.name,
                offset: i * 8,
                wasmType: edictTypeToWasm(f.resolvedType),
            }));
            recordLayouts.set(rec.name, { fields, totalSize: rec.fields.length * 8 });
        }
        for (const en of irModule.enums) {
            const variants = en.variants.map(v => {
                const fields = v.fields.map((f, i) => ({
                    name: f.name,
                    offset: 8 + i * 8,
                    wasmType: edictTypeToWasm(f.resolvedType),
                }));
                return {
                    name: v.name,
                    tag: v.tag,
                    fields,
                    totalSize: 8 + v.fields.length * 8,
                };
            });
            enumLayouts.set(en.name, { variants });
        }

        // Register built-in Option enum layout: None (tag 0), Some(value) (tag 1)
        if (!enumLayouts.has("Option")) {
            enumLayouts.set("Option", {
                variants: [
                    { name: "None", tag: 0, fields: [], totalSize: 8 },
                    { name: "Some", tag: 1, fields: [{ name: "value", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
                ],
            });
        }

        // Register built-in Result enum layout: Ok (tag 0), Err (tag 1)
        if (!enumLayouts.has("Result")) {
            enumLayouts.set("Result", {
                variants: [
                    { name: "Ok", tag: 0, fields: [{ name: "value", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
                    { name: "Err", tag: 1, fields: [{ name: "error", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
                ],
            });
        }

        // Initialize bump allocator heap pointer
        const heapStart = Math.max(8, Math.ceil(strings.totalBytes / 8) * 8);
        mod.addGlobal("__heap_start", binaryen.i32, false, mod.i32.const(heapStart));
        mod.addGlobal("__heap_ptr", binaryen.i32, true, mod.i32.const(heapStart));

        // Build function signature registry from IR functions
        const fnSigs = new Map<string, FunctionSig>();

        // Register builtins in fnSigs
        for (const [name, builtin] of BUILTIN_FUNCTIONS) {
            fnSigs.set(name, {
                returnType: edictTypeToWasm(builtin.type.returnType),
                paramTypes: builtin.type.params.map(p => edictTypeToWasm(p)),
            });
        }

        // Register user function sigs from IR (pre-resolved types — no heuristic fallback)
        for (const irFn of irModule.functions) {
            const wasmParamTypes: binaryen.Type[] = [binaryen.i32]; // __env
            for (const p of irFn.params) {
                wasmParamTypes.push(edictTypeToWasm(p.resolvedType));
            }
            // Empty-body functions → none return type (matches compileFunctionFromIR override)
            const returnType = irFn.body.length === 0
                ? binaryen.none
                : edictTypeToWasm(irFn.resolvedReturnType);
            fnSigs.set(irFn.name, {
                returnType,
                paramTypes: wasmParamTypes,
            });
        }

        // Function table for indirect calls (call_indirect)
        // Assign table indices to all IR functions (includes lifted lambdas)
        const tableFunctions: string[] = [];
        const fnTableIndices = new Map<string, number>();
        for (const irFn of irModule.functions) {
            fnTableIndices.set(irFn.name, tableFunctions.length);
            tableFunctions.push(irFn.name);
        }

        // Import builtins
        for (const [name, builtin] of BUILTIN_FUNCTIONS) {
            const [importModule, importBase] = builtin.wasmImport;
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
        const importedNames = new Set<string>();
        const typedImportNames = new Set<string>();
        for (const imp of module.imports) {
            for (const name of imp.names) {
                if (!BUILTIN_FUNCTIONS.has(name)) {
                    const declaredType = imp.types?.[name];
                    if (declaredType && declaredType.kind === "fn_type") {
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

        // Compile const definitions from IR
        const constGlobals = new Map<string, binaryen.Type>();

        const cc: CompilationContext = {
            mod, strings, fnSigs, errors,
            constGlobals, recordLayouts, enumLayouts, fnTableIndices, tableFunctions,
            lambdaCounter: 0,
            typeInfo: options?.typeInfo,
        };

        for (const irConst of irModule.constants) {
            const wasmType = edictTypeToWasm(irConst.resolvedType);
            const tmpCtx = new FunctionContext([]);
            const initExpr = compileIRExpr(irConst.value, cc, tmpCtx);
            mod.addGlobal(irConst.name, wasmType, false, initExpr);
            constGlobals.set(irConst.name, wasmType);
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

        // Compile each IR function
        for (const irFn of irModule.functions) {
            compileFunctionFromIR(irFn, cc, options?.debugMode ? debugFnNamePtrs : undefined);
        }

        // Generate WASM-native HOF builtins from the unified registry
        generateWasmBuiltins(mod);

        // Build function table for indirect calls (call_indirect)
        mod.addTable("__fn_table", tableFunctions.length, tableFunctions.length);
        if (tableFunctions.length > 0) {
            mod.addActiveElementSegment(
                "__fn_table", "__fn_elems", tableFunctions, mod.i32.const(0),
            );
        }

        // Export the "main" function if it exists
        const mainFn = irModule.functions.find(f => f.name === "main");
        if (mainFn) {
            mod.addFunctionExport("main", "main");
        }

        // Export getter/setter functions for globals needed by host builtins
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
            "__heap_reset", binaryen.none, binaryen.none, [],
            mod.global.set("__heap_ptr", mod.global.get("__heap_start", binaryen.i32)),
        );
        mod.addFunctionExport("__heap_reset", "__heap_reset");

        mod.addFunction(
            "__get_heap_start", binaryen.none, binaryen.i32, [],
            mod.global.get("__heap_start", binaryen.i32),
        );
        mod.addFunctionExport("__get_heap_start", "__get_heap_start");

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
// IR Function compilation — replaces legacy compileFunction
// =============================================================================

/**
 * Compile an IR function to WASM.
 *
 * Reads pre-resolved types from the IR — no heuristic type inference:
 * - Return type: `irFn.resolvedReturnType` (replaces 3-way fallback)
 * - Param types: `irParam.resolvedType` (replaces edictTypeName chain)
 * - Body compilation: `compileIRExpr` (replaces compileExpr + inferExprWasmType)
 */
function compileFunctionFromIR(
    irFn: IRFunction,
    cc: CompilationContext,
    debugFnNamePtrs?: Map<string, number>,
): void {
    const { mod } = cc;

    // Build parameter list with pre-resolved types from IR
    const allParams: { name: string; wasmType: binaryen.Type; edictTypeName: string | undefined; edictType?: import("../ast/types.js").TypeExpr }[] = [
        { name: "__env", wasmType: binaryen.i32, edictTypeName: undefined },
    ];
    for (const p of irFn.params) {
        const wasmType = edictTypeToWasm(p.resolvedType);
        // Derive edictTypeName from resolvedType (replaces heuristic chain)
        let edictTypeName: string | undefined;
        if (p.resolvedType.kind === "named") edictTypeName = p.resolvedType.name;
        else if (p.resolvedType.kind === "option") edictTypeName = "Option";
        else if (p.resolvedType.kind === "result") edictTypeName = "Result";
        else if (p.resolvedType.kind === "basic" && p.resolvedType.name === "String") edictTypeName = "String";
        else if (p.resolvedType.kind === "tuple") edictTypeName = "__tuple";

        allParams.push({ name: p.name, wasmType, edictTypeName, edictType: p.resolvedType });
    }

    const ctx = new FunctionContext(allParams);

    // Closure env unpacking: for lifted lambdas, load captured variables from __env
    const closureEnvLoads: binaryen.ExpressionRef[] = [];
    if (irFn.closureEnv.length > 0) {
        let offset = 0;
        for (const capture of irFn.closureEnv) {
            const wasmType = edictTypeToWasm(capture.resolvedType);
            const localIdx = ctx.addLocal(capture.name, wasmType);
            const envParam = ctx.getLocal("__env");
            if (envParam) {
                const load = wasmType === binaryen.f64
                    ? mod.f64.load(offset, 0, mod.local.get(envParam.index, binaryen.i32))
                    : mod.i32.load(offset, 0, mod.local.get(envParam.index, binaryen.i32));
                closureEnvLoads.push(mod.local.set(localIdx, load));
            }
            offset += 8;
        }
    }

    // Return type from IR — override to none for empty-body functions
    // (the lowering defaults to UNKNOWN_TYPE=Int for empty bodies, but they should be void)
    const returnType = irFn.body.length === 0
        ? binaryen.none
        : edictTypeToWasm(irFn.resolvedReturnType);

    const paramTypes = allParams.map(p => p.wasmType);
    const paramType = paramTypes.length > 0
        ? binaryen.createType(paramTypes)
        : binaryen.none;

    // Compile body from IR expressions
    const bodyExprs = [
        ...closureEnvLoads,
        ...irFn.body.map((irExpr, i) => {
            const compiled = compileIRExpr(irExpr, cc, ctx);
            // Non-final expressions that produce values must be dropped
            if (i < irFn.body.length - 1 && irExpr.kind !== "ir_let") {
                return mod.drop(compiled);
            }
            return compiled;
        }),
    ];

    // Fixup: if the last body expression is `ir_let` and the function returns a value,
    // append a local.get to re-read the just-bound variable
    if (returnType !== binaryen.none && irFn.body.length > 0) {
        const lastExpr = irFn.body[irFn.body.length - 1]!;
        if (lastExpr.kind === "ir_let") {
            const local = ctx.getLocal(lastExpr.name);
            if (local) bodyExprs.push(mod.local.get(local.index, local.type));
        }
    }

    // Debug mode: wrap body with __trace_enter and __trace_exit
    if (debugFnNamePtrs) {
        const namePtr = debugFnNamePtrs.get(irFn.name);
        if (namePtr !== undefined) {
            const enterCall = mod.call("__trace_enter", [mod.i32.const(namePtr)], binaryen.none);
            const exitCall = mod.call("__trace_exit", [mod.i32.const(namePtr)], binaryen.none);

            if (returnType === binaryen.none) {
                bodyExprs.unshift(enterCall);
                bodyExprs.push(exitCall);
            } else {
                const tmpIdx = ctx.addLocal("__debug_ret", returnType);
                bodyExprs.unshift(enterCall);
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

    mod.addFunction(irFn.name, paramType, returnType, ctx.varTypes, body);
}


// =============================================================================
// IR String Collection — scan optimized IR for string literals
// =============================================================================
// Constant folding can produce new strings (e.g. "hello " + "world" → "hello world")
// that don't exist in the original AST. These must be interned before
// toMemorySegments() finalizes the string data section.

function collectIRStrings(irModule: IRModuleType, strings: StringTable): void {
    for (const fn of irModule.functions) {
        for (const expr of fn.body) collectIRStringExpr(expr, strings);
    }
    for (const c of irModule.constants) {
        collectIRStringExpr(c.value, strings);
    }
}

function collectIRStringExpr(expr: IRExpr, strings: StringTable): void {
    switch (expr.kind) {
        case "ir_literal":
            if (typeof expr.value === "string") strings.intern(expr.value);
            break;
        case "ir_binop":
            collectIRStringExpr(expr.left, strings);
            collectIRStringExpr(expr.right, strings);
            break;
        case "ir_unop":
            collectIRStringExpr(expr.operand, strings);
            break;
        case "ir_call":
            collectIRStringExpr(expr.fn, strings);
            for (const a of expr.args) collectIRStringExpr(a, strings);
            break;
        case "ir_if":
            collectIRStringExpr(expr.condition, strings);
            for (const e of expr.then) collectIRStringExpr(e, strings);
            for (const e of expr.else) collectIRStringExpr(e, strings);
            break;
        case "ir_let":
            collectIRStringExpr(expr.value, strings);
            break;
        case "ir_block":
            for (const e of expr.body) collectIRStringExpr(e, strings);
            break;
        case "ir_match":
            collectIRStringExpr(expr.target, strings);
            for (const arm of expr.arms) {
                for (const e of arm.body) collectIRStringExpr(e, strings);
            }
            break;
        case "ir_record":
        case "ir_enum_constructor":
            for (const f of expr.fields) collectIRStringExpr(f.value, strings);
            break;
        case "ir_array":
        case "ir_tuple":
            for (const e of expr.elements) collectIRStringExpr(e, strings);
            break;
        case "ir_access":
            collectIRStringExpr(expr.target, strings);
            break;
        case "ir_string_interp":
            for (const p of expr.parts) collectIRStringExpr(p.expr, strings);
            break;
    }
}
