// =============================================================================
// Edict Browser Pipeline — checkBrowser(ast) → CheckBrowserResult
// =============================================================================
// Runs phases 1–3: validate → resolve → typeCheck → complexityCheck → effectCheck.
// Same as check() but without contract verification (phase 4), which requires
// Node.js worker threads and Z3.

import type { StructuredError, AnalysisDiagnostic } from "./errors/structured-errors.js";
import { validate } from "./validator/validate.js";
import { resolve } from "./resolver/resolve.js";
import { typeCheck, type TypedModuleInfo } from "./checker/check.js";
import { complexityCheck } from "./checker/complexity.js";
import { effectCheck } from "./effects/effect-check.js";
import type { EdictModule } from "./ast/nodes.js";

export interface CheckBrowserResult {
    ok: boolean;
    errors: StructuredError[];
    /** The validated module AST (only present when ok === true) */
    module?: EdictModule;
    /** Side-table of inferred types (only present when ok === true) */
    typeInfo?: TypedModuleInfo;
    /** INFO-level diagnostics (present even when ok === true) */
    diagnostics?: AnalysisDiagnostic[];
}

/**
 * Browser-safe pipeline: validate → resolve → typeCheck → complexityCheck → effectCheck.
 *
 * Identical to `check()` but skips contract verification (phase 4), which
 * requires Node.js worker threads and Z3. This function is synchronous —
 * no async needed since Z3 is excluded.
 *
 * @param ast - Any JSON value to run through phases 1–3
 * @returns `{ ok, errors, module?, typeInfo?, diagnostics? }`
 */
export function checkBrowser(ast: unknown): CheckBrowserResult {
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

    // Phase 2c — Complexity checking
    const complexityErrors = complexityCheck(module);
    if (complexityErrors.length > 0) {
        return { ok: false, errors: complexityErrors, typeInfo };
    }

    // Phase 3 — Effect checking
    const effectResult = effectCheck(module);
    if (effectResult.errors.length > 0) {
        return { ok: false, errors: effectResult.errors, diagnostics: effectResult.diagnostics };
    }

    return { ok: true, errors: [], module, typeInfo, diagnostics: effectResult.diagnostics };
}
