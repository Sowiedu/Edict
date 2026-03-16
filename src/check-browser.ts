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
import { expandCompact } from "./compact/expand.js";
import { migrateToLatest } from "./migration/migrate.js";

export type CheckBrowserResult =
    | CheckBrowserSuccess
    | CheckBrowserFailure;

export interface CheckBrowserSuccess {
    ok: true;
    errors: [];
    /** The validated module AST */
    module: EdictModule;
    /** Side-table of inferred types */
    typeInfo: TypedModuleInfo;
    /** INFO-level diagnostics */
    diagnostics: AnalysisDiagnostic[];
}

export interface CheckBrowserFailure {
    ok: false;
    errors: StructuredError[];
    /** Null on failure — use discriminant `ok` to narrow */
    module: null;
    /** Present for late-stage failures (complexity/effects) where type-checking succeeded; null for earlier phases */
    typeInfo: TypedModuleInfo | null;
    /** INFO-level diagnostics (may still be present on failure) */
    diagnostics: AnalysisDiagnostic[];
}

/**
 * Browser-safe pipeline: validate → resolve → typeCheck → complexityCheck → effectCheck.
 *
 * Identical to `check()` but skips contract verification (phase 4), which
 * requires Node.js worker threads and Z3. This function is synchronous —
 * no async needed since Z3 is excluded.
 *
 * @param ast - Any JSON value to run through phases 1–3
 * @returns Discriminated union: `ok: true` with module/typeInfo, or `ok: false` with null module/typeInfo
 */
export function checkBrowser(ast: unknown): CheckBrowserResult {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) {
        return { ok: false, errors: migrated.errors, module: null, typeInfo: null, diagnostics: [] };
    }

    // Phase 1 — Structural validation
    const validation = validate(migrated.ast);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors, module: null, typeInfo: null, diagnostics: [] };
    }

    const module = migrated.ast as EdictModule;

    // Phase 2a — Name resolution
    const resolveErrors = resolve(module);
    if (resolveErrors.length > 0) {
        return { ok: false, errors: resolveErrors, module: null, typeInfo: null, diagnostics: [] };
    }

    // Phase 2b — Type checking
    const { errors: typeErrors, typeInfo } = typeCheck(module);
    if (typeErrors.length > 0) {
        return { ok: false, errors: typeErrors, module: null, typeInfo: null, diagnostics: [] };
    }

    // Phase 2c — Complexity checking
    const complexityErrors = complexityCheck(module);
    if (complexityErrors.length > 0) {
        return { ok: false, errors: complexityErrors, module: null, typeInfo, diagnostics: [] };
    }

    // Phase 3 — Effect checking
    const effectResult = effectCheck(module, typeInfo);
    if (effectResult.errors.length > 0) {
        return { ok: false, errors: effectResult.errors, module: null, typeInfo, diagnostics: effectResult.diagnostics };
    }

    return { ok: true, errors: [], module, typeInfo, diagnostics: effectResult.diagnostics };
}
