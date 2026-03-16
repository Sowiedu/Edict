// =============================================================================
// Closure Helpers — free variable collection and closure pair allocation
// =============================================================================
// Extracted from codegen.ts for modularity.

import * as binaryen from "./wasm-encoder.js";
import type { Expression } from "../ast/nodes.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { type FunctionSig, FunctionContext } from "./types.js";
import { walkExpression } from "../ast/walk.js";

// =============================================================================
// Free variable collection
// =============================================================================

/**
 * Walk a lambda body and collect identifiers that reference variables from
 * the enclosing scope ("free variables"). These are the values that must be
 * stored in a closure environment record.
 */
export function collectFreeVariables(
    body: Expression[],
    paramNames: Set<string>,
    constGlobals: Map<string, binaryen.Type>,
    fnSigs: Map<string, FunctionSig>,
): Map<string, { wasmType: binaryen.Type }> {
    const free = new Map<string, { wasmType: binaryen.Type }>();
    const locallyDefined = new Set<string>();

    for (const expr of body) {
        walkExpression(expr, {
            enter(node) {
                if (node.kind === "ident") {
                    if (
                        !paramNames.has(node.name) &&
                        !constGlobals.has(node.name) &&
                        !fnSigs.has(node.name) &&
                        !BUILTIN_FUNCTIONS.has(node.name) &&
                        !locallyDefined.has(node.name) &&
                        !free.has(node.name)
                    ) {
                        free.set(node.name, { wasmType: binaryen.i32 }); // placeholder
                    }
                } else if (node.kind === "let") {
                    locallyDefined.add(node.name);
                } else if (node.kind === "lambda") {
                    const innerParams = new Set(node.params.map(p => p.name));
                    const innerFree = collectFreeVariables(
                        node.body,
                        innerParams,
                        constGlobals,
                        fnSigs,
                    );
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
                    return false; // Do not recurse into lambda body (inner call handled it)
                }
            }
        });
    }

    return free;
}

// =============================================================================
// Closure pair allocation
// =============================================================================

/**
 * Allocate a closure pair on the heap: [table_index: i32, env_ptr: i32].
 * Returns a block expression that evaluates to the pair's heap pointer.
 */
export function allocClosurePair(
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
