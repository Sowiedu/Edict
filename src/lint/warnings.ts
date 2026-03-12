// =============================================================================
// Lint Warnings — Non-blocking quality hints
// =============================================================================
// Structured, machine-readable warnings parallel to StructuredError.
// Each uses `warning` as the discriminator (not `error`), plus `severity: "warning"`.

import type { Effect, IntentInvariant } from "../ast/nodes.js";
import type { TypeExpr } from "../ast/types.js";
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
    | IntentUnverifiedInvariantWarning
    | ConfidenceBelowThresholdWarning
    | LowConfidenceOutputWarning
    | LiteralProvenanceWarning
    | StaleDataWarning
    | ApprovalMissingOnIoWarning
    | ToolCallNoRetryWarning
    | ToolCallNoTimeoutWarning
    | UnsupportedContainerWarning;

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

export interface ConfidenceBelowThresholdWarning {
    warning: "confidence_below_threshold";
    severity: "warning";
    nodeId: string;
    name: string;
    actual: number;
    required: number;
}

export interface LowConfidenceOutputWarning {
    warning: "low_confidence_output";
    severity: "warning";
    nodeId: string;
    functionName: string;
    returnConfidence: number;
    minConfidence: number;
}

export interface LiteralProvenanceWarning {
    warning: "literal_provenance";
    severity: "warning";
    nodeId: string;
    functionName: string;
    declaredSource: string;
}

export interface StaleDataWarning {
    warning: "stale_data_used";
    severity: "warning";
    nodeId: string;
    functionName: string;
    paramName: string;
    declaredMaxAge: string;
}

export interface ApprovalMissingOnIoWarning {
    warning: "approval_missing_on_io";
    severity: "warning";
    nodeId: string;
    functionName: string;
    effects: Effect[];
}

export interface ToolCallNoRetryWarning {
    warning: "tool_call_no_retry";
    severity: "warning";
    nodeId: string;
    toolName: string;
}

export interface UnsupportedContainerWarning {
    warning: "unsupported_container";
    severity: "warning";
    nodeId: string;
    location: string;
    containerKind: "array" | "option" | "result";
    actualType: TypeExpr;
    supportedTypes: TypeExpr[];
    suggestion?: FixSuggestion;
}

export interface ToolCallNoTimeoutWarning {
    warning: "tool_call_no_timeout";
    severity: "warning";
    nodeId: string;
    toolName: string;
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

/** Create a warning when a blame annotation's confidence is below the module's minConfidence threshold. */
export function confidenceBelowThreshold(
    nodeId: string,
    name: string,
    actual: number,
    required: number,
): ConfidenceBelowThresholdWarning {
    return {
        warning: "confidence_below_threshold",
        severity: "warning",
        nodeId,
        name,
        actual,
        required,
    };
}

/** Create a warning when a function's return type confidence is below the module's minConfidence threshold. */
export function lowConfidenceOutput(
    nodeId: string,
    functionName: string,
    returnConfidence: number,
    minConfidence: number,
): LowConfidenceOutputWarning {
    return {
        warning: "low_confidence_output",
        severity: "warning",
        nodeId,
        functionName,
        returnConfidence,
        minConfidence,
    };
}

/** Create a warning when a function claims non-literal provenance but returns a hardcoded literal. */
export function literalProvenance(
    nodeId: string,
    functionName: string,
    declaredSource: string,
): LiteralProvenanceWarning {
    return {
        warning: "literal_provenance",
        severity: "warning",
        nodeId,
        functionName,
        declaredSource,
    };
}

/** Create a warning when a pure function accepts a fresh-typed parameter — pure functions cannot re-fetch stale data. */
export function staleDataUsed(
    nodeId: string,
    functionName: string,
    paramName: string,
    declaredMaxAge: string,
): StaleDataWarning {
    return {
        warning: "stale_data_used",
        severity: "warning",
        nodeId,
        functionName,
        paramName,
        declaredMaxAge,
    };
}

/** Create a warning when an IO-effectful function lacks an approval gate. */
export function approvalMissingOnIo(
    nodeId: string,
    functionName: string,
    effects: Effect[],
): ApprovalMissingOnIoWarning {
    return {
        warning: "approval_missing_on_io",
        severity: "warning",
        nodeId,
        functionName,
        effects,
    };
}

/** Create a warning when a tool_call expression is missing a retry policy. */
export function toolCallNoRetry(nodeId: string, toolName: string): ToolCallNoRetryWarning {
    return { warning: "tool_call_no_retry", severity: "warning", nodeId, toolName };
}

/** Create a warning when a tool_call expression is missing a timeout. */
export function toolCallNoTimeout(nodeId: string, toolName: string): ToolCallNoTimeoutWarning {
    return { warning: "tool_call_no_timeout", severity: "warning", nodeId, toolName };
}

/** Create a warning when a container type (array/option/result) uses an element type not supported by any builtin. */
export function unsupportedContainer(
    nodeId: string,
    location: string,
    containerKind: "array" | "option" | "result",
    actualType: TypeExpr,
    supportedTypes: TypeExpr[],
    suggestion?: FixSuggestion,
): UnsupportedContainerWarning {
    const w: UnsupportedContainerWarning = {
        warning: "unsupported_container",
        severity: "warning",
        nodeId,
        location,
        containerKind,
        actualType,
        supportedTypes,
    };
    if (suggestion) w.suggestion = suggestion;
    return w;
}
