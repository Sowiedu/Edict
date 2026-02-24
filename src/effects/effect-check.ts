// =============================================================================
// Effect Checker
// =============================================================================
// Single-pass analysis: verify that each function's declared effects cover
// the effects of the functions it calls.

import type { EdictModule } from "../ast/nodes.js";
import type { StructuredError } from "../errors/structured-errors.js";
import { effectViolation, effectInPure } from "../errors/structured-errors.js";
import { buildCallGraph } from "./call-graph.js";

/**
 * Check effect consistency across all functions in the module.
 *
 * For each function, iterates its call edges (skipping imports):
 * - If caller is `pure`: any callee with non-pure effects → `effect_in_pure` error
 * - If caller is not `pure`: missing caller effects → `effect_violation` error
 *
 * Returns an empty array if all effects are consistent.
 */
export function effectCheck(module: EdictModule): StructuredError[] {
    const { graph, functionDefs, importedNames } = buildCallGraph(module);
    const errors: StructuredError[] = [];

    for (const [fnName, fn] of functionDefs) {
        const edges = graph.get(fnName) ?? [];
        const callerEffects = new Set(fn.effects);
        const isPure = callerEffects.has("pure");

        for (const edge of edges) {
            // Skip imported functions — effect-opaque
            if (importedNames.has(edge.calleeName)) continue;

            // Skip unknown callees (e.g., parameters used as functions)
            const callee = functionDefs.get(edge.calleeName);
            if (!callee) continue;

            const calleeNonPure = callee.effects.filter(e => e !== "pure");
            if (calleeNonPure.length === 0) continue;

            if (isPure) {
                errors.push(effectInPure(
                    fn.id,
                    fnName,
                    edge.callSiteNodeId,
                    edge.calleeName,
                    calleeNonPure,
                ));
            } else {
                const missing = calleeNonPure.filter(e => !callerEffects.has(e));
                if (missing.length > 0) {
                    errors.push(effectViolation(
                        fn.id,
                        fnName,
                        missing,
                        edge.callSiteNodeId,
                        edge.calleeName,
                    ));
                }
            }
        }
    }

    return errors;
}
