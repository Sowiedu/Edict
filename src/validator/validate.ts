// =============================================================================
// Edict Validator — Main Entry Point
// =============================================================================
// validate(ast: unknown) → { ok: true } | { ok: false, errors: StructuredError[] }
//
// Accepts any JSON value and determines if it's a valid Edict AST.
// If valid, returns success. If invalid, returns ALL errors found.

import type { StructuredError } from "../errors/structured-errors.js";
import { IdTracker } from "./id-tracker.js";
import { validateModule } from "./node-validators.js";

export interface ValidationSuccess {
    ok: true;
}

export interface ValidationFailure {
    ok: false;
    errors: StructuredError[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate an unknown JSON value as an Edict module AST.
 *
 * Returns all errors found (does not stop at first error).
 * If no errors, the input is a structurally valid Edict program.
 */
export function validate(ast: unknown): ValidationResult {
    const errors: StructuredError[] = [];
    const idTracker = new IdTracker();

    validateModule(ast, "$", errors, idTracker);

    // Add any duplicate ID errors
    errors.push(...idTracker.getErrors());

    if (errors.length === 0) {
        return { ok: true };
    }

    return { ok: false, errors };
}
