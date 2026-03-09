// =============================================================================
// Test-Contract Bridge Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { generateTests } from "../../src/contracts/generate-tests.js";
import { handleGenerateTests } from "../../src/mcp/handlers.js";
import type { EdictModule, FunctionDef, Expression, Contract, Param } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers (same pattern as verify.test.ts)
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(): string { return `tgen-${++idCounter}`; }

function mkLit(value: number | boolean): Expression {
    const id = uid();
    if (typeof value === "boolean") {
        return { kind: "literal", id, value, type: { kind: "basic", name: "Bool" } } as any;
    }
    return { kind: "literal", id, value, type: Number.isInteger(value) ? { kind: "basic", name: "Int" } : { kind: "basic", name: "Float" } } as any;
}

function mkIdent(name: string): Expression {
    return { kind: "ident", id: uid(), name };
}

function mkBinop(op: string, left: Expression, right: Expression): Expression {
    return { kind: "binop", id: uid(), op, left, right } as any;
}

function mkParam(name: string, typeName: string): Param {
    return { name, type: { kind: "basic", name: typeName } };
}

function mkPre(condition: Expression): Contract {
    return { kind: "pre", id: uid(), condition };
}

function mkPost(condition: Expression): Contract {
    return { kind: "post", id: uid(), condition };
}

function mkFn(opts: {
    name?: string;
    params?: Param[];
    contracts?: Contract[];
    body?: Expression[];
}): FunctionDef {
    return {
        kind: "fn",
        id: uid(),
        name: opts.name ?? "testFn",
        params: opts.params ?? [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: opts.contracts ?? [],
        body: opts.body ?? [mkLit(0)],
    };
}

function mkModule(defs: FunctionDef[]): EdictModule {
    return {
        kind: "module",
        id: uid(),
        name: "test",
        imports: [],
        definitions: defs,
    };
}

// ---------------------------------------------------------------------------
// 1. Proven contract → boundary test with expectedOutput
// ---------------------------------------------------------------------------

describe("test-contract bridge — boundary tests from proven contracts", () => {
    it("generates boundary test for proven contract (pre x > 0, body x + 1, post result > 0)", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);

        const boundaryTests = result.tests.filter(t => t.source === "boundary");
        expect(boundaryTests.length).toBeGreaterThanOrEqual(1);

        const test = boundaryTests[0]!;
        expect(test.functionName).toBe("testFn");
        expect(test.inputs).toHaveProperty("x");
        expect(test.inputs.x).toBeGreaterThan(0); // satisfies precondition
        expect(test.expectedOutput).toBeDefined();
        expect(test.expectedOutput).toBeGreaterThan(0); // satisfies postcondition
        expect(test.shouldFail).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 2. Failing contract → counterexample test
// ---------------------------------------------------------------------------

describe("test-contract bridge — counterexample tests from failing contracts", () => {
    it("generates counterexample test when postcondition fails (body x, post result > 0, no pre)", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);

        const ceTests = result.tests.filter(t => t.source === "counterexample");
        expect(ceTests.length).toBeGreaterThanOrEqual(1);

        const test = ceTests[0]!;
        expect(test.functionName).toBe("testFn");
        expect(test.shouldFail).toBe(true);
        expect(test.inputs).toHaveProperty("x");
        expect(test.inputs.x).toBeLessThanOrEqual(0); // counterexample violates x > 0
    });
});

// ---------------------------------------------------------------------------
// 3. No contracts → empty tests
// ---------------------------------------------------------------------------

describe("test-contract bridge — no contracts", () => {
    it("returns empty tests for function with no contracts", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);
        expect(result.tests).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 4. Multiple contracts → tests from each
// ---------------------------------------------------------------------------

describe("test-contract bridge — multiple contracts", () => {
    it("generates tests from multiple postconditions", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(1))),
            ],
            body: [mkIdent("x")],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);

        // Should have boundary tests for both postconditions
        const boundaryTests = result.tests.filter(t => t.source === "boundary");
        expect(boundaryTests.length).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// 5. Unsupported param types → skipped
// ---------------------------------------------------------------------------

describe("test-contract bridge — unsupported param types", () => {
    it("skips functions with String params", async () => {
        const fn = mkFn({
            name: "strFn",
            params: [mkParam("s", "String")],
            contracts: [mkPost(mkLit(true))],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);
        expect(result.tests).toHaveLength(0);
        expect(result.skipped).toContain("strFn");
    });

    it("skips functions with array type params", async () => {
        const fn: FunctionDef = {
            kind: "fn",
            id: uid(),
            name: "arrFn",
            params: [{ name: "arr", type: { kind: "array", element: { kind: "basic", name: "Int" } } } as any],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [mkPost(mkLit(true))],
            body: [mkLit(0)],
        };
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);
        expect(result.tests).toHaveLength(0);
        expect(result.skipped).toContain("arrFn");
    });
});

// ---------------------------------------------------------------------------
// 6. Empty module → empty result
// ---------------------------------------------------------------------------

describe("test-contract bridge — empty module", () => {
    it("returns empty tests for module with no functions", async () => {
        const result = await generateTests(mkModule([]));
        expect(result.ok).toBe(true);
        expect(result.tests).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 7. Boolean parameters
// ---------------------------------------------------------------------------

describe("test-contract bridge — boolean parameters", () => {
    it("generates tests with boolean input values", async () => {
        const fn = mkFn({
            params: [mkParam("flag", "Bool")],
            contracts: [
                mkPre(mkIdent("flag")),
                mkPost(mkIdent("result")),
            ],
            body: [mkIdent("flag")],
            name: "boolFn",
        });
        // Override the return type to Bool
        (fn as any).returnType = { kind: "basic", name: "Bool" };

        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);

        const tests = result.tests.filter(t => t.functionName === "boolFn");
        expect(tests.length).toBeGreaterThanOrEqual(1);

        // All inputs should have boolean flag values
        for (const test of tests) {
            expect(typeof test.inputs.flag).toBe("boolean");
        }
    });
});

// ---------------------------------------------------------------------------
// 8. MCP handler validates AST before generating
// ---------------------------------------------------------------------------

describe("test-contract bridge — MCP handler", () => {
    it("returns errors for invalid AST", async () => {
        const result = await handleGenerateTests({ kind: "invalid" });
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("generates tests for valid AST via handler", async () => {
        // Build a valid inline AST that passes the full check() pipeline.
        // All expressions need type annotations for the type-checker.
        const ast = {
            kind: "module",
            id: "mod-test-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-abs-001",
                    name: "main",
                    params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [
                        {
                            kind: "pre",
                            id: "pre-001",
                            condition: {
                                kind: "binop", id: "cond-001", op: ">=",
                                left: { kind: "ident", id: "id-x-001", name: "x", type: { kind: "basic", name: "Int" } },
                                right: { kind: "literal", id: "lit-0-001", value: 0, type: { kind: "basic", name: "Int" } },
                                type: { kind: "basic", name: "Bool" },
                            },
                        },
                        {
                            kind: "post",
                            id: "post-001",
                            condition: {
                                kind: "binop", id: "cond-002", op: ">=",
                                left: { kind: "ident", id: "id-r-001", name: "result", type: { kind: "basic", name: "Int" } },
                                right: { kind: "literal", id: "lit-0-002", value: 0, type: { kind: "basic", name: "Int" } },
                                type: { kind: "basic", name: "Bool" },
                            },
                        },
                    ],
                    body: [{ kind: "ident", id: "body-001", name: "x", type: { kind: "basic", name: "Int" } }],
                },
            ],
        };

        const result = await handleGenerateTests(ast);
        expect(result.ok).toBe(true);
        expect(result.tests).toBeDefined();
        expect(result.tests!.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// 9. Precondition boundary tests
// ---------------------------------------------------------------------------

describe("test-contract bridge — precondition boundary tests", () => {
    it("generates precondition boundary tests", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(5))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkLit(5))],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);

        const preBoundary = result.tests.filter(t => t.source === "precondition_boundary");
        expect(preBoundary.length).toBeGreaterThanOrEqual(1);

        // The boundary value should satisfy the precondition
        for (const test of preBoundary) {
            expect(test.inputs.x).toBeGreaterThan(5);
        }
    });
});

// ---------------------------------------------------------------------------
// 10. Test structure correctness
// ---------------------------------------------------------------------------

describe("test-contract bridge — test structure", () => {
    it("each generated test has all required fields", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });
        const result = await generateTests(mkModule([fn]));
        expect(result.ok).toBe(true);

        for (const test of result.tests) {
            expect(test).toHaveProperty("functionName");
            expect(test).toHaveProperty("testName");
            expect(test).toHaveProperty("inputs");
            expect(test).toHaveProperty("source");
            expect(test).toHaveProperty("contractId");
            expect(typeof test.functionName).toBe("string");
            expect(typeof test.testName).toBe("string");
            expect(typeof test.source).toBe("string");
            expect(["boundary", "counterexample", "precondition_boundary"]).toContain(test.source);
        }
    });
});
