import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validate } from "../../src/validator/validate.js";
import { resolve } from "../../src/resolver/resolve.js";
import { typeCheck } from "../../src/checker/check.js";
import { effectCheck } from "../../src/effects/effect-check.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import {
    arbModule,
    arbFunctionDef,
    arbExpression,
    resetIdCounter,
} from "./arbitraries.js";

// =============================================================================
// Fuzz tests for semantic stages — structurally valid but semantically wrong
// =============================================================================
// Strategy: take valid-looking ASTs (from arbitraries), then run through
// resolve → typeCheck → effectCheck (skipping Z3).
// Property: never throws, always returns StructuredError[].

/** Run through the semantic pipeline stages (no Z3). Returns without crashing. */
function runSemanticPipeline(ast: unknown): {
    phase: "validate" | "resolve" | "typeCheck" | "effectCheck" | "clean";
    errorCount: number;
} {
    const vResult = validate(ast);
    if (!vResult.ok) {
        return { phase: "validate", errorCount: vResult.errors.length };
    }

    const module = ast as EdictModule;
    const rErrors = resolve(module);
    if (rErrors.length > 0) {
        return { phase: "resolve", errorCount: rErrors.length };
    }

    const tErrors = typeCheck(module);
    if (tErrors.length > 0) {
        return { phase: "typeCheck", errorCount: tErrors.length };
    }

    const eErrors = effectCheck(module);
    if (eErrors.length > 0) {
        return { phase: "effectCheck", errorCount: eErrors.length };
    }

    return { phase: "clean", errorCount: 0 };
}

describe("fuzz — semantic pipeline", () => {
    beforeEach(() => resetIdCounter());

    // =========================================================================
    // Property 1: Random identifier names in function body
    // =========================================================================
    it("never throws on random identifier names in body", () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1, maxLength: 30 }), (randomName) => {
                const ast = {
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
                            body: [
                                { kind: "ident", id: "fuzz-ident-001", name: randomName },
                            ],
                        },
                    ],
                };

                const result = runSemanticPipeline(ast);
                expect(result.phase).toBe("resolve"); // random names → undefined_reference
            }),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 2: Random type names in parameters and return type
    // =========================================================================
    it("never throws on random basic type names", () => {
        const typeNames = ["Int", "Float", "String", "Bool", "Void", "Number", "Any", "Unknown", ""];

        fc.assert(
            fc.property(
                fc.constantFrom(...typeNames),
                fc.constantFrom(...typeNames),
                (paramType, retType) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-mod-001",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-fn-001",
                                name: "main",
                                params: [
                                    {
                                        kind: "param",
                                        id: "fuzz-param-001",
                                        name: "x",
                                        type: { kind: "basic", name: paramType },
                                    },
                                ],
                                effects: ["pure"],
                                returnType: { kind: "basic", name: retType },
                                contracts: [],
                                body: [{ kind: "literal", id: "fuzz-lit-001", value: 42 }],
                            },
                        ],
                    };

                    const result = runSemanticPipeline(ast);
                    expect(result).toBeDefined();
                },
            ),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 3: Random effect combinations
    // =========================================================================
    it("never throws on random effect combinations", () => {
        const allEffects = ["pure", "reads", "writes", "io", "fails"];

        fc.assert(
            fc.property(
                fc.subarray(allEffects, { minLength: 1, maxLength: 5 }),
                (effects) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-mod-001",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-fn-001",
                                name: "helper",
                                params: [],
                                effects,
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [{ kind: "literal", id: "fuzz-lit-001", value: 1 }],
                            },
                            {
                                kind: "fn",
                                id: "fuzz-fn-002",
                                name: "main",
                                params: [],
                                effects: ["pure"],
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [
                                    {
                                        kind: "call",
                                        id: "fuzz-call-001",
                                        fn: { kind: "ident", id: "fuzz-ident-001", name: "helper" },
                                        args: [],
                                    },
                                ],
                            },
                        ],
                    };

                    // Some combinations are rejected by validator (pure+io).
                    // The property: never crashes.
                    const result = runSemanticPipeline(ast);
                    expect(result).toBeDefined();
                },
            ),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 4: Random binary operator values
    // =========================================================================
    it("never throws on random operator strings", () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1, maxLength: 10 }), (op) => {
                const ast = {
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
                            body: [
                                {
                                    kind: "binop",
                                    id: "fuzz-binop-001",
                                    op,
                                    left: { kind: "literal", id: "fuzz-lit-001", value: 1 },
                                    right: { kind: "literal", id: "fuzz-lit-002", value: 2 },
                                },
                            ],
                        },
                    ],
                };

                const result = validate(ast);
                expect(result).toBeDefined();
                expect(typeof result.ok).toBe("boolean");
            }),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 5: Randomly generated modules through full semantic pipeline
    // =========================================================================
    it("never throws on randomly generated AST modules through pipeline", () => {
        fc.assert(
            fc.property(
                arbModule({ maxFunctions: 3, maxBodyDepth: 2 }),
                (module) => {
                    const result = runSemanticPipeline(module);
                    expect(result).toBeDefined();
                    // Most random modules will have semantic errors — that's fine.
                    // The property: no crashes.
                },
            ),
            { numRuns: 500 },
        );
    });

    // =========================================================================
    // Property 6: Random expression trees through semantic pipeline
    // =========================================================================
    it("never throws on random expression trees through semantic pipeline", () => {
        fc.assert(
            fc.property(
                arbExpression(3),
                (expr) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-sem-mod",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-sem-fn",
                                name: "main",
                                params: [],
                                effects: ["io"],
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [expr],
                            },
                        ],
                    };
                    const result = runSemanticPipeline(ast);
                    expect(result).toBeDefined();
                },
            ),
            { numRuns: 500 },
        );
    });
});
