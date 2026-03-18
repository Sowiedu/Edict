// =============================================================================
// Edict Browser Full Pipeline — checkBrowserFull(ast) → CheckBrowserFullResult
// =============================================================================
// Runs phases 1–4: validate → resolve → typeCheck → effectCheck → contractVerify.
// Uses the built-in QF-LIA solver (no Z3, no worker threads) — fully synchronous.
// Designed for QuickJS-WASM and other environments without async/WebAssembly.

import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "./errors/structured-errors.js";
import { checkBrowser, type CheckBrowserResult } from "./check-browser.js";
import { contractVerifySync } from "./contracts/verify.js";
import { createBuiltinSolver } from "./contracts/solver/index.js";
import type { EdictModule } from "./ast/nodes.js";
import type { TypedModuleInfo } from "./checker/check.js";

export type CheckBrowserFullResult =
    | CheckBrowserFullSuccess
    | CheckBrowserFullFailure;

export interface CheckBrowserFullSuccess {
    ok: true;
    errors: [];
    /** The validated module AST */
    module: EdictModule;
    /** Side-table of inferred types */
    typeInfo: TypedModuleInfo;
    /** INFO-level diagnostics */
    diagnostics: AnalysisDiagnostic[];
    /** Verification coverage summary */
    coverage: VerificationCoverage;
}

export interface CheckBrowserFullFailure {
    ok: false;
    errors: StructuredError[];
    module: null;
    typeInfo: TypedModuleInfo | null;
    diagnostics: AnalysisDiagnostic[];
}

/**
 * Browser-safe pipeline with contract verification:
 * validate → resolve → typeCheck → effectCheck → contractVerify (built-in solver).
 *
 * Fully synchronous — uses the built-in QF-LIA solver, no Z3 dependency.
 * Quantified/array contracts degrade to `undecidable_predicate`.
 *
 * @param ast - Any JSON value to run through phases 1–4
 * @returns Discriminated union with contract verification results
 */
export function checkBrowserFull(ast: unknown): CheckBrowserFullResult {
    // Phases 1–3
    const checkResult: CheckBrowserResult = checkBrowser(ast);
    if (!checkResult.ok) {
        return {
            ok: false,
            errors: checkResult.errors,
            module: null,
            typeInfo: checkResult.typeInfo,
            diagnostics: checkResult.diagnostics,
        };
    }

    // Phase 4 — Contract verification with built-in solver
    const solver = createBuiltinSolver();
    const contractResult = contractVerifySync(checkResult.module, solver);

    if (contractResult.errors.length > 0) {
        return {
            ok: false,
            errors: contractResult.errors,
            module: null,
            typeInfo: checkResult.typeInfo,
            diagnostics: [...checkResult.diagnostics, ...contractResult.diagnostics],
        };
    }

    // Compute verification coverage
    const module = checkResult.module;
    const fnCount = module.definitions.filter(d => d.kind === "fn").length;
    const fnsWithContracts = module.definitions.filter(
        d => d.kind === "fn" && d.contracts.length > 0,
    ).length;
    const contractSkipped = new Set(
        contractResult.diagnostics
            .filter(d => d.diagnostic === "contract_skipped_unsupported_params")
            .map(d => d.functionName),
    ).size;

    const coverage: VerificationCoverage = {
        effects: { checked: fnCount, skipped: 0, total: fnCount },
        contracts: {
            proven: fnsWithContracts - contractSkipped,
            skipped: contractSkipped,
            total: fnsWithContracts,
        },
    };

    return {
        ok: true,
        errors: [],
        module: checkResult.module,
        typeInfo: checkResult.typeInfo,
        diagnostics: [...checkResult.diagnostics, ...contractResult.diagnostics],
        coverage,
    };
}
