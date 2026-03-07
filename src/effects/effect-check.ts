// =============================================================================
// Effect Checker
// =============================================================================
// Single-pass analysis: verify that each function's declared effects cover
// the effects of the functions it calls.

import type { EdictModule } from "../ast/nodes.js";
import type { StructuredError } from "../errors/structured-errors.js";
import {
    effectViolation,
    effectInPure,
    analysisDiagnostic,
    type FixSuggestion,
    type AnalysisDiagnostic,
} from "../errors/structured-errors.js";
import { buildCallGraph } from "./call-graph.js";

/**
 * Result of effect checking: errors (violations) + diagnostics (skipped checks).
 */
export interface EffectCheckResult {
    errors: StructuredError[];
    diagnostics: AnalysisDiagnostic[];
}

/**
 * Check effect consistency across all functions in the module.
 *
 * For each function, iterates its call edges (skipping imports):
 * - If caller is `pure`: any callee with non-pure effects → `effect_in_pure` error
 * - If caller is not `pure`: missing caller effects → `effect_violation` error
 *
 * Skipped checks produce INFO-level diagnostics instead of silent success.
 */
export function effectCheck(module: EdictModule): EffectCheckResult {
    const { graph, functionDefs, importedNames } = buildCallGraph(module);
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    for (const [fnName, fn] of functionDefs) {
        const edges = graph.get(fnName) ?? [];
        const callerEffects = new Set(fn.effects);
        const isPure = callerEffects.has("pure");

        for (const edge of edges) {
            // Skip imported functions — effect-opaque, but report it
            if (importedNames.has(edge.calleeName)) {
                diagnostics.push(analysisDiagnostic(
                    "effect_skipped_import",
                    fnName,
                    fn.id,
                    "effects",
                    edge.calleeName,
                ));
                continue;
            }

            // Skip unknown callees (e.g., parameters used as functions), but report it
            const callee = functionDefs.get(edge.calleeName);
            if (!callee) {
                diagnostics.push(analysisDiagnostic(
                    "effect_skipped_unknown_callee",
                    fnName,
                    fn.id,
                    "effects",
                    edge.calleeName,
                ));
                continue;
            }

            const calleeNonPure = callee.effects.filter(e => e !== "pure");
            if (calleeNonPure.length === 0) continue;

            if (isPure) {
                const suggestion: FixSuggestion = {
                    nodeId: fn.id,
                    field: "effects",
                    value: calleeNonPure,
                };
                errors.push(effectInPure(
                    fn.id,
                    fnName,
                    edge.callSiteNodeId,
                    edge.calleeName,
                    calleeNonPure,
                    suggestion,
                ));
            } else {
                const missing = calleeNonPure.filter(e => !callerEffects.has(e));
                if (missing.length > 0) {
                    const suggestion: FixSuggestion = {
                        nodeId: fn.id,
                        field: "effects",
                        value: [...fn.effects, ...missing],
                    };
                    errors.push(effectViolation(
                        fn.id,
                        fnName,
                        missing,
                        edge.callSiteNodeId,
                        edge.calleeName,
                        suggestion,
                    ));
                }
            }
        }
    }

    return { errors, diagnostics };
}
