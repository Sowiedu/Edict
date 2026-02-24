import { describe, it, expect } from "vitest";
import { collectCalls, buildCallGraph } from "../../src/effects/call-graph.js";
import type { EdictModule, Expression, FunctionDef } from "../../src/ast/nodes.js";
import { BUILTIN_FUNCTIONS } from "../../src/codegen/builtins.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkIdent(name: string, id = `id-${name}`): Expression {
    return { kind: "ident", id, name };
}

function mkCall(callee: string, args: Expression[] = [], id = `call-${callee}`): Expression {
    return { kind: "call", id, fn: mkIdent(callee), args };
}

function mkFn(
    name: string,
    body: Expression[],
    effects: FunctionDef["effects"] = ["pure"],
): FunctionDef {
    return {
        kind: "fn",
        id: `fn-${name}`,
        name,
        params: [],
        effects,
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body,
    };
}

function mkModule(
    defs: EdictModule["definitions"],
    imports: EdictModule["imports"] = [],
): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports,
        definitions: defs,
    };
}

// ---------------------------------------------------------------------------
// collectCalls
// ---------------------------------------------------------------------------

describe("collectCalls — expression walker", () => {
    it("finds a single direct call", () => {
        const edges = collectCalls([mkCall("foo")]);
        expect(edges).toEqual([{ calleeName: "foo", callSiteNodeId: "call-foo" }]);
    });

    it("returns empty for no calls", () => {
        const edges = collectCalls([mkIdent("x"), { kind: "literal", id: "l1", value: 42 }]);
        expect(edges).toEqual([]);
    });

    it("finds calls nested in if.condition, then, and else", () => {
        const expr: Expression = {
            kind: "if",
            id: "if-1",
            condition: mkCall("cond"),
            then: [mkCall("then_fn")],
            else: [mkCall("else_fn")],
        };
        const edges = collectCalls([expr]);
        expect(edges).toHaveLength(3);
        const names = edges.map(e => e.calleeName);
        expect(names).toContain("cond");
        expect(names).toContain("then_fn");
        expect(names).toContain("else_fn");
    });

    it("handles if without else branch", () => {
        const expr: Expression = {
            kind: "if",
            id: "if-2",
            condition: mkCall("cond"),
            then: [mkCall("then_fn")],
        };
        const edges = collectCalls([expr]);
        expect(edges).toHaveLength(2);
        const names = edges.map(e => e.calleeName);
        expect(names).toContain("cond");
        expect(names).toContain("then_fn");
    });

    it("finds calls inside match target and arm bodies", () => {
        const expr: Expression = {
            kind: "match",
            id: "m-1",
            target: mkCall("target_fn"),
            arms: [
                {
                    kind: "arm",
                    id: "arm-1",
                    pattern: { kind: "wildcard" },
                    body: [mkCall("arm_fn")],
                },
            ],
        };
        const edges = collectCalls([expr]);
        const names = edges.map(e => e.calleeName);
        expect(names).toContain("target_fn");
        expect(names).toContain("arm_fn");
    });

    it("finds calls inside let.value", () => {
        const expr: Expression = {
            kind: "let",
            id: "let-1",
            name: "x",
            value: mkCall("init_fn"),
        };
        const edges = collectCalls([expr]);
        expect(edges).toEqual([{ calleeName: "init_fn", callSiteNodeId: "call-init_fn" }]);
    });

    it("does NOT recurse into lambda bodies", () => {
        const expr: Expression = {
            kind: "lambda",
            id: "lam-1",
            params: [],
            body: [mkCall("inner_fn")],
        };
        const edges = collectCalls([expr]);
        expect(edges).toEqual([]);
    });

    it("handles non-ident fn (no edge, but walks args)", () => {
        // call.fn is a field access, not an ident — no edge
        const expr: Expression = {
            kind: "call",
            id: "call-complex",
            fn: { kind: "access", id: "acc-1", target: mkIdent("obj"), field: "method" },
            args: [mkCall("arg_fn")],
        };
        const edges = collectCalls([expr]);
        // Only arg_fn appears, not the access call itself
        expect(edges).toEqual([{ calleeName: "arg_fn", callSiteNodeId: "call-arg_fn" }]);
    });

    it("finds both foo and bar in foo(bar())", () => {
        const nested = mkCall("bar");
        const outer: Expression = {
            kind: "call",
            id: "call-foo",
            fn: mkIdent("foo"),
            args: [nested],
        };
        const edges = collectCalls([outer]);
        const names = edges.map(e => e.calleeName);
        expect(names).toContain("bar");
        expect(names).toContain("foo");
    });

    it("walks block, binop, unop, array, tuple, record_expr, enum_constructor, access", () => {
        const exprs: Expression[] = [
            { kind: "block", id: "b1", body: [mkCall("block_fn")] },
            { kind: "binop", id: "bin1", op: "+", left: mkCall("left_fn"), right: mkCall("right_fn") },
            { kind: "unop", id: "un1", op: "not", operand: mkCall("unop_fn") },
            { kind: "array", id: "arr1", elements: [mkCall("arr_fn")] },
            { kind: "tuple_expr", id: "tup1", elements: [mkCall("tup_fn")] },
            { kind: "record_expr", id: "rec1", name: "R", fields: [{ kind: "field_init", name: "f", value: mkCall("rec_fn") }] },
            { kind: "enum_constructor", id: "ec1", enumName: "E", variant: "V", fields: [{ kind: "field_init", name: "f", value: mkCall("enum_fn") }] },
            { kind: "access", id: "acc1", target: mkCall("access_fn"), field: "x" },
        ];
        const edges = collectCalls(exprs);
        const names = edges.map(e => e.calleeName);
        for (const n of ["block_fn", "left_fn", "right_fn", "unop_fn", "arr_fn", "tup_fn", "rec_fn", "enum_fn", "access_fn"]) {
            expect(names).toContain(n);
        }
    });
});

// ---------------------------------------------------------------------------
// buildCallGraph
// ---------------------------------------------------------------------------

describe("buildCallGraph", () => {
    it("builds graph with edges for function calls", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")]),
            mkFn("b", []),
        ]);
        const { graph, functionDefs, importedNames } = buildCallGraph(mod);

        expect(functionDefs.size).toBe(2 + BUILTIN_FUNCTIONS.size);
        expect(importedNames.size).toBe(0);
        expect(graph.get("a")).toEqual([{ calleeName: "b", callSiteNodeId: "call-b" }]);
        expect(graph.get("b")).toEqual([]);
    });

    it("tracks imported names correctly", () => {
        const mod = mkModule(
            [mkFn("fetchData", [mkCall("http_get")])],
            [{ kind: "import", id: "imp-1", module: "http", names: ["http_get"] }],
        );
        const { importedNames, graph } = buildCallGraph(mod);

        expect(importedNames.has("http_get")).toBe(true);
        // http_get still creates a call edge — filtering happens in effectCheck
        expect(graph.get("fetchData")!.length).toBe(1);
    });

    it("only includes fn definitions, not records, enums, etc.", () => {
        const mod = mkModule([
            mkFn("helper", []),
            { kind: "record", id: "rec-1", name: "MyRec", fields: [] },
            { kind: "enum", id: "enum-1", name: "MyEnum", variants: [] },
        ]);
        const { functionDefs } = buildCallGraph(mod);
        expect(functionDefs.size).toBe(1 + BUILTIN_FUNCTIONS.size);
        expect(functionDefs.has("helper")).toBe(true);
    });

    it("does NOT walk contract conditions", () => {
        const fn: FunctionDef = {
            kind: "fn",
            id: "fn-guarded",
            name: "guarded",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [{
                kind: "pre",
                id: "pre-1",
                condition: mkCall("contract_checker"),
            }],
            body: [{ kind: "literal", id: "lit-1", value: 1 }],
        };
        const mod = mkModule([fn]);
        const { graph } = buildCallGraph(mod);
        expect(graph.get("guarded")).toEqual([]);
    });
});
