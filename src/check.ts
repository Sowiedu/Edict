// =============================================================================
// Edict Pipeline — check(ast) → Promise<CheckResult>
// =============================================================================
// Runs the full pipeline: validate → resolve → typeCheck → effectCheck → contractVerify
// Stops early if an earlier phase fails.

import type { StructuredError } from "./errors/structured-errors.js";
import { validate } from "./validator/validate.js";
import { resolve } from "./resolver/resolve.js";
import { typeCheck } from "./checker/check.js";
import { effectCheck } from "./effects/effect-check.js";
import { contractVerify } from "./contracts/verify.js";
import type { EdictModule } from "./ast/nodes.js";

export interface CheckResult {
    ok: boolean;
    errors: StructuredError[];
    /** The validated module AST (only present when ok === true) */
    module?: EdictModule;
}

/**
 * Full pipeline: validate → resolve → typeCheck → effectCheck → contractVerify.
 *
 * If validation fails, returns validation errors (later phases skipped).
 * If resolution fails, returns resolution errors (later phases skipped).
 * If type checking fails, returns type errors (effect checking skipped).
 * If effect checking fails, returns effect errors (contract verification skipped).
 * If all passes succeed, returns `{ ok: true, errors: [] }`.
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
    const typeErrors = typeCheck(module);
    if (typeErrors.length > 0) {
        return { ok: false, errors: typeErrors };
    }

    // Phase 3 — Effect checking
    const effectErrors = effectCheck(module);
    if (effectErrors.length > 0) {
        return { ok: false, errors: effectErrors };
    }

    // Phase 4 — Contract verification
    const contractErrors = await contractVerify(module);
    if (contractErrors.length > 0) {
        return { ok: false, errors: contractErrors };
    }
    return { ok: true, errors: [], module };
}
