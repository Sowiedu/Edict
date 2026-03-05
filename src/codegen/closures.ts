// =============================================================================
// Closure Helpers — free variable collection and closure pair allocation
// =============================================================================
// Extracted from codegen.ts for modularity.

import binaryen from "binaryen";
import type { Expression } from "../ast/nodes.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { type FunctionSig, FunctionContext } from "./types.js";

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
