// =============================================================================
// Lint Warnings — Non-blocking quality hints
// =============================================================================
// Structured, machine-readable warnings parallel to StructuredError.
// Each uses `warning` as the discriminator (not `error`), plus `severity: "warning"`.

import type { Effect, IntentInvariant } from "../ast/nodes.js";
import type { FixSuggestion } from "../errors/structured-errors.js";

// =============================================================================
// Union type
// =============================================================================

export type LintWarning =
    | UnusedVariableWarning
    | UnusedImportWarning
    | MissingContractWarning
    | OversizedFunctionWarning
    | EmptyBodyWarning
    | RedundantEffectWarning
    | DecompositionSuggestedWarning
    | IntentUnverifiedInvariantWarning;

// =============================================================================
// Individual warning types
// =============================================================================

export interface UnusedVariableWarning {
    warning: "unused_variable";
    severity: "warning";
    nodeId: string;
    name: string;
    suggestion?: FixSuggestion;
}

export interface UnusedImportWarning {
    warning: "unused_import";
    severity: "warning";
    nodeId: string;
    importModule: string;
    unusedNames: string[];
    suggestion?: FixSuggestion;
}

export interface MissingContractWarning {
    warning: "missing_contract";
    severity: "warning";
    nodeId: string;
    functionName: string;
}

export interface OversizedFunctionWarning {
    warning: "oversized_function";
    severity: "warning";
    nodeId: string;
    functionName: string;
    expressionCount: number;
    threshold: number;
}

export interface EmptyBodyWarning {
    warning: "empty_body";
    severity: "warning";
    nodeId: string;
    functionName: string;
}

export interface SuggestedSplit {
    name: string;
    nodeRange: [string, string]; // [firstNodeId, lastNodeId]
    nodeCount: number;
}

export interface DecompositionSuggestedWarning {
    warning: "decomposition_suggested";
    severity: "warning";
    nodeId: string;
    functionName: string;
    reason: string;
    suggestedSplit: SuggestedSplit[];
}

export interface RedundantEffectWarning {
    warning: "redundant_effect";
    severity: "warning";
    nodeId: string;
    functionName: string;
    redundantEffects: Effect[];
    requiredEffects: Effect[];
    suggestion?: FixSuggestion;
}

export interface IntentUnverifiedInvariantWarning {
    warning: "intent_unverified_invariant";
    severity: "warning";
    nodeId: string;
    functionName: string;
    unverifiedInvariant: IntentInvariant;
}

// =============================================================================
// Factory functions
// =============================================================================

/** Create a warning for an unused `let` binding that is never referenced. */
export function unusedVariable(nodeId: string, name: string): UnusedVariableWarning {
    return { warning: "unused_variable", severity: "warning", nodeId, name };
}

/** Create a warning for imported names that are never referenced in the module. */
export function unusedImport(
    nodeId: string,
    importModule: string,
    unusedNames: string[],
): UnusedImportWarning {
    return { warning: "unused_import", severity: "warning", nodeId, importModule, unusedNames };
}

/** Create a warning for a function (non-main) that has no pre/post contracts. */
export function missingContract(nodeId: string, functionName: string): MissingContractWarning {
    return { warning: "missing_contract", severity: "warning", nodeId, functionName };
}

/** Create a warning for a function whose body exceeds the expression node threshold. */
export function oversizedFunction(
    nodeId: string,
    functionName: string,
    expressionCount: number,
    threshold: number,
): OversizedFunctionWarning {
    return { warning: "oversized_function", severity: "warning", nodeId, functionName, expressionCount, threshold };
}

/** Create a warning for a function with an empty body. */
export function emptyBody(nodeId: string, functionName: string): EmptyBodyWarning {
    return { warning: "empty_body", severity: "warning", nodeId, functionName };
}

/** Create a warning for effects declared on a function that are not required by its call graph. */
export function redundantEffect(
    nodeId: string,
    functionName: string,
    redundantEffects: Effect[],
    requiredEffects: Effect[],
): RedundantEffectWarning {
    return {
        warning: "redundant_effect",
        severity: "warning",
        nodeId,
        functionName,
        redundantEffects,
        requiredEffects,
        suggestion: {
            nodeId,
            field: "effects",
            value: requiredEffects.length > 0 ? requiredEffects : ["pure"],
        },
    };
}

/** Create a warning suggesting decomposition of an oversized function into independent segments. */
export function decompositionSuggested(
    nodeId: string,
    functionName: string,
    suggestedSplit: SuggestedSplit[],
): DecompositionSuggestedWarning {
    return {
        warning: "decomposition_suggested",
        severity: "warning",
        nodeId,
        functionName,
        reason: `function_has_${suggestedSplit.length}_independent_segments`,
        suggestedSplit,
    };
}

/** Create a warning for an intent invariant that has no matching postcondition contract. */
export function intentUnverifiedInvariant(
    nodeId: string,
    functionName: string,
    unverifiedInvariant: IntentInvariant,
): IntentUnverifiedInvariantWarning {
    return {
        warning: "intent_unverified_invariant",
        severity: "warning",
        nodeId,
        functionName,
        unverifiedInvariant,
    };
}
