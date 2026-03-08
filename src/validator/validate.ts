// =============================================================================
// Edict Validator — Main Entry Point
// =============================================================================
// validate(ast: unknown) → { ok: true } | { ok: false, errors: StructuredError[] }
//
// Accepts any JSON value and determines if it's a valid Edict AST.
// Auto-detects modules and fragments based on `kind`.
// If valid, returns success. If invalid, returns ALL errors found.

import type { StructuredError } from "../errors/structured-errors.js";
import { IdTracker } from "./id-tracker.js";
import { validateModule, validateFragment } from "./schema-walker.js";

export interface ValidationSuccess {
    ok: true;
}

export interface ValidationFailure {
    ok: false;
    errors: StructuredError[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate an unknown JSON value as an Edict AST (module or fragment).
 *
 * Auto-detects `kind: "module"` vs `kind: "fragment"`.
 * Returns all errors found (does not stop at first error).
 */
export function validate(ast: unknown): ValidationResult {
    const errors: StructuredError[] = [];
    const idTracker = new IdTracker();

    // Auto-detect fragment vs module
    if (
        typeof ast === "object" &&
        ast !== null &&
        !Array.isArray(ast) &&
        (ast as Record<string, unknown>)["kind"] === "fragment"
    ) {
        validateFragment(ast, "$", errors, idTracker);
    } else {
        validateModule(ast, "$", errors, idTracker);
    }

    // Add any duplicate ID errors
    errors.push(...idTracker.getErrors());

    if (errors.length === 0) {
        return { ok: true };
    }

    return { ok: false, errors };
}

/**
 * Validate an unknown JSON value specifically as an Edict fragment.
 *
 * Returns all errors found (does not stop at first error).
 */
export function validateFragmentAst(ast: unknown): ValidationResult {
    const errors: StructuredError[] = [];
    const idTracker = new IdTracker();

    validateFragment(ast, "$", errors, idTracker);

    errors.push(...idTracker.getErrors());

    if (errors.length === 0) {
        return { ok: true };
    }

    return { ok: false, errors };
}
