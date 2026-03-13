import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";

// =============================================================================
// Error suggestion tests — verify FixSuggestion on missing_field and unknown_node_kind
// =============================================================================

describe("error suggestions", () => {
    it("missing_field for returnType includes FixSuggestion", () => {
        const result = validate({
            kind: "module", id: "m1", name: "test",
            imports: [],
            definitions: [{
                kind: "fn", id: "fn1", name: "test",
                params: [{
                    kind: "param", id: "p1", name: "f",
                    type: {
                        kind: "fn_type",
                        params: [{ kind: "basic", name: "Int" }],
                        effects: ["pure"],
                        // returnType deliberately omitted
                    },
                }],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "l1", value: 0 }],
            }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const rtError = result.errors.find(
                (e) => e.error === "missing_field" && e.field === "returnType",
            );
            expect(rtError).toBeDefined();
            expect(rtError).toHaveProperty("suggestion");
            if (rtError && "suggestion" in rtError) {
                expect(rtError.suggestion).toMatchObject({
                    field: "returnType",
                    value: { kind: "basic", name: "Int" },
                });
            }
        }
    });

    it("unknown_node_kind includes suggestion for close Levenshtein match", () => {
        // "reord" is Levenshtein distance 2 from "record" — should get a suggestion
        const result = validate({
            kind: "module", id: "m1", name: "test",
            imports: [],
            definitions: [{
                kind: "reord", id: "r1", name: "Foo",
                fields: [],
            }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const kindError = result.errors.find(
                (e) => e.error === "unknown_node_kind" && e.received === "reord",
            );
            expect(kindError).toBeDefined();
            expect(kindError).toHaveProperty("suggestion");
            if (kindError && "suggestion" in kindError) {
                expect(kindError.suggestion).toMatchObject({
                    field: "kind",
                    value: "record",
                });
            }
        }
    });

    it("unknown_node_kind without close match has no suggestion", () => {
        const result = validate({
            kind: "module", id: "m1", name: "test",
            imports: [],
            definitions: [{
                kind: "zzzzz", id: "z1", name: "Foo",
                fields: [],
            }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const kindError = result.errors.find(
                (e) => e.error === "unknown_node_kind" && e.received === "zzzzz",
            );
            expect(kindError).toBeDefined();
            // "zzzzz" is far from any valid kind — no suggestion
            if (kindError && "suggestion" in kindError) {
                expect(kindError.suggestion).toBeUndefined();
            }
        }
    });

    it("kind synonym 'struct' is auto-fixed — no error", () => {
        const result = validate({
            kind: "module", id: "m1", name: "test",
            imports: [],
            definitions: [{
                kind: "struct", id: "r1", name: "Point",
                fields: [
                    { kind: "field", id: "f1", name: "x", type: { kind: "basic", name: "Int" } },
                ],
            }],
        });
        expect(result.ok).toBe(true);
    });
});
