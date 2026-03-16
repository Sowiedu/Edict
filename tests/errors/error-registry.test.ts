// =============================================================================
// error-registry.ts branch coverage — inferFieldType + deriveFieldsFromSample edge cases
// =============================================================================

import { describe, it, expect } from "vitest";
import { inferFieldType, deriveFieldsFromSample, ERROR_REGISTRY } from "../../src/errors/error-registry.js";

describe("error-registry.ts — uncovered branches", () => {
    describe("inferFieldType()", () => {
        it("returns 'null' for null", () => {
            expect(inferFieldType(null)).toBe("null");
        });

        it("returns 'undefined' for undefined", () => {
            expect(inferFieldType(undefined)).toBe("undefined");
        });

        it("returns 'string' for string values", () => {
            expect(inferFieldType("hello")).toBe("string");
        });

        it("returns 'number' for number values", () => {
            expect(inferFieldType(42)).toBe("number");
        });

        it("returns 'boolean' for boolean values", () => {
            expect(inferFieldType(true)).toBe("boolean");
            expect(inferFieldType(false)).toBe("boolean");
        });

        it("returns 'unknown[]' for empty arrays", () => {
            expect(inferFieldType([])).toBe("unknown[]");
        });

        it("returns element type + '[]' for non-empty arrays", () => {
            expect(inferFieldType(["a", "b"])).toBe("string[]");
            expect(inferFieldType([1, 2])).toBe("number[]");
        });

        it("returns 'TypeExpr' for objects with string 'kind' field", () => {
            expect(inferFieldType({ kind: "basic", name: "Int" })).toBe("TypeExpr");
        });

        it("returns 'FixSuggestion' for objects with nodeId+field+value", () => {
            expect(inferFieldType({ nodeId: "n", field: "f", value: "v" })).toBe("FixSuggestion");
        });

        it("returns 'Record<string, unknown>' for generic objects", () => {
            // Object without kind, nodeId, field, or value — this is the uncovered branch (line 201)
            expect(inferFieldType({ x: 1, y: 2 })).toBe("Record<string, unknown>");
            expect(inferFieldType({ scope: "per_call", reason: "test" })).toBe("Record<string, unknown>");
        });

        it("returns 'unknown' for unexpected types like functions", () => {
            expect(inferFieldType(() => {})).toBe("unknown");
            expect(inferFieldType(Symbol("test"))).toBe("unknown");
        });

        it("handles nested arrays correctly", () => {
            expect(inferFieldType([[1, 2], [3, 4]])).toBe("number[][]");
        });
    });

    describe("deriveFieldsFromSample()", () => {
        it("derives fields from a basic registry entry", () => {
            // Use any entry without makeWithOptionals
            const basicEntry = ERROR_REGISTRY.find(e => e.type === "duplicate_id");
            expect(basicEntry).toBeDefined();

            const fields = deriveFieldsFromSample(basicEntry!);
            expect(fields.length).toBeGreaterThan(0);
            // Every field should have name and type
            for (const f of fields) {
                expect(f.name).toBeTruthy();
                expect(f.type).toBeTruthy();
            }
        });

        it("marks optional fields with '?' suffix", () => {
            // Use an entry WITH makeWithOptionals
            const optionalEntry = ERROR_REGISTRY.find(e => e.type === "type_mismatch");
            expect(optionalEntry).toBeDefined();
            expect(optionalEntry!.makeWithOptionals).toBeDefined();

            const fields = deriveFieldsFromSample(optionalEntry!);
            const optionalFields = fields.filter(f => f.type.endsWith("?"));
            expect(optionalFields.length).toBeGreaterThan(0);
            // suggestion should be optional
            expect(optionalFields.some(f => f.name === "suggestion")).toBe(true);
        });

        it("uses value from optionalSample for optional fields", () => {
            // When deriving fields for an entry with makeWithOptionals,
            // optional fields should get their type from the optionalSample
            const entryWithOptionals = ERROR_REGISTRY.find(e => e.type === "undefined_reference");
            expect(entryWithOptionals).toBeDefined();

            const fields = deriveFieldsFromSample(entryWithOptionals!);
            const suggestionField = fields.find(f => f.name === "suggestion");
            expect(suggestionField).toBeDefined();
            // Type should be FixSuggestion? (derived from optional sample)
            expect(suggestionField!.type).toBe("FixSuggestion?");
        });

        it("covers every registry entry without error", () => {
            // Sanity check: deriveFieldsFromSample should work for all entries
            for (const entry of ERROR_REGISTRY) {
                const fields = deriveFieldsFromSample(entry);
                expect(fields.length).toBeGreaterThan(0);
            }
        });
    });
});
