// =============================================================================
// validate.ts branch coverage — validateFragmentAst error paths
// =============================================================================

import { describe, it, expect } from "vitest";
import { validate, validateFragmentAst } from "../../src/validator/validate.js";

describe("validate.ts — uncovered branches", () => {
    describe("validateFragmentAst()", () => {
        it("should return errors for an invalid fragment (non-empty error path)", () => {
            // validateFragmentAst forces fragment validation — an invalid fragment
            // with missing required fields should exercise the error-returning path (line 97)
            const result = validateFragmentAst({
                kind: "fragment",
                id: "frag-branch-001",
                // missing provides, requires, imports, definitions
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors.some((e) => e.error === "missing_field")).toBe(true);
            }
        });

        it("should return errors for fragment with invalid definitions", () => {
            // validateFragmentAst always validates as fragment — passing a fragment
            // with invalid definition nodes should produce errors
            const result = validateFragmentAst({
                kind: "fragment",
                id: "frag-branch-002",
                provides: [],
                requires: [],
                imports: [],
                definitions: [{ kind: "bad_kind", id: "bad-001" }],
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.errors.some((e) => e.error === "unknown_node_kind")).toBe(true);
            }
        });

        it("should handle migration failure in validateFragmentAst", () => {
            // A very old schemaVersion that fails migration should hit the early-return
            // error path at line 81
            const result = validateFragmentAst({
                kind: "fragment",
                id: "frag-mig-fail",
                schemaVersion: "99.0",
                provides: [],
                requires: [],
                imports: [],
                definitions: [],
            });
            // Should fail with migration error
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.errors.length).toBeGreaterThan(0);
            }
        });
    });

    describe("validate() — migration error path", () => {
        it("should return migration error for unsupported schema version", () => {
            const result = validate({
                kind: "module",
                id: "mod-mig-fail",
                name: "test",
                schemaVersion: "99.0",
                imports: [],
                definitions: [],
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.errors.length).toBeGreaterThan(0);
            }
        });
    });

    describe("validate() — non-object inputs", () => {
        it("should handle null input gracefully", () => {
            const result = validate(null);
            expect(result.ok).toBe(false);
        });

        it("should handle array input gracefully", () => {
            const result = validate([1, 2, 3]);
            expect(result.ok).toBe(false);
        });
    });
});
