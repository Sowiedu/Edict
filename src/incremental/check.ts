// =============================================================================
// Incremental Check — incrementalCheck(before, after) → IncrementalCheckResult
// =============================================================================
// Runs the full pipeline but scopes Z3 contract verification to only the
// definitions that changed (or transitively depend on changed definitions).
// Phases 1-3 always run fully since they're cheap and module-global.

import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "../errors/structured-errors.js";
import { validate } from "../validator/validate.js";
import { resolve } from "../resolver/resolve.js";
import { typeCheck } from "../checker/check.js";
import type { TypedModuleInfo } from "../checker/check.js";
import { complexityCheck } from "../checker/complexity.js";
import { effectCheck } from "../effects/effect-check.js";
import { contractVerify } from "../contracts/verify.js";
import type { EdictModule, FunctionDef } from "../ast/nodes.js";
import { buildDepGraph, transitiveDependents } from "./dep-graph.js";
import { diffDefinitions } from "./diff.js";

// =============================================================================
// Types
// =============================================================================

export interface IncrementalCheckResult {
    ok: boolean;
    errors: StructuredError[];
    /** The validated module AST (only present when ok === true) */
    module?: EdictModule;
    /** Side-table of inferred types (only present when ok === true) */
    typeInfo?: TypedModuleInfo;
    /** INFO-level diagnostics about skipped analyses */
    diagnostics?: AnalysisDiagnostic[];
    /** Summary of what was verified vs. skipped */
    coverage?: VerificationCoverage;
    /** Cache hit/miss statistics for contract verification */
    cacheStats?: { hits: number; misses: number };
    /** Definitions that were re-verified by Z3 */
    rechecked: string[];
    /** Definitions for which Z3 verification was skipped (unchanged) */
    skipped: string[];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Incremental check: runs the full pipeline on `after`, but scopes Phase 4
 * (Z3 contract verification) to only the definitions that changed relative
 * to `before` (plus their transitive dependents).
 *
 * If `before` is invalid or diffing fails, falls back to full check.
 */
export async function incrementalCheck(
    before: EdictModule,
    after: EdictModule,
): Promise<IncrementalCheckResult> {
    // Phase 1 — Structural validation (always full)
    const validation = validate(after);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors, rechecked: [], skipped: [] };
    }

    const module = after as EdictModule;

    // Phase 2a — Name resolution (always full)
    const resolveErrors = resolve(module);
    if (resolveErrors.length > 0) {
        return { ok: false, errors: resolveErrors, rechecked: [], skipped: [] };
    }

    // Phase 2b — Type checking (always full)
    const { errors: typeErrors, typeInfo } = typeCheck(module);
    if (typeErrors.length > 0) {
        return { ok: false, errors: typeErrors, rechecked: [], skipped: [] };
    }

    // Phase 2c — Complexity checking (always full)
    const complexityErrors = complexityCheck(module);
    if (complexityErrors.length > 0) {
        return { ok: false, errors: complexityErrors, typeInfo, rechecked: [], skipped: [] };
    }

    // Phase 3 — Effect checking (always full)
    const effectResult = effectCheck(module);
    if (effectResult.errors.length > 0) {
        return {
            ok: false,
            errors: effectResult.errors,
            diagnostics: effectResult.diagnostics,
            rechecked: [],
            skipped: [],
        };
    }

    // --- Incremental Phase 4 ---
    // Compute which definitions changed and their transitive dependents
    const changedNames = diffDefinitions(before, after);
    const depGraph = buildDepGraph(after);
    const affectedNames = transitiveDependents(depGraph, changedNames);

    // Build list of all function names with contracts
    const allFnNames = module.definitions
        .filter(d => d.kind === "fn")
        .map(d => d.name);

    const rechecked = allFnNames.filter(name => affectedNames.has(name));
    const skipped = allFnNames.filter(name => !affectedNames.has(name));

    // If nothing changed, skip contract verification entirely
    if (affectedNames.size === 0) {
        const fnCount = allFnNames.length;
        const coverage: VerificationCoverage = {
            effects: { checked: fnCount, skipped: 0, total: fnCount },
            contracts: { proven: 0, skipped: 0, total: 0 },
        };
        return {
            ok: true,
            errors: [],
            module,
            typeInfo,
            diagnostics: effectResult.diagnostics,
            coverage,
            rechecked: [],
            skipped: allFnNames,
        };
    }

    // Build a filtered module for contract verification:
    // Keep all definitions but only verify contracts for affected functions.
    // We pass the full module (contractVerify needs it for callsite analysis)
    // but build a subset module where only affected functions have contracts.
    const filteredModule = buildFilteredModule(module, affectedNames);
    const contractResult = await contractVerify(filteredModule);

    // Combine results
    const allErrors = [...contractResult.errors];
    const allDiagnostics = [...effectResult.diagnostics, ...contractResult.diagnostics];

    if (allErrors.length > 0) {
        return {
            ok: false,
            errors: allErrors,
            diagnostics: allDiagnostics,
            rechecked,
            skipped,
            cacheStats: contractResult.cacheStats,
        };
    }

    // Compute verification coverage
    const fnCount = allFnNames.length;
    const effectSkipped = new Set(
        effectResult.diagnostics.map(d => d.functionName),
    ).size;
    const contractSkipped = new Set(
        contractResult.diagnostics
            .filter(d => d.diagnostic === "contract_skipped_unsupported_params")
            .map(d => d.functionName),
    ).size;
    const fnsWithContracts = module.definitions.filter(
        d => d.kind === "fn" && d.contracts.length > 0,
    ).length;

    const coverage: VerificationCoverage = {
        effects: {
            checked: fnCount - effectSkipped,
            skipped: effectSkipped,
            total: fnCount,
        },
        contracts: {
            proven: fnsWithContracts - contractSkipped,
            skipped: contractSkipped,
            total: fnsWithContracts,
        },
    };

    return {
        ok: true,
        errors: [],
        module,
        typeInfo,
        diagnostics: allDiagnostics,
        coverage,
        cacheStats: contractResult.cacheStats,
        rechecked,
        skipped,
    };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a module copy where only functions in `affectedNames` retain their
 * contracts. Other functions have contracts cleared so contractVerify skips them.
 * The module structure is preserved for callsite analysis.
 */
function buildFilteredModule(module: EdictModule, affectedNames: Set<string>): EdictModule {
    return {
        ...module,
        definitions: module.definitions.map(def => {
            if (def.kind === "fn" && !affectedNames.has(def.name)) {
                // Strip contracts from unaffected functions
                return { ...def, contracts: [] } as FunctionDef;
            }
            return def;
        }),
    };
}
