// =============================================================================
// Blame Annotation Validation Tests
// =============================================================================
// Tests that the schema-driven validator correctly handles blame annotations
// on module and function nodes.

import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";

// =============================================================================
// Helpers — minimal valid module with blame
// =============================================================================

function baseModule(overrides: Record<string, unknown> = {}) {
    return {
        kind: "module",
        id: "mod-001",
        name: "test",
        imports: [],
        definitions: [{
            kind: "fn",
            id: "fn-001",
            name: "main",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "literal", id: "lit-001", value: 0 }],
        }],
        ...overrides,
    };
}

// =============================================================================
// Tests
// =============================================================================

describe("blame annotation validation", () => {
    it("accepts module with valid blame annotation", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://payment-specialist-v3",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 0.92,
                sourcePrompt: "sha256:abc123",
            },
        }));
        expect(result.ok).toBe(true);
    });

    it("accepts module with blame without optional sourcePrompt", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://general",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 0.75,
            },
        }));
        expect(result.ok).toBe(true);
    });

    it("accepts module with minConfidence field", () => {
        const result = validate(baseModule({
            minConfidence: 0.85,
        }));
        expect(result.ok).toBe(true);
    });

    it("accepts module without blame (backward compatible)", () => {
        const result = validate(baseModule());
        expect(result.ok).toBe(true);
    });

    it("accepts function with valid blame annotation", () => {
        const result = validate(baseModule({
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "helper",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                blame: {
                    author: "agent://specialist",
                    generatedAt: "2026-03-10T00:00:00Z",
                    confidence: 0.95,
                },
                body: [{ kind: "literal", id: "lit-001", value: 42 }],
            }],
        }));
        expect(result.ok).toBe(true);
    });

    it("rejects blame with non-string author", () => {
        const result = validate(baseModule({
            blame: {
                author: 123,
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 0.9,
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const authorErr = result.errors.find(
                e => e.error === "invalid_field_type" && e.field === "author",
            );
            expect(authorErr).toBeDefined();
        }
    });

    it("rejects blame with non-number confidence", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://test",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: "high",
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const confErr = result.errors.find(
                e => e.error === "invalid_field_type" && e.field === "confidence",
            );
            expect(confErr).toBeDefined();
        }
    });

    it("rejects blame missing required author field", () => {
        const result = validate(baseModule({
            blame: {
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 0.9,
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const missingErr = result.errors.find(
                e => e.error === "missing_field" && e.field === "author",
            );
            expect(missingErr).toBeDefined();
        }
    });

    it("rejects blame missing required generatedAt field", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://test",
                confidence: 0.9,
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const missingErr = result.errors.find(
                e => e.error === "missing_field" && e.field === "generatedAt",
            );
            expect(missingErr).toBeDefined();
        }
    });

    it("rejects blame missing required confidence field", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://test",
                generatedAt: "2026-03-10T00:00:00Z",
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const missingErr = result.errors.find(
                e => e.error === "missing_field" && e.field === "confidence",
            );
            expect(missingErr).toBeDefined();
        }
    });

    it("rejects non-number minConfidence", () => {
        const result = validate(baseModule({
            minConfidence: "high",
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const typeErr = result.errors.find(
                e => e.error === "invalid_field_type" && e.field === "minConfidence",
            );
            expect(typeErr).toBeDefined();
        }
    });

    // =========================================================================
    // Confidence range validation (0–1)
    // =========================================================================

    it("rejects blame confidence > 1", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://test",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 5.0,
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const rangeErr = result.errors.find(
                e => e.error === "invalid_field_type" && e.field === "confidence",
            );
            expect(rangeErr).toBeDefined();
        }
    });

    it("rejects blame confidence < 0", () => {
        const result = validate(baseModule({
            blame: {
                author: "agent://test",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: -0.5,
            },
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const rangeErr = result.errors.find(
                e => e.error === "invalid_field_type" && e.field === "confidence",
            );
            expect(rangeErr).toBeDefined();
        }
    });

    it("rejects minConfidence > 1", () => {
        const result = validate(baseModule({
            minConfidence: 1.5,
        }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const rangeErr = result.errors.find(
                e => e.error === "invalid_field_type" && e.field === "minConfidence",
            );
            expect(rangeErr).toBeDefined();
        }
    });

    it("accepts confidence boundary values (0 and 1)", () => {
        const resultZero = validate(baseModule({
            blame: {
                author: "agent://test",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 0,
            },
        }));
        expect(resultZero.ok).toBe(true);

        const resultOne = validate(baseModule({
            blame: {
                author: "agent://test",
                generatedAt: "2026-03-10T00:00:00Z",
                confidence: 1,
            },
        }));
        expect(resultOne.ok).toBe(true);
    });

    // =========================================================================
    // Blame on non-function definitions
    // =========================================================================

    it("accepts blame on record definitions", () => {
        const result = validate(baseModule({
            definitions: [
                {
                    kind: "fn", id: "fn-001", name: "main",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                },
                {
                    kind: "record", id: "rec-001", name: "Point",
                    fields: [
                        { kind: "field", id: "f-x", name: "x", type: { kind: "basic", name: "Int" } },
                        { kind: "field", id: "f-y", name: "y", type: { kind: "basic", name: "Int" } },
                    ],
                    blame: {
                        author: "agent://schema-designer",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.98,
                    },
                },
            ],
        }));
        expect(result.ok).toBe(true);
    });

    it("accepts blame on const definitions", () => {
        const result = validate(baseModule({
            definitions: [
                {
                    kind: "fn", id: "fn-001", name: "main",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                },
                {
                    kind: "const", id: "const-001", name: "MAX_SIZE",
                    type: { kind: "basic", name: "Int" },
                    value: { kind: "literal", id: "lit-max", value: 100 },
                    blame: {
                        author: "agent://config-agent",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.99,
                    },
                },
            ],
        }));
        expect(result.ok).toBe(true);
    });
});
