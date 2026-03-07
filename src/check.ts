// =============================================================================
// Edict Pipeline — check(ast) → Promise<CheckResult>
// =============================================================================
// Runs the full pipeline: validate → resolve → typeCheck → effectCheck → contractVerify
// Stops early if an earlier phase fails.

import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "./errors/structured-errors.js";
import { validate } from "./validator/validate.js";
import { resolve } from "./resolver/resolve.js";
import { typeCheck, type TypedModuleInfo } from "./checker/check.js";
import { effectCheck } from "./effects/effect-check.js";
import { contractVerify } from "./contracts/verify.js";
import type { EdictModule } from "./ast/nodes.js";

export interface CheckResult {
    ok: boolean;
    errors: StructuredError[];
    /** The validated module AST (only present when ok === true) */
    module?: EdictModule;
    /** Side-table of inferred types (only present when ok === true) */
    typeInfo?: TypedModuleInfo;
    /** INFO-level diagnostics about skipped analyses (present even when ok === true) */
    diagnostics?: AnalysisDiagnostic[];
    /** Summary of what was verified vs. skipped */
    coverage?: VerificationCoverage;
}

/**
 * Full pipeline: validate → resolve → typeCheck → effectCheck → contractVerify.
 *
 * If validation fails, returns validation errors (later phases skipped).
 * If resolution fails, returns resolution errors (later phases skipped).
 * If type checking fails, returns type errors (effect checking skipped).
 * If effect checking fails, returns effect errors (contract verification skipped).
 * If all passes succeed, returns `{ ok: true, errors: [] }` with diagnostics and coverage.
 */
export async function check(ast: unknown): Promise<CheckResult> {
    // Phase 1 — Structural validation
    const validation = validate(ast);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors };
    }

    const module = ast as EdictModule;

    // Phase 2a — Name resolution
    const resolveErrors = resolve(module);
    if (resolveErrors.length > 0) {
        return { ok: false, errors: resolveErrors };
    }

    // Phase 2b — Type checking
    const { errors: typeErrors, typeInfo } = typeCheck(module);
    if (typeErrors.length > 0) {
        return { ok: false, errors: typeErrors };
    }

    // Phase 3 — Effect checking
    const effectResult = effectCheck(module);
    if (effectResult.errors.length > 0) {
        return { ok: false, errors: effectResult.errors, diagnostics: effectResult.diagnostics };
    }

    // Phase 4 — Contract verification
    const contractResult = await contractVerify(module);
    if (contractResult.errors.length > 0) {
        return { ok: false, errors: contractResult.errors, diagnostics: [...effectResult.diagnostics, ...contractResult.diagnostics] };
    }

    // Combine all diagnostics
    const diagnostics = [...effectResult.diagnostics, ...contractResult.diagnostics];

    // Compute verification coverage
    const fnCount = module.definitions.filter(d => d.kind === "fn").length;
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

    return { ok: true, errors: [], module, typeInfo, diagnostics, coverage };
}
