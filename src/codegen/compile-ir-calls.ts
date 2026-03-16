// =============================================================================
// IR Call and Lambda Reference compilers
// =============================================================================
// The IR counterpart to compile-calls.ts. Key differences:
//
// - compileIRCall: dispatches by IRCallKind (pre-classified during lowering),
//   eliminating the isDirectCall heuristic (ctx.getLocal + fnSigs + BUILTIN check).
//   Uses pre-resolved argCoercions from IR instead of runtime callArgCoercions Map.
//
// - compileIRLambdaRef: reads pre-computed captures from IRLambdaRef. The lifted
//   function was already registered in IRModule.functions by the lowering pass.
//   Eliminates collectFreeVariables() AST walk (73 lines) at codegen time.

import * as binaryen from "./wasm-encoder.js";
import type { IRCall, IRLambdaRef } from "../ir/types.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import { allocClosurePair } from "./closures.js";
import { compileIRExpr, irExprWasmType } from "./compile-ir-expr.js";


// =============================================================================
// Call compilation
// =============================================================================

/**
 * Compile an IR function call to binaryen.
 *
 * Dispatches by `expr.callKind` (pre-classified during IR lowering):
 * - "direct"  → known user function, emit `mod.call()` with __env=0 prepended
 * - "builtin" → host import, emit `mod.call()` without __env
 * - "indirect" → closure pair, emit `mod.call_indirect()` via function table
 */
export function compileIRCall(
    expr: IRCall,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;

    switch (expr.callKind) {
        case "direct":
        case "builtin": {
            // Resolve function name from the fn expression
            const fnName = expr.fn.kind === "ir_ident" ? expr.fn.name : undefined;
            if (!fnName) {
                // Should not happen for direct/builtin calls — fn must be an ident
                cc.errors.push(wasmValidationError(
                    `IR direct/builtin call has non-ident fn: ${expr.fn.kind}`,
                ));
                return mod.unreachable();
            }

            const isUserFn = expr.callKind === "direct" && cc.fnTableIndices.has(fnName);
            const sig = fnSigs.get(fnName);
            const returnType = sig ? sig.returnType : edictTypeToWasm(expr.resolvedType);

            // Compile arguments with coercions from IR (pre-resolved)
            const args = expr.args.map((a, i) => {
                let compiled = compileIRExpr(a, cc, ctx);

                // Apply pre-resolved arg coercion (e.g., intToString for print)
                const coercionFn = expr.argCoercions[i];
                if (coercionFn) {
                    compiled = mod.call(coercionFn, [compiled], binaryen.i32);
                }

                // Coerce i32→f64 if function expects f64 but arg is i32
                const paramIdx = isUserFn ? i + 1 : i;
                if (sig?.paramTypes && sig.paramTypes[paramIdx] === binaryen.f64) {
                    const argType = irExprWasmType(a);
                    if (argType === binaryen.i32) {
                        return mod.f64.convert_s.i32(compiled);
                    }
                }
                return compiled;
            });

            // Prepend dummy __env = 0 for user-defined functions (not builtins)
            const callArgs = isUserFn ? [mod.i32.const(0), ...args] : args;
            return mod.call(fnName, callArgs, returnType);
        }

        case "indirect": {
            // Indirect call through closure pair: [table_index, env_ptr]
            const closurePtr = compileIRExpr(expr.fn, cc, ctx);
            const closurePtrLocal = ctx.addLocal(`__call_closure_${expr.sourceId}`, binaryen.i32);

            // Compile arguments — use irExprWasmType instead of inferExprWasmType
            const wasmArgs: binaryen.ExpressionRef[] = [];
            const wasmArgTypes: binaryen.Type[] = [];
            for (const a of expr.args) {
                const argType = irExprWasmType(a);
                wasmArgs.push(compileIRExpr(a, cc, ctx));
                wasmArgTypes.push(argType);
            }

            // WASM type signature: __env (i32) + arg types
            const allParamTypes = [binaryen.i32, ...wasmArgTypes];
            const paramType = binaryen.createType(allParamTypes);
            const resultType = edictTypeToWasm(expr.resolvedType);

            // Load table_index and env_ptr from closure pair
            const tableIdx = mod.i32.load(0, 0, mod.local.get(closurePtrLocal, binaryen.i32));
            const envPtr = mod.i32.load(4, 0, mod.local.get(closurePtrLocal, binaryen.i32));

            return mod.block(null, [
                mod.local.set(closurePtrLocal, closurePtr),
                mod.call_indirect("__fn_table", tableIdx, [envPtr, ...wasmArgs], paramType, resultType),
            ], resultType);
        }
    }
}


// =============================================================================
// Lambda Reference compilation
// =============================================================================

/**
 * Compile an IR lambda reference to a closure pair allocation.
 *
 * The lifted function was already compiled and registered in the function table
 * by the top-level codegen loop (iterating IRModule.functions). This function
 * only needs to:
 * 1. Allocate a closure environment on the heap (if captures exist)
 * 2. Return a closure pair: [table_index, env_ptr]
 *
 * Eliminates `collectFreeVariables()` — captures are pre-computed in IR.
 */
export function compileIRLambdaRef(
    expr: IRLambdaRef,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const lambdaName = expr.liftedName;

    // Look up the table index for the lifted function
    const tableIndex = cc.fnTableIndices.get(lambdaName);
    if (tableIndex === undefined) {
        cc.errors.push(wasmValidationError(
            `IR lambda ref '${lambdaName}' not found in function table`,
        ));
        return mod.unreachable();
    }

    // Allocate environment record on the heap (if there are captures)
    let envPtrExpr: binaryen.ExpressionRef;
    if (expr.captures.length > 0) {
        const envSize = expr.captures.length * 8; // 8-byte slots (supports i32 and f64)
        const envPtrLocal = ctx.addLocal(`__env_ptr_${lambdaName}`, binaryen.i32);

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

        let offset = 0;
        for (const capture of expr.captures) {
            const wasmType = edictTypeToWasm(capture.resolvedType);
            // Load captured value from enclosing context
            const capturedValue = (() => {
                const local = ctx.getLocal(capture.name);
                if (local) return mod.local.get(local.index, local.type);
                const globalType = cc.constGlobals.get(capture.name);
                if (globalType !== undefined) return mod.global.get(capture.name, globalType);
                return mod.unreachable();
            })();

            if (wasmType === binaryen.f64) {
                envStores.push(
                    mod.f64.store(offset, 0,
                        mod.local.get(envPtrLocal, binaryen.i32),
                        capturedValue,
                    ),
                );
            } else {
                envStores.push(
                    mod.i32.store(offset, 0,
                        mod.local.get(envPtrLocal, binaryen.i32),
                        capturedValue,
                    ),
                );
            }
            offset += 8;
        }

        envPtrExpr = mod.block(null, [
            ...envStores,
            mod.local.get(envPtrLocal, binaryen.i32),
        ], binaryen.i32);
    } else {
        envPtrExpr = mod.i32.const(0);
    }

    return allocClosurePair(
        mod, ctx,
        mod.i32.const(tableIndex),
        envPtrExpr,
        `ir_${lambdaName}`,
    );
}
