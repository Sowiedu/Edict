import { describe, it, expect } from "vitest";
import { effectCheck } from "../../src/effects/effect-check.js";
import type { EdictModule, FunctionDef, Expression, Effect } from "../../src/ast/nodes.js";

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
    effects: Effect[] = ["pure"],
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
// Valid programs (no errors expected)
// ---------------------------------------------------------------------------

describe("effectCheck — valid programs", () => {
    it("pure function with no calls passes", () => {
        const mod = mkModule([
            mkFn("f", [{ kind: "literal", id: "l1", value: 1 }]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("pure calling pure passes", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("io calling io passes", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["io"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["io"]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("[io, fails] calling [io] passes (superset)", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["io", "fails"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["io"]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("calling imported function passes (opaque)", () => {
        const mod = mkModule(
            [mkFn("fetchData", [mkCall("http_get")], ["io", "fails"])],
            [{ kind: "import", id: "imp-1", module: "http", names: ["http_get"] }],
        );
        expect(effectCheck(mod)).toEqual([]);
    });

    it("chain: A(pure)→B(pure)→C(pure) passes", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")]),
            mkFn("b", [mkCall("c")]),
            mkFn("c", [{ kind: "literal", id: "l1", value: 1 }]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("[reads, writes] calling [reads] passes", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["reads", "writes"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["reads"]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("function with empty effects and no calls passes", () => {
        const mod = mkModule([
            mkFn("a", [{ kind: "literal", id: "l1", value: 1 }], []),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("recursive pure self-call passes", () => {
        const mod = mkModule([
            mkFn("fib", [mkCall("fib")], ["pure"]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });

    it("contract condition containing calls passes (contracts excluded)", () => {
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
                condition: mkCall("validator"), // should NOT create an edge
            }],
            body: [{ kind: "literal", id: "l1", value: 1 }],
        };
        const mod = mkModule([
            fn,
            mkFn("validator", [{ kind: "literal", id: "l2", value: true }], ["io"]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Invalid programs (errors expected)
// ---------------------------------------------------------------------------

describe("effectCheck — invalid programs", () => {
    it("pure calling io → effect_in_pure", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["pure"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["io"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_in_pure",
            functionName: "a",
            calleeName: "b",
            calleeEffects: ["io"],
        });
    });

    it("pure calling [fails] → effect_in_pure", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["pure"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["fails"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_in_pure",
            calleeEffects: ["fails"],
        });
    });

    it("pure calling [reads] → effect_in_pure", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["pure"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["reads"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_in_pure",
            calleeEffects: ["reads"],
        });
    });

    it("[reads] calling [io] → effect_violation with missingEffects: [io]", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["reads"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["io"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_violation",
            functionName: "a",
            missingEffects: ["io"],
            calleeName: "b",
        });
    });

    it("[io] calling [io, fails] → effect_violation with missingEffects: [fails]", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["io"]),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["io", "fails"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_violation",
            missingEffects: ["fails"],
        });
    });

    it("transitive: A(pure)→B(pure)→C(io) — B gets effect_in_pure, A passes", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["pure"]),
            mkFn("b", [mkCall("c")], ["pure"]),
            mkFn("c", [{ kind: "literal", id: "l1", value: 1 }], ["io"]),
        ]);
        const errors = effectCheck(mod);
        // B calls C(io) while being pure → error
        // A calls B(pure) → A trusts B's declaration → A passes
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_in_pure",
            functionName: "b",
            calleeName: "c",
        });
    });

    it("circular: A([io])↔B([pure]) — B gets effect_in_pure, A passes", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], ["io"]),
            mkFn("b", [mkCall("a")], ["pure"]),
        ]);
        const errors = effectCheck(mod);
        // A([io]) calls B(pure) → callee has no non-pure effects → A passes
        // B(pure) calls A([io]) → B is pure calling effectful → effect_in_pure
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_in_pure",
            functionName: "b",
            calleeName: "a",
            calleeEffects: ["io"],
        });
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("effectCheck — edge cases", () => {
    it("reports correct nodeId and callSiteNodeId", () => {
        const mod = mkModule([
            mkFn("caller", [mkCall("callee", [], "call-site-123")], ["pure"]),
            mkFn("callee", [{ kind: "literal", id: "l1", value: 1 }], ["io"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            nodeId: "fn-caller",
            callSiteNodeId: "call-site-123",
        });
    });

    it("multiple missing effects reported at once", () => {
        const mod = mkModule([
            mkFn("a", [mkCall("b")], []),
            mkFn("b", [{ kind: "literal", id: "l1", value: 1 }], ["io", "fails", "reads"]),
        ]);
        const errors = effectCheck(mod);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "effect_violation",
            missingEffects: ["io", "fails", "reads"],
        });
    });

    it("calling unknown function (e.g., param variable) produces no error", () => {
        // "callback" is not a FunctionDef, just a param name used as call target
        const mod = mkModule([
            mkFn("a", [mkCall("callback")], ["pure"]),
        ]);
        expect(effectCheck(mod)).toEqual([]);
    });
});
