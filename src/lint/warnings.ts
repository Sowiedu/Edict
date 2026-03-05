// =============================================================================
// Lint Warnings — Non-blocking quality hints
// =============================================================================
// Structured, machine-readable warnings parallel to StructuredError.
// Each uses `warning` as the discriminator (not `error`), plus `severity: "warning"`.

import type { Effect } from "../ast/nodes.js";
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
    | RedundantEffectWarning;

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

export interface RedundantEffectWarning {
    warning: "redundant_effect";
    severity: "warning";
    nodeId: string;
    functionName: string;
    redundantEffects: Effect[];
    requiredEffects: Effect[];
    suggestion?: FixSuggestion;
}

// =============================================================================
// Factory functions
// =============================================================================

export function unusedVariable(nodeId: string, name: string): UnusedVariableWarning {
    return { warning: "unused_variable", severity: "warning", nodeId, name };
}

export function unusedImport(
    nodeId: string,
    importModule: string,
    unusedNames: string[],
): UnusedImportWarning {
    return { warning: "unused_import", severity: "warning", nodeId, importModule, unusedNames };
}

export function missingContract(nodeId: string, functionName: string): MissingContractWarning {
    return { warning: "missing_contract", severity: "warning", nodeId, functionName };
}

export function oversizedFunction(
    nodeId: string,
    functionName: string,
    expressionCount: number,
    threshold: number,
): OversizedFunctionWarning {
    return { warning: "oversized_function", severity: "warning", nodeId, functionName, expressionCount, threshold };
}

export function emptyBody(nodeId: string, functionName: string): EmptyBodyWarning {
    return { warning: "empty_body", severity: "warning", nodeId, functionName };
}

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
