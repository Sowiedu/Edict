// =============================================================================
// Patch Handler
// =============================================================================

import { validate } from "../../validator/validate.js";
import { check } from "../../check.js";
import type { StructuredError } from "../../errors/structured-errors.js";
import { applyPatches, type AstPatch } from "../../patch/apply.js";
import { expandCompact } from "../../compact/expand.js";
import { migrateToLatest } from "../../migration/migrate.js";
import { incrementalCheck } from "../../incremental/check.js";
import type { EdictModule } from "../../ast/nodes.js";

// =============================================================================
// Result type
// =============================================================================

export interface PatchResult {
    ok: boolean;
    errors?: StructuredError[];
    patchedAst?: unknown;
    /** Definitions that were re-verified by Z3 (incremental mode only) */
    rechecked?: string[];
    /** Definitions for which Z3 verification was skipped (incremental mode only) */
    skipped?: string[];
}

// =============================================================================
// Handler
// =============================================================================

export async function handlePatch(
    baseAst: unknown,
    patches: AstPatch[],
    returnAst: boolean = false,
): Promise<PatchResult> {
    // Step 0: Expand compact format on base AST and patch values
    const expandedBase = expandCompact(baseAst);
    const migratedBase = migrateToLatest(expandedBase);
    if (!migratedBase.ok) return { ok: false, errors: migratedBase.errors };
    const expandedPatches = patches.map((p) => ({
        ...p,
        value: p.value !== undefined ? expandCompact(p.value) : p.value,
    }));

    // Step 1: Apply patches
    const patchResult = applyPatches(migratedBase.ast, expandedPatches);
    if (!patchResult.ok) {
        return { ok: false, errors: patchResult.errors };
    }

    // Step 2: Check — use incremental checking if base AST is a valid module
    const baseValidation = validate(migratedBase.ast);
    if (baseValidation.ok) {
        // Incremental: only re-verify contracts for changed definitions
        const incrResult = await incrementalCheck(
            migratedBase.ast as EdictModule,
            patchResult.ast as EdictModule,
        );
        if (!incrResult.ok) {
            const result: PatchResult = { ok: false, errors: incrResult.errors };
            if (returnAst) result.patchedAst = patchResult.ast;
            result.rechecked = incrResult.rechecked;
            result.skipped = incrResult.skipped;
            return result;
        }
        const result: PatchResult = { ok: true };
        if (returnAst) result.patchedAst = patchResult.ast;
        result.rechecked = incrResult.rechecked;
        result.skipped = incrResult.skipped;
        return result;
    }

    // Fallback: full check if base AST was invalid
    const checkResult = await check(patchResult.ast);
    if (!checkResult.ok) {
        const result: PatchResult = { ok: false, errors: checkResult.errors };
        if (returnAst) result.patchedAst = patchResult.ast;
        return result;
    }

    const result: PatchResult = { ok: true };
    if (returnAst) result.patchedAst = patchResult.ast;
    return result;
}
