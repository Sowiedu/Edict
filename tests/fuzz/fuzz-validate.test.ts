import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validate } from "../../src/validator/validate.js";
import {
    arbModule,
    arbExpression,
    arbCorruptedModule,
    resetIdCounter,
} from "./arbitraries.js";

// =============================================================================
// Fuzz tests for validate() — the first line of defense
// =============================================================================
// Property: validate(anything) NEVER throws. Always returns { ok: true | false }.
// This is critical because agents send arbitrary JSON.

/** Assert validate returns a well-formed result and never throws. */
function expectValidResult(input: unknown) {
    const result = validate(input);
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe("boolean");
    if (!result.ok) {
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result.errors.length).toBeGreaterThan(0);
        // Every error must have an `error` field (structured)
        for (const err of result.errors) {
            expect(typeof err.error).toBe("string");
        }
    }
}

describe("fuzz — validate()", () => {
    beforeEach(() => resetIdCounter());

    // =========================================================================
    // Property 1: Arbitrary JSON values never crash the validator
    // =========================================================================
    it("never throws on arbitrary JSON values", () => {
        fc.assert(
            fc.property(fc.anything(), (input) => {
                expectValidResult(input);
            }),
            { numRuns: 1000 },
        );
    });

    // =========================================================================
    // Property 2: Objects with random kind values never crash
    // =========================================================================
    it("never throws on objects with random kind values", () => {
        fc.assert(
            fc.property(
                fc.record({
                    kind: fc.string(),
                    id: fc.string(),
                    name: fc.string(),
                    imports: fc.constant([]),
                    definitions: fc.constant([]),
                }),
                (input) => {
                    expectValidResult(input);
                },
            ),
            { numRuns: 1000 },
        );
    });

    // =========================================================================
    // Property 3: Valid modules with random field deletions never crash
    // =========================================================================
    it("never throws on valid modules with random fields deleted", () => {
        const validModule = {
            kind: "module",
            id: "fuzz-mod-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fuzz-fn-001",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "fuzz-lit-001", value: 42 }],
                },
            ],
        };

        const topLevelKeys = Object.keys(validModule);
        const fnKeys = Object.keys(
            (validModule.definitions[0] as Record<string, unknown>),
        );

        fc.assert(
            fc.property(
                fc.subarray(topLevelKeys, { minLength: 0, maxLength: topLevelKeys.length }),
                fc.subarray(fnKeys, { minLength: 0, maxLength: fnKeys.length }),
                (keysToKeep, fnKeysToKeep) => {
                    const mutated: Record<string, unknown> = {};
                    for (const key of keysToKeep) {
                        mutated[key] = (validModule as Record<string, unknown>)[key];
                    }

                    if (mutated.definitions && Array.isArray(mutated.definitions) && mutated.definitions.length > 0) {
                        const fnDef = { ...(validModule.definitions[0] as Record<string, unknown>) };
                        const fnMutated: Record<string, unknown> = {};
                        for (const key of fnKeysToKeep) {
                            fnMutated[key] = fnDef[key];
                        }
                        mutated.definitions = [fnMutated];
                    }

                    expectValidResult(mutated);
                },
            ),
            { numRuns: 1000 },
        );
    });

    // =========================================================================
    // Property 4: Valid modules with type-swapped fields never crash
    // =========================================================================
    it("never throws on modules with type-swapped field values", () => {
        fc.assert(
            fc.property(
                fc.record({
                    kind: fc.constant("module"),
                    id: fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)),
                    name: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                    imports: fc.oneof(fc.constant([]), fc.string(), fc.integer(), fc.constant(null)),
                    definitions: fc.oneof(
                        fc.constant([]),
                        fc.string(),
                        fc.integer(),
                        fc.constant(null),
                        fc.array(fc.anything(), { maxLength: 3 }),
                    ),
                }),
                (input) => {
                    expectValidResult(input);
                },
            ),
            { numRuns: 1000 },
        );
    });

    // =========================================================================
    // Property 5: Primitive and degenerate values never crash
    // =========================================================================
    it("never throws on primitive and degenerate values", () => {
        const degenerateValues = [
            null, undefined, 0, 1, -1, NaN, Infinity, -Infinity,
            "", "hello", true, false, [], [1, 2, 3], {},
            { kind: null }, { kind: 42 }, { kind: "module" },
            { kind: "module", id: null },
            { kind: "module", id: "x", name: "y" },
            { kind: "module", id: "x", name: "y", imports: "bad" },
            { kind: "module", id: "x", name: "y", imports: [], definitions: "bad" },
        ];

        for (const value of degenerateValues) {
            expectValidResult(value);
        }
    });

    // =========================================================================
    // Property 6: Structure-aware random AST modules never crash
    // =========================================================================
    it("never throws on randomly generated AST modules", () => {
        fc.assert(
            fc.property(
                arbModule({ maxFunctions: 3, maxBodyDepth: 3 }),
                (module) => {
                    expectValidResult(module);
                },
            ),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 7: "Almost valid" corrupted modules never crash
    // =========================================================================
    it("never throws on almost-valid corrupted modules", () => {
        fc.assert(
            fc.property(
                arbCorruptedModule(),
                (module) => {
                    expectValidResult(module);
                },
            ),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 8: Random expression trees as top-level never crash
    // =========================================================================
    it("never throws when random expression trees are in function body", () => {
        fc.assert(
            fc.property(
                arbExpression(4),
                (expr) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-expr-mod",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-expr-fn",
                                name: "main",
                                params: [],
                                effects: ["pure"],
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [expr],
                            },
                        ],
                    };
                    expectValidResult(ast);
                },
            ),
            { numRuns: 500 },
        );
    });
});
