// =============================================================================
// Call and lambda expression compilers
// =============================================================================

import binaryen from "binaryen";
import type { Expression } from "../ast/nodes.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { collectFreeVariables, allocClosurePair } from "./closures.js";
import { compileExpr, inferExprWasmType } from "./codegen.js";
import { StringTable } from "./string-table.js";

// =============================================================================
// String argument expansion helpers
// =============================================================================

/**
 * Expand a String-typed argument into [ptr, len] WASM expressions.
 * Handles literals (compile-time known), idents (companion __str_len_ local),
 * and generic expressions (falls back to __str_ret_len global).
 */
function expandStringArg(
    arg: Expression,
    cc: CompilationContext,
    ctx: FunctionContext,
    strings: StringTable,
): [binaryen.ExpressionRef, binaryen.ExpressionRef] {
    const { mod } = cc;
    if (arg.kind === "literal" && typeof arg.value === "string") {
        const interned = strings.intern(arg.value);
        return [mod.i32.const(interned.offset), mod.i32.const(interned.length)];
    }
    if (arg.kind === "ident") {
        const ptrExpr = compileExpr(arg, cc, ctx);
        const lenLocal = ctx.getLocal(`__str_len_${arg.name}`);
        if (lenLocal) {
            return [ptrExpr, mod.local.get(lenLocal.index, binaryen.i32)];
        }
        return [ptrExpr, mod.global.get("__str_ret_len", binaryen.i32)];
    }
    // Generic expression (call result, etc.) — __str_ret_len is fresh
    const ptrExpr = compileExpr(arg, cc, ctx);
    return [ptrExpr, mod.global.get("__str_ret_len", binaryen.i32)];
}

/**
 * Check if an expression produces a String value.
 * Used by the indirect call path to decide whether to expand args.
 */
function isStringExpression(
    expr: Expression,
    _cc: CompilationContext,
    ctx: FunctionContext,
): boolean {
    if (expr.kind === "literal" && typeof expr.value === "string") return true;
    if (expr.kind === "string_interp") return true;
    if (expr.kind === "ident") {
        const local = ctx.getLocal(expr.name);
        if (local?.edictTypeName === "String") return true;
        // Check if companion __str_len_ exists (String value)
        if (ctx.getLocal(`__str_len_${expr.name}`)) return true;
    }
    if (expr.kind === "call" && expr.fn.kind === "ident") {
        // Check builtins return type
        const builtin = BUILTIN_FUNCTIONS.get(expr.fn.name);
        if (builtin?.type.returnType.kind === "basic" && builtin.type.returnType.name === "String") return true;
    }
    return false;
}

export function compileCall(
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
                        } else if (arg.kind === "ident") {
                            // String variable — use companion __str_len_ local if available,
                            // otherwise fall back to __str_ret_len (stale, but best effort)
                            const ptrExpr = compileExpr(arg, cc, ctx);
                            wasmArgs.push(ptrExpr);
                            const lenLocal = ctx.getLocal(`__str_len_${arg.name}`);
                            if (lenLocal) {
                                wasmArgs.push(mod.local.get(lenLocal.index, binaryen.i32));
                            } else {
                                wasmArgs.push(mod.global.get("__str_ret_len", binaryen.i32));
                            }
                        } else {
                            // Non-literal, non-ident string expr (e.g. direct call result)
                            // __str_ret_len is fresh from the just-evaluated expression
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
        const sig = fnSigs.get(fnName);
        const returnType = sig ? sig.returnType : binaryen.i32;

        // For user functions with String params, expand them to (ptr, len) pairs
        if (isUserFn && sig?.edictParamTypes) {
            const wasmArgs: binaryen.ExpressionRef[] = [mod.i32.const(0)]; // __env

            for (let i = 0; i < expr.args.length; i++) {
                const arg = expr.args[i]!;
                // edictParamTypes[0] is __env, so Edict param i → edictParamTypes[i+1]
                const isStringParam = sig.edictParamTypes[i + 1] === "String";

                if (isStringParam) {
                    wasmArgs.push(...expandStringArg(arg, cc, ctx, strings));
                } else {
                    const compiled = compileExpr(arg, cc, ctx);
                    // Coerce i32→f64 if function expects f64 but arg infers to i32
                    if (sig.paramTypes) {
                        // Map Edict arg index to WASM param index (account for __env + String expansion)
                        const wasmIdx = wasmArgs.length;
                        if (sig.paramTypes[wasmIdx] === binaryen.f64) {
                            const argType = inferExprWasmType(arg, cc, ctx);
                            if (argType === binaryen.i32) {
                                wasmArgs.push(mod.f64.convert_s.i32(compiled));
                                continue;
                            }
                        }
                    }
                    wasmArgs.push(compiled);
                }
            }

            return mod.call(fnName, wasmArgs, returnType);
        }

        // Non-user function (builtins without String params, imports)
        const args = expr.args.map((a, i) => {
            const compiled = compileExpr(a, cc, ctx);
            // Coerce i32→f64 if function expects f64 but arg infers to i32
            const paramIdx = isUserFn ? i + 1 : i;
            if (sig?.paramTypes && sig.paramTypes[paramIdx] === binaryen.f64) {
                const argType = inferExprWasmType(a, cc, ctx);
                if (argType === binaryen.i32) {
                    return mod.f64.convert_s.i32(compiled);
                }
            }
            return compiled;
        });
        // Prepend dummy __env = 0 only for user-defined functions (not builtins)
        const callArgs = isUserFn ? [mod.i32.const(0), ...args] : args;
        return mod.call(fnName, callArgs, returnType);
    }

    // === Indirect call path (call_indirect via function table) ===
    // The fn expression evaluates to a closure pair pointer: [table_index, env_ptr]
    const closurePtr = compileExpr(expr.fn, cc, ctx);

    // We need to decompose the closure pair, so store it in a temp local
    const closurePtrLocal = ctx.addLocal(`__call_closure_${expr.id}`, binaryen.i32);

    // Compile arguments — expand String args to (ptr, len) pairs
    const wasmArgs: binaryen.ExpressionRef[] = [];
    const wasmArgTypes: binaryen.Type[] = [];
    for (const a of expr.args) {
        const argType = inferExprWasmType(a, cc, ctx);
        // Check if this argument is a String type (i32 that's actually a String)
        const isStringArg = isStringExpression(a, cc, ctx);
        if (isStringArg) {
            const [ptr, len] = expandStringArg(a, cc, ctx, strings);
            wasmArgs.push(ptr, len);
            wasmArgTypes.push(binaryen.i32, binaryen.i32);
        } else {
            wasmArgs.push(compileExpr(a, cc, ctx));
            wasmArgTypes.push(argType);
        }
    }

    // Determine the WASM type signature for call_indirect:
    // - params: __env (i32) + widened argument types
    // - result: infer from the overall call expression type
    const allParamTypes = [binaryen.i32, ...wasmArgTypes]; // __env + user args
    const paramType = binaryen.createType(allParamTypes);
    const resultType = inferExprWasmType(expr as Expression, cc, ctx);

    // Load table_index and env_ptr from the closure pair
    const tableIdx = mod.i32.load(0, 0, mod.local.get(closurePtrLocal, binaryen.i32));
    const envPtr = mod.i32.load(4, 0, mod.local.get(closurePtrLocal, binaryen.i32));

    return mod.block(null, [
        // Store closure pointer in temp
        mod.local.set(closurePtrLocal, closurePtr),
        // call_indirect with env_ptr prepended to args
        mod.call_indirect("__fn_table", tableIdx, [envPtr, ...wasmArgs], paramType, resultType),
    ], resultType);
}

export function compileLambdaExpr(
    expr: Expression & { kind: "lambda" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
    // Compile as a module-level helper function with a generated name
    const lambdaName = `__lambda_${cc.lambdaCounter++}`;

    const params = expr.params.map((p) => {
        const resolvedType = cc.typeInfo?.inferredLambdaParamTypes.get(p.id) ?? p.type!;
        return {
            name: p.name,
            edictType: resolvedType,
            wasmType: edictTypeToWasm(resolvedType),
        };
    });

    // Detect free variables (captures from enclosing scope)
    const paramNames = new Set(expr.params.map(p => p.name));
    const freeVars = collectFreeVariables(
        expr.body, paramNames, cc.constGlobals, fnSigs,
    );

    // Resolve WASM types for free variables from the enclosing context
    // For String free vars, also capture the companion __str_len_ local
    const captures: { name: string; wasmType: binaryen.Type; offset: number }[] = [];
    let envOffset = 0;
    for (const [name] of freeVars) {
        const local = ctx.getLocal(name);
        const wasmType = local ? local.type : binaryen.i32;
        captures.push({ name, wasmType, offset: envOffset });
        envOffset += 8; // 8-byte slots (supports both i32 and f64)
        // If this is a String variable, also capture its companion length
        const lenLocal = ctx.getLocal(`__str_len_${name}`);
        if (lenLocal) {
            captures.push({ name: `__str_len_${name}`, wasmType: binaryen.i32, offset: envOffset });
            envOffset += 8;
        }
    }

    // Build lambda context with __env as first param + lambda's own params
    // String params are widened to (ptr, len) pairs
    const allLambdaParams: { name: string; wasmType: binaryen.Type }[] = [
        { name: "__env", wasmType: binaryen.i32 as binaryen.Type },
    ];
    const edictParamTypes: ("String" | "other")[] = ["other"]; // __env
    for (const p of params) {
        if (p.edictType.kind === "basic" && p.edictType.name === "String") {
            allLambdaParams.push({ name: p.name, wasmType: binaryen.i32 });
            allLambdaParams.push({ name: `__str_len_${p.name}`, wasmType: binaryen.i32 });
            edictParamTypes.push("String");
        } else {
            allLambdaParams.push({ name: p.name, wasmType: p.wasmType });
            edictParamTypes.push("other");
        }
    }

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
    fnSigs.set(lambdaName, { returnType, paramTypes: allParamTypes, edictParamTypes });

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
