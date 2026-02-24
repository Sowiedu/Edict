// =============================================================================
// ID Tracker — Duplicate ID Detection
// =============================================================================
// Walks the AST and collects all `id` fields, detecting duplicates.

import type { StructuredError } from "../errors/structured-errors.js";
import { duplicateId } from "../errors/structured-errors.js";

export class IdTracker {
    private seen = new Map<string, string>(); // id -> first path
    private errors: StructuredError[] = [];

    /**
     * Register an ID at a given AST path. If duplicate, records an error.
     */
    track(id: string, path: string): void {
        const existing = this.seen.get(id);
        if (existing !== undefined) {
            this.errors.push(duplicateId(id, existing, path));
        } else {
            this.seen.set(id, path);
        }
    }

    /**
     * Return all duplicate ID errors found.
     */
    getErrors(): StructuredError[] {
        return this.errors;
    }
}
