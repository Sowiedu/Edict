import { describe, it, expect } from "vitest";
import { buildDepGraph, transitiveDependents } from "../../src/incremental/dep-graph.js";
import { diffDefinitions } from "../../src/incremental/diff.js";
import { incrementalCheck } from "../../src/incremental/check.js";
import { check } from "../../src/check.js";
import type { EdictModule, FunctionDef, Definition, Expression } from "../../src/ast/nodes.js";

// =============================================================================
// Test Helpers
// =============================================================================

function makeModule(defs: Definition[], imports: EdictModule["imports"] = []): EdictModule {
    return {
        kind: "module",
        id: "mod-test-001",
        name: "test",
        imports,
        definitions: defs,
    };
}

function makeFn(
    name: string,
    body: Expression[],
    opts: Partial<FunctionDef> = {},
): FunctionDef {
    return {
        kind: "fn",
        id: `fn-${name}-001`,
        name,
        params: opts.params ?? [],
        effects: opts.effects ?? ["pure"],
        returnType: opts.returnType ?? { kind: "basic", name: "Int" },
        contracts: opts.contracts ?? [],
        body,
        ...opts,
    };
}

function lit(value: number | string | boolean, id?: string): Expression {
    return { kind: "literal", id: id ?? `lit-${value}`, value };
}

function ident(name: string, id?: string): Expression {
    return { kind: "ident", id: id ?? `id-${name}`, name };
}

function call(fnName: string, args: Expression[] = [], id?: string): Expression {
    return {
        kind: "call",
        id: id ?? `call-${fnName}`,
        fn: { kind: "ident", id: `id-${fnName}`, name: fnName },
        args,
    };
}

// =============================================================================
// Dependency Graph Tests
// =============================================================================

describe("incremental — buildDepGraph", () => {
    it("detects call edges between functions", () => {
        const module = makeModule([
            makeFn("a", [call("b")]),
            makeFn("b", [lit(1)]),
        ]);
        const graph = buildDepGraph(module);

        expect(graph.forward.get("a")?.has("b")).toBe(true);
        expect(graph.forward.get("b")?.size).toBe(0);
    });

    it("detects linear call chain A → B → C", () => {
        const module = makeModule([
            makeFn("a", [call("b")]),
            makeFn("b", [call("c")]),
            makeFn("c", [lit(1)]),
        ]);
        const graph = buildDepGraph(module);

        expect(graph.forward.get("a")?.has("b")).toBe(true);
        expect(graph.forward.get("b")?.has("c")).toBe(true);
        expect(graph.forward.get("c")?.size).toBe(0);

        expect(graph.reverse.get("c")?.has("b")).toBe(true);
        expect(graph.reverse.get("b")?.has("a")).toBe(true);
    });

    it("detects type reference edges (record_expr)", () => {
        const module = makeModule([
            makeFn("a", [{
                kind: "record_expr", id: "re-1", name: "Point",
                fields: [
                    { kind: "field_init", name: "x", value: lit(1) },
                    { kind: "field_init", name: "y", value: lit(2) },
                ],
            }]),
            {
                kind: "record", id: "rec-Point-001", name: "Point",
                fields: [
                    { kind: "field", id: "f-x-001", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y-001", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
        ]);
        const graph = buildDepGraph(module);

        expect(graph.forward.get("a")?.has("Point")).toBe(true);
    });

    it("disconnected definitions have no edges", () => {
        const module = makeModule([
            makeFn("a", [lit(1)]),
            makeFn("b", [lit(2)]),
        ]);
        const graph = buildDepGraph(module);

        expect(graph.forward.get("a")?.size).toBe(0);
        expect(graph.forward.get("b")?.size).toBe(0);
    });
});

// =============================================================================
// Transitive Dependents Tests
// =============================================================================

describe("incremental — transitiveDependents", () => {
    it("computes transitive closure: changing C affects B and A", () => {
        const module = makeModule([
            makeFn("a", [call("b")]),
            makeFn("b", [call("c")]),
            makeFn("c", [lit(1)]),
        ]);
        const graph = buildDepGraph(module);
        const affected = transitiveDependents(graph, new Set(["c"]));

        expect(affected.has("c")).toBe(true);
        expect(affected.has("b")).toBe(true);
        expect(affected.has("a")).toBe(true);
    });

    it("changing a disconnected definition doesn't affect others", () => {
        const module = makeModule([
            makeFn("a", [lit(1)]),
            makeFn("b", [lit(2)]),
        ]);
        const graph = buildDepGraph(module);
        const affected = transitiveDependents(graph, new Set(["a"]));

        expect(affected.has("a")).toBe(true);
        expect(affected.has("b")).toBe(false);
    });

    it("handles self-recursive function without infinite loop", () => {
        const module = makeModule([
            makeFn("fib", [call("fib")]),
        ]);
        const graph = buildDepGraph(module);
        const affected = transitiveDependents(graph, new Set(["fib"]));

        expect(affected.has("fib")).toBe(true);
        expect(affected.size).toBe(1);
    });
});

// =============================================================================
// Definition Diff Tests
// =============================================================================

describe("incremental — diffDefinitions", () => {
    it("detects body change", () => {
        const before = makeModule([makeFn("a", [lit(1)])]);
        const after = makeModule([makeFn("a", [lit(2)])]);
        const changed = diffDefinitions(before, after);

        expect(changed.has("a")).toBe(true);
    });

    it("detects param type change", () => {
        const before = makeModule([makeFn("a", [ident("x")], {
            params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
        })]);
        const after = makeModule([makeFn("a", [ident("x")], {
            params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Float" } }],
        })]);
        const changed = diffDefinitions(before, after);

        expect(changed.has("a")).toBe(true);
    });

    it("returns empty set for no-op change", () => {
        const module = makeModule([makeFn("a", [lit(42)])]);
        const changed = diffDefinitions(module, module);

        expect(changed.size).toBe(0);
    });

    it("detects added definition", () => {
        const before = makeModule([makeFn("a", [lit(1)])]);
        const after = makeModule([
            makeFn("a", [lit(1)]),
            makeFn("b", [lit(2)]),
        ]);
        const changed = diffDefinitions(before, after);

        expect(changed.has("b")).toBe(true);
        expect(changed.has("a")).toBe(false);
    });

    it("detects deleted definition", () => {
        const before = makeModule([
            makeFn("a", [lit(1)]),
            makeFn("b", [lit(2)]),
        ]);
        const after = makeModule([makeFn("a", [lit(1)])]);
        const changed = diffDefinitions(before, after);

        expect(changed.has("b")).toBe(true);
        expect(changed.has("a")).toBe(false);
    });

    it("import change marks fns as dirty", () => {
        const before = makeModule(
            [makeFn("a", [lit(1)])],
            [{ kind: "import", id: "imp-1", module: "std", names: ["print"], types: {} }],
        );
        const after = makeModule(
            [makeFn("a", [lit(1)])],
            [{ kind: "import", id: "imp-1", module: "std", names: ["print", "log"], types: {} }],
        );
        const changed = diffDefinitions(before, after);

        expect(changed.has("a")).toBe(true);
    });
});

// =============================================================================
// Incremental Check Correctness Tests
// =============================================================================

describe("incremental — incrementalCheck correctness", () => {
    it("produces same errors as full check for simple module", async () => {
        const before = makeModule([
            makeFn("add", [
                { kind: "binop", id: "b-1", op: "+", left: ident("x"), right: ident("y") },
            ], {
                params: [
                    { kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-y-001", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            }),
            makeFn("main", [call("add", [lit(1), lit(2)])]),
        ]);

        // Change 'add' return type, but keep the call in 'main'
        const after = makeModule([
            makeFn("add", [
                { kind: "binop", id: "b-1", op: "+", left: ident("x"), right: ident("y") },
            ], {
                params: [
                    { kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-y-001", name: "y", type: { kind: "basic", name: "Int" } },
                ],
                returnType: { kind: "basic", name: "Float" },
            }),
            makeFn("main", [call("add", [lit(1), lit(2)])]),
        ]);

        const fullResult = await check(after);
        const incrResult = await incrementalCheck(before, after);

        // Both should detect the type mismatch (Int body, Float return)
        expect(incrResult.ok).toBe(fullResult.ok);
        expect(incrResult.errors.length).toBe(fullResult.errors.length);
        for (let i = 0; i < incrResult.errors.length; i++) {
            expect(incrResult.errors[i]!.error).toBe(fullResult.errors[i]!.error);
        }
    });

    it("produces same result for valid module with no changes", async () => {
        const module = makeModule([
            makeFn("identity", [ident("x")], {
                params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
            }),
        ]);

        const fullResult = await check(module);
        const incrResult = await incrementalCheck(module, module);

        expect(incrResult.ok).toBe(true);
        expect(fullResult.ok).toBe(true);
        expect(incrResult.rechecked).toEqual([]);
        expect(incrResult.skipped).toContain("identity");
    });

    it("only rechecks changed function and its dependents", async () => {
        const before = makeModule([
            makeFn("helper", [lit(1)]),
            makeFn("caller", [call("helper")]),
            makeFn("unrelated", [lit(99)]),
        ]);
        const after = makeModule([
            makeFn("helper", [lit(2)]),  // changed
            makeFn("caller", [call("helper")]),
            makeFn("unrelated", [lit(99)]),
        ]);

        const result = await incrementalCheck(before, after);

        expect(result.ok).toBe(true);
        expect(result.rechecked).toContain("helper");
        expect(result.rechecked).toContain("caller");
        expect(result.skipped).toContain("unrelated");
    });

    it("returns same contract failures as full check", async () => {
        const before = makeModule([
            makeFn("positive", [ident("x")], {
                params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
                contracts: [{
                    kind: "post", id: "post-1",
                    condition: {
                        kind: "binop", id: "b-1", op: ">=",
                        left: ident("result"), right: lit(0),
                    },
                }],
            }),
        ]);
        // Change postcondition from >= to > (structural change — contract still fails)
        const after = makeModule([
            makeFn("positive", [ident("x")], {
                params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
                contracts: [{
                    kind: "post", id: "post-1",
                    condition: {
                        kind: "binop", id: "b-1", op: ">",
                        left: ident("result"), right: lit(0),
                    },
                }],
            }),
        ]);

        const fullResult = await check(after);
        const incrResult = await incrementalCheck(before, after);

        expect(incrResult.ok).toBe(fullResult.ok);
        expect(incrResult.errors.length).toBe(fullResult.errors.length);
        if (incrResult.errors.length > 0) {
            expect(incrResult.errors[0]!.error).toBe(fullResult.errors[0]!.error);
        }
    });
});

// =============================================================================
// handlePatch integration (via incrementalCheck path)
// =============================================================================

describe("incremental — handlePatch integration", () => {
    it("handlePatch returns rechecked/skipped fields", async () => {
        // Import directly to test the handler
        const { handlePatch } = await import("../../src/mcp/handlers.js");

        const baseAst = makeModule([
            makeFn("a", [lit(1)]),
            makeFn("b", [lit(2)]),
        ]);

        // Patch: change a's body from 1 to 3
        const result = await handlePatch(
            baseAst,
            [{ nodeId: "lit-1", op: "replace", field: "value", value: 3 }],
            false,
        );

        expect(result.ok).toBe(true);
        expect(result.rechecked).toBeDefined();
        expect(result.skipped).toBeDefined();
        // 'a' was changed, 'b' was not
        expect(result.rechecked).toContain("a");
        expect(result.skipped).toContain("b");
    });
});
