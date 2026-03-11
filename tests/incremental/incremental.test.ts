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

// =============================================================================
// Dep Graph — definition type coverage
// =============================================================================

describe("incremental — buildDepGraph definition types", () => {
    it("detects type deps from const definition", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Point-001", name: "Point",
                fields: [
                    { kind: "field", id: "f-x-001", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y-001", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
            {
                kind: "const", id: "const-origin-001", name: "origin",
                type: { kind: "named", name: "Point" },
                value: {
                    kind: "record_expr", id: "re-origin", name: "Point",
                    fields: [
                        { kind: "field_init", name: "x", value: lit(0, "lit-ox") },
                        { kind: "field_init", name: "y", value: lit(0, "lit-oy") },
                    ],
                },
            },
        ]);
        const graph = buildDepGraph(module);

        // const "origin" uses type "Point" (via type annotation + record_expr)
        expect(graph.forward.get("origin")?.has("Point")).toBe(true);
    });

    it("detects type deps from enum definition with variant fields", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Payload-001", name: "Payload",
                fields: [{ kind: "field", id: "f-data-001", name: "data", type: { kind: "basic", name: "String" } }],
            },
            {
                kind: "enum", id: "enum-Msg-001", name: "Msg",
                variants: [
                    { kind: "variant", id: "var-Text-001", name: "Text", fields: [{ kind: "field", id: "f-val-001", name: "value", type: { kind: "basic", name: "String" } }] },
                    { kind: "variant", id: "var-Data-001", name: "Data", fields: [{ kind: "field", id: "f-pay-001", name: "payload", type: { kind: "named", name: "Payload" } }] },
                ],
            },
        ]);
        const graph = buildDepGraph(module);

        // enum "Msg" references "Payload" through variant field type
        expect(graph.forward.get("Msg")?.has("Payload")).toBe(true);
    });

    it("detects type deps from type alias definition", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Point-001", name: "Point",
                fields: [
                    { kind: "field", id: "f-x-001", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y-001", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
            {
                kind: "type", id: "type-Vec-001", name: "Vec",
                definition: { kind: "named", name: "Point" },
            },
        ]);
        const graph = buildDepGraph(module);

        // type alias "Vec" references "Point"
        expect(graph.forward.get("Vec")?.has("Point")).toBe(true);
    });

    it("detects type deps from record definition with defaultValue", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Inner-001", name: "Inner",
                fields: [{ kind: "field", id: "f-v-001", name: "v", type: { kind: "basic", name: "Int" } }],
            },
            {
                kind: "record", id: "rec-Outer-001", name: "Outer",
                fields: [
                    {
                        kind: "field", id: "f-val-001", name: "val",
                        type: { kind: "named", name: "Inner" },
                        defaultValue: {
                            kind: "record_expr", id: "re-inner", name: "Inner",
                            fields: [{ kind: "field_init", name: "v", value: lit(0, "lit-def") }],
                        },
                    },
                ],
            },
        ]);
        const graph = buildDepGraph(module);

        // record "Outer" references "Inner" through both field type and defaultValue record_expr
        expect(graph.forward.get("Outer")?.has("Inner")).toBe(true);
    });
});

// =============================================================================
// Dep Graph — type reference variants
// =============================================================================

describe("incremental — buildDepGraph type reference variants", () => {
    it("detects option type reference", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Point-001", name: "Point",
                fields: [{ kind: "field", id: "f-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
            },
            makeFn("getPoint", [lit(0, "lit-0")], {
                returnType: { kind: "option", inner: { kind: "named", name: "Point" } },
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("getPoint")?.has("Point")).toBe(true);
    });

    it("detects result type reference", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Error-001", name: "MyError",
                fields: [{ kind: "field", id: "f-msg-001", name: "msg", type: { kind: "basic", name: "String" } }],
            },
            makeFn("tryParse", [lit(0, "lit-0")], {
                returnType: { kind: "result", ok: { kind: "basic", name: "Int" }, err: { kind: "named", name: "MyError" } },
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("tryParse")?.has("MyError")).toBe(true);
    });

    it("detects fn_type reference in param", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Config-001", name: "Config",
                fields: [{ kind: "field", id: "f-v-001", name: "val", type: { kind: "basic", name: "Int" } }],
            },
            makeFn("apply", [lit(0, "lit-0")], {
                params: [{
                    kind: "param", id: "p-f-001", name: "f",
                    type: { kind: "fn_type", params: [{ kind: "named", name: "Config" }], returnType: { kind: "basic", name: "Int" } },
                }],
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("apply")?.has("Config")).toBe(true);
    });

    it("detects tuple type reference", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Pair-001", name: "Pair",
                fields: [{ kind: "field", id: "f-a-001", name: "a", type: { kind: "basic", name: "Int" } }],
            },
            makeFn("makeTuple", [lit(0, "lit-0")], {
                returnType: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "named", name: "Pair" }] },
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("makeTuple")?.has("Pair")).toBe(true);
    });

    it("detects refined type reference", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Score-001", name: "Score",
                fields: [{ kind: "field", id: "f-v-001", name: "val", type: { kind: "basic", name: "Int" } }],
            },
            makeFn("getScore", [lit(0, "lit-0")], {
                returnType: { kind: "refined", variable: "x", base: { kind: "named", name: "Score" }, predicate: lit(true, "lit-pred") },
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("getScore")?.has("Score")).toBe(true);
    });

    it("detects confidence type reference", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Data-001", name: "Data",
                fields: [{ kind: "field", id: "f-v-001", name: "val", type: { kind: "basic", name: "Int" } }],
            },
            makeFn("predict", [lit(0, "lit-0")], {
                returnType: { kind: "confidence", base: { kind: "named", name: "Data" }, confidence: 0.9 },
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("predict")?.has("Data")).toBe(true);
    });

    it("detects provenance type reference", () => {
        const module = makeModule([
            {
                kind: "record", id: "rec-Info-001", name: "Info",
                fields: [{ kind: "field", id: "f-v-001", name: "val", type: { kind: "basic", name: "Int" } }],
            },
            makeFn("loadInfo", [lit(0, "lit-0")], {
                returnType: { kind: "provenance", base: { kind: "named", name: "Info" }, sources: ["api"] },
            }),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("loadInfo")?.has("Info")).toBe(true);
    });

    it("detects enum_constructor deps in expressions", () => {
        const module = makeModule([
            {
                kind: "enum", id: "enum-Color-001", name: "Color",
                variants: [
                    { kind: "variant", id: "var-Red-001", name: "Red", fields: [] },
                ],
            },
            makeFn("makeRed", [{
                kind: "enum_constructor", id: "ec-1",
                enumName: "Color", variant: "Red", fields: [],
            }]),
        ]);
        const graph = buildDepGraph(module);
        expect(graph.forward.get("makeRed")?.has("Color")).toBe(true);
    });
});

// =============================================================================
// Incremental Check — error path coverage
// =============================================================================

describe("incremental — incrementalCheck error paths", () => {
    it("returns error when after module has validation errors", async () => {
        const before = makeModule([makeFn("a", [lit(1)])]);
        // Invalid AST: missing required fields
        const invalid = {
            kind: "module",
            id: "mod-test-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-a-001",
                name: "a",
                // Missing params, effects, etc.
            }],
        } as unknown as EdictModule;

        const result = await incrementalCheck(before, invalid);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.rechecked).toEqual([]);
        expect(result.skipped).toEqual([]);
    });

    it("returns error when after module has effect violations", async () => {
        const before = makeModule([
            makeFn("printer", [
                { kind: "call", id: "c-print", fn: { kind: "ident", id: "id-print", name: "print" }, args: [lit("hi", "l-s")] },
                lit(0, "l-ret"),
            ], { effects: ["pure"] }), // declared pure but calls print (io)
        ]);
        // Same invalid module — effect violation
        const after = makeModule([
            makeFn("printer", [
                { kind: "call", id: "c-print", fn: { kind: "ident", id: "id-print", name: "print" }, args: [lit("hello", "l-s2")] },
                lit(0, "l-ret"),
            ], { effects: ["pure"] }), // still pure but calls print
        ]);

        const result = await incrementalCheck(before, after);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.error === "effect_in_pure" || e.error === "effect_violation")).toBe(true);
    });

    it("returns error when after module has resolution errors", async () => {
        const before = makeModule([makeFn("a", [lit(1)])]);
        const after = makeModule([
            makeFn("a", [ident("nonexistent")]),
        ]);

        const result = await incrementalCheck(before, after);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.error === "undefined_reference")).toBe(true);
    });

    it("returns error when after module has type errors", async () => {
        const before = makeModule([makeFn("a", [lit(1)])]);
        const after = makeModule([
            makeFn("a", [lit("not an int", "l-str")], {
                returnType: { kind: "basic", name: "Int" },
            }),
        ]);

        const result = await incrementalCheck(before, after);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.error === "type_mismatch")).toBe(true);
    });
});
