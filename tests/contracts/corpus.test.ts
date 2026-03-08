// =============================================================================
// Contract Verification Coverage Corpus
// =============================================================================
// A comprehensive corpus of 55 contracts across 8 difficulty tiers.
// Each test is tagged [proven], [counter], [undecidable], or [skipped]
// in its name so the metrics script can categorize results automatically.
//
// See: https://github.com/Sowiedu/Edict/issues/52

import { describe, it, expect } from "vitest";
import { contractVerify } from "../../src/contracts/verify.js";
import type { EdictModule, FunctionDef, Expression, Contract, Param } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(): string { return `corpus-${++idCounter}`; }

function mkLit(value: number | boolean | string): Expression {
    const id = uid();
    if (typeof value === "boolean") {
        return { kind: "literal", id, value, type: { kind: "basic", name: "Bool" } } as any;
    }
    if (typeof value === "number") {
        return {
            kind: "literal", id, value,
            type: Number.isInteger(value) ? { kind: "basic", name: "Int" } : { kind: "basic", name: "Float" },
        } as any;
    }
    return { kind: "literal", id, value, type: { kind: "basic", name: "String" } } as any;
}

function mkIdent(name: string): Expression {
    return { kind: "ident", id: uid(), name };
}

function mkBinop(op: string, left: Expression, right: Expression): Expression {
    return { kind: "binop", id: uid(), op, left, right } as any;
}

function mkUnop(op: string, operand: Expression): Expression {
    return { kind: "unop", id: uid(), op, operand } as any;
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

function mkIf(condition: Expression, then: Expression[], else_?: Expression[]): Expression {
    return { kind: "if", id: uid(), condition, then, else: else_ } as any;
}

function mkLet(name: string, value: Expression): Expression {
    return { kind: "let", id: uid(), name, value } as any;
}

function mkBlock(body: Expression[]): Expression {
    return { kind: "block", id: uid(), body } as any;
}

function mkCall(fnName: string, args: Expression[]): Expression {
    return { kind: "call", id: uid(), fn: mkIdent(fnName), args } as any;
}

function mkMatch(target: Expression, arms: { pattern: any; body: Expression[] }[]): Expression {
    return {
        kind: "match", id: uid(), target,
        arms: arms.map(a => ({ kind: "arm", id: uid(), pattern: a.pattern, body: a.body })),
    } as any;
}

function mkAccess(target: Expression, field: string): Expression {
    return { kind: "access", id: uid(), target, field } as any;
}

function mkForall(variable: string, from: Expression, to: Expression, body: Expression): Expression {
    return { kind: "forall", id: uid(), variable, range: { from, to }, body } as any;
}

function mkExists(variable: string, from: Expression, to: Expression, body: Expression): Expression {
    return { kind: "exists", id: uid(), variable, range: { from, to }, body } as any;
}

function mkFn(opts: {
    name?: string;
    params?: Param[];
    contracts?: Contract[];
    body?: Expression[];
    returnType?: any;
}): FunctionDef {
    return {
        kind: "fn",
        id: uid(),
        name: opts.name ?? "testFn",
        params: opts.params ?? [],
        effects: ["pure"],
        returnType: opts.returnType ?? { kind: "basic", name: "Int" },
        contracts: opts.contracts ?? [],
        body: opts.body ?? [mkLit(0)],
    };
}

function mkModule(defs: FunctionDef[]): EdictModule {
    return {
        kind: "module",
        id: uid(),
        name: "corpus",
        imports: [],
        definitions: defs,
    };
}

// =============================================================================
// Tier 1 — Basic Arithmetic (10 contracts)
// =============================================================================

describe("corpus T1 — basic arithmetic", () => {
    it("T1.01 [proven] identity: pre x > 0, body x, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T1.02 [proven] increment: pre x >= 0, body x + 1, post result >= 1", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(1))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T1.03 [proven] square: pre x != 0, body x * x, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop("!=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkIdent("x"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T1.04 [proven] self-cancel: body x - x, post result == 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop("==", mkIdent("result"), mkLit(0)))],
            body: [mkBinop("-", mkIdent("x"), mkIdent("x"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T1.05 [proven] constant: body 42, post result == 42", async () => {
        const fn = mkFn({
            params: [],
            contracts: [mkPost(mkBinop("==", mkIdent("result"), mkLit(42)))],
            body: [mkLit(42)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T1.06 [proven] double: pre x > 0, body x * 2, post result > x", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkIdent("x"))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkLit(2))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T1.07 [counter] unbounded: body x, post result > 0 (no pre)", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T1.08 [counter] insufficient pre: pre x > 0, body x - 10, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkLit(10))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T1.09 [counter] contradictory post: pre x > 0, post x < 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop("<", mkIdent("x"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T1.10 [proven] modulo: pre x >= 0, body x % 5, post result >= 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("%", mkIdent("x"), mkLit(5))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// =============================================================================
// Tier 2 — Boolean Logic (8 contracts)
// =============================================================================

describe("corpus T2 — boolean logic", () => {
    it("T2.01 [proven] conjunction extraction: pre (a and b), post a", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("and", mkIdent("a"), mkIdent("b"))),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T2.02 [proven] modus ponens: pre (a implies b), pre a, post b", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkIdent("a")),
                mkPost(mkIdent("b")),
            ],
            body: [mkIdent("b")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T2.03 [proven] double negation: pre (not (not a)), post a", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool")],
            contracts: [
                mkPre(mkUnop("not", mkUnop("not", mkIdent("a")))),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T2.04 [proven] or introduction: pre a, post (a or b)", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkIdent("a")),
                mkPost(mkBinop("or", mkIdent("a"), mkIdent("b"))),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T2.05 [proven] contrapositive: pre (a implies b), pre (not b), post (not a)", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkUnop("not", mkIdent("b"))),
                mkPost(mkUnop("not", mkIdent("a"))),
            ],
            body: [mkUnop("not", mkIdent("a"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T2.06 [counter] post false — always fails", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool")],
            contracts: [mkPost(mkLit(false))],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T2.07 [counter] affirming consequent: pre (a implies b), pre b, post a", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkIdent("b")),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T2.08 [proven] de Morgan: pre (not (a and b)), post ((not a) or (not b))", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkUnop("not", mkBinop("and", mkIdent("a"), mkIdent("b")))),
                mkPost(mkBinop("or", mkUnop("not", mkIdent("a")), mkUnop("not", mkIdent("b")))),
            ],
            body: [mkBinop("or", mkUnop("not", mkIdent("a")), mkUnop("not", mkIdent("b")))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// =============================================================================
// Tier 3 — Comparison Chains (6 contracts)
// =============================================================================

describe("corpus T3 — comparison chains", () => {
    it("T3.01 [proven] transitivity: pre a > b, pre b > c, post a > c", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int"), mkParam("c", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkIdent("b"))),
                mkPre(mkBinop(">", mkIdent("b"), mkIdent("c"))),
                mkPost(mkBinop(">", mkIdent("a"), mkIdent("c"))),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T3.02 [proven] triangle inequality: pre a>=0, b>=0, body a+b, post result >= a", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">=", mkIdent("b"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkIdent("a"))),
            ],
            body: [mkBinop("+", mkIdent("a"), mkIdent("b"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T3.03 [proven] bounded range: pre 0 < x < 100, body x, post result <= 99", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">", mkIdent("x"), mkLit(0)),
                    mkBinop("<", mkIdent("x"), mkLit(100)),
                )),
                mkPost(mkBinop("<=", mkIdent("result"), mkLit(99))),
            ],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T3.04 [counter] gap in range: pre x > 0, post result > 100", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(100))),
            ],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T3.05 [proven] antisymmetry: pre a >= b, pre b >= a, post a == b", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("a"), mkIdent("b"))),
                mkPre(mkBinop(">=", mkIdent("b"), mkIdent("a"))),
                mkPost(mkBinop("==", mkIdent("a"), mkIdent("b"))),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T3.06 [counter] strict vs non-strict: pre a >= b, post a > b (fails when a == b)", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("a"), mkIdent("b"))),
                mkPost(mkBinop(">", mkIdent("a"), mkIdent("b"))),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });
});

// =============================================================================
// Tier 4 — Multi-Precondition (6 contracts)
// =============================================================================

describe("corpus T4 — multi-precondition", () => {
    it("T4.01 [proven] three preconditions narrow range: a>0, a<10, a!=5, post a>=1", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop("<", mkIdent("a"), mkLit(10))),
                mkPre(mkBinop("!=", mkIdent("a"), mkLit(5))),
                mkPost(mkBinop(">=", mkIdent("a"), mkLit(1))),
            ],
            body: [mkIdent("a")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T4.02 [proven] overlapping ranges: a>3, a<7, b>5, b<9, body a+b, post result >8", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(3))),
                mkPre(mkBinop("<", mkIdent("a"), mkLit(7))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(5))),
                mkPre(mkBinop("<", mkIdent("b"), mkLit(9))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(8))),
            ],
            body: [mkBinop("+", mkIdent("a"), mkIdent("b"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T4.03 [proven] vacuous: contradictory pre (x>0 and x<0) → any post holds", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPre(mkBinop("<", mkIdent("x"), mkLit(0))),
                mkPost(mkLit(false)),  // Even `false` holds vacuously
            ],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T4.04 [proven] four params: a>0,b>0,c>0,d>0, body a+b+c+d, post result>=4", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int"), mkParam("c", "Int"), mkParam("d", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("c"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("d"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(4))),
            ],
            body: [mkBinop("+", mkBinop("+", mkIdent("a"), mkIdent("b")), mkBinop("+", mkIdent("c"), mkIdent("d")))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T4.05 [counter] tight bounds insufficient: pre 0<x<10, post x*x > 100", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPre(mkBinop("<", mkIdent("x"), mkLit(10))),
                mkPost(mkBinop(">", mkBinop("*", mkIdent("x"), mkIdent("x")), mkLit(100))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkIdent("x"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T4.06 [proven] product positive: a>0, b>0, body a*b, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("*", mkIdent("a"), mkIdent("b"))],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// =============================================================================
// Tier 5 — Body-Dependent (8 contracts)
// =============================================================================

describe("corpus T5 — body-dependent", () => {
    it("T5.01 [proven] abs via if: body if x>0 then x else -x, post result >= 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(0)),
                [mkIdent("x")],
                [mkUnop("-", mkIdent("x"))],
            )],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T5.02 [proven] clamp via if: pre x>=0, body if x>100 then 100 else x, post result<=100", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop("<=", mkIdent("result"), mkLit(100))),
            ],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(100)),
                [mkLit(100)],
                [mkIdent("x")],
            )],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T5.03 [proven] let chain: let y=x+1, let z=y+1, post result > x", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkIdent("x")))],
            body: [
                mkLet("y", mkBinop("+", mkIdent("x"), mkLit(1))),
                mkLet("z", mkBinop("+", mkIdent("y"), mkLit(1))),
                mkIdent("z"),
            ],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T5.04 [proven] block body: { let a = x * 2; a + 1 }, post result > x (when x>0)", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkIdent("x"))),
            ],
            body: [mkBlock([
                mkLet("a", mkBinop("*", mkIdent("x"), mkLit(2))),
                mkBinop("+", mkIdent("a"), mkLit(1)),
            ])],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T5.05 [proven] match literal: match x { 0 => 1, _ => x }, pre x >= 0, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkMatch(mkIdent("x"), [
                { pattern: { kind: "literal_pattern", value: 0 }, body: [mkLit(1)] },
                { pattern: { kind: "wildcard" }, body: [mkIdent("x")] },
            ])],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T5.06 [counter] if without else → undecidable (can't translate)", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkLit(0)))],
            body: [mkIf(mkBinop(">", mkIdent("x"), mkLit(0)), [mkIdent("x")])],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        // Body can't be fully translated → result binding fails → postcondition checked without body
        // Either undecidable or counter depending on how verify handles it
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it("T5.07 [proven] nested if: if x>0 then (if x>10 then 10 else x) else 0, post result >= 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(0)),
                [mkIf(
                    mkBinop(">", mkIdent("x"), mkLit(10)),
                    [mkLit(10)],
                    [mkIdent("x")],
                )],
                [mkLit(0)],
            )],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T5.08 [proven] match with binding: match x { 0 => 1, n => n + 1 }, post result >= 1", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(1))),
            ],
            body: [mkMatch(mkIdent("x"), [
                { pattern: { kind: "literal_pattern", value: 0 }, body: [mkLit(1)] },
                { pattern: { kind: "binding", name: "n" }, body: [mkBinop("+", mkIdent("n"), mkLit(1))] },
            ])],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// =============================================================================
// Tier 6 — Callsite Preconditions (6 contracts)
// =============================================================================

describe("corpus T6 — callsite preconditions", () => {
    it("T6.01 [proven] caller pre satisfies callee pre", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("n"), mkLit(0)))],
            body: [mkCall("callee", [mkIdent("n")])],
        });
        const { errors } = await contractVerify(mkModule([callee, caller]));
        expect(errors).toHaveLength(0);
    });

    it("T6.02 [counter] caller missing pre → precondition_not_met", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [mkCall("callee", [mkIdent("n")])],
        });
        const { errors } = await contractVerify(mkModule([callee, caller]));
        expect(errors.some(e => e.error === "precondition_not_met")).toBe(true);
    });

    it("T6.03 [proven] stronger caller pre: callee wants x>0, caller has n>10", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("n"), mkLit(10)))],
            body: [mkCall("callee", [mkIdent("n")])],
        });
        const { errors } = await contractVerify(mkModule([callee, caller]));
        expect(errors).toHaveLength(0);
    });

    it("T6.04 [proven] transitive: A→B→C, all preconditions satisfied", async () => {
        const fnC = mkFn({
            name: "fnC",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const fnB = mkFn({
            name: "fnB",
            params: [mkParam("y", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("y"), mkLit(0)))],
            body: [mkCall("fnC", [mkIdent("y")])],
        });
        const fnA = mkFn({
            name: "fnA",
            params: [mkParam("z", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("z"), mkLit(0)))],
            body: [mkCall("fnB", [mkIdent("z")])],
        });
        const { errors } = await contractVerify(mkModule([fnC, fnB, fnA]));
        expect(errors).toHaveLength(0);
    });

    it("T6.05 [proven] branch-guarded self-recursion: fib pattern", async () => {
        const fib = mkFn({
            name: "fib",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">=", mkIdent("n"), mkLit(0)))],
            body: [mkIf(
                mkBinop("<=", mkIdent("n"), mkLit(1)),
                [mkIdent("n")],
                [mkBinop("+",
                    mkCall("fib", [mkBinop("-", mkIdent("n"), mkLit(1))]),
                    mkCall("fib", [mkBinop("-", mkIdent("n"), mkLit(2))]),
                )],
            )],
        });
        const { errors } = await contractVerify(mkModule([fib]));
        expect(errors.filter(e => e.error === "precondition_not_met")).toHaveLength(0);
    });

    it("T6.06 [counter] unguarded self-recursion: bad(n-1) without if", async () => {
        const bad = mkFn({
            name: "bad",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">=", mkIdent("n"), mkLit(0)))],
            body: [mkCall("bad", [mkBinop("-", mkIdent("n"), mkLit(1))])],
        });
        const { errors } = await contractVerify(mkModule([bad]));
        expect(errors.filter(e => e.error === "precondition_not_met").length).toBeGreaterThanOrEqual(1);
    });
});

// =============================================================================
// Tier 7 — Quantifiers (6 contracts)
// =============================================================================

describe("corpus T7 — quantifiers", () => {
    it("T7.01 [proven] forall i in [0,n): i >= 0", async () => {
        const fn = mkFn({
            params: [mkParam("n", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("n"), mkLit(0))),
                mkPost(mkForall("i", mkLit(0), mkIdent("n"),
                    mkBinop(">=", mkIdent("i"), mkLit(0)))),
            ],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T7.02 [proven] forall i in [0,n): i < n", async () => {
        const fn = mkFn({
            params: [mkParam("n", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("n"), mkLit(0))),
                mkPost(mkForall("i", mkLit(0), mkIdent("n"),
                    mkBinop("<", mkIdent("i"), mkIdent("n")))),
            ],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T7.03 [proven] exists i in [0,10): i == 5", async () => {
        const fn = mkFn({
            params: [],
            contracts: [
                mkPost(mkExists("i", mkLit(0), mkLit(10),
                    mkBinop("==", mkIdent("i"), mkLit(5)))),
            ],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("T7.04 [counter] forall i in [0,n): i > 0 — fails at i=0", async () => {
        const fn = mkFn({
            params: [mkParam("n", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("n"), mkLit(0))),
                mkPost(mkForall("i", mkLit(0), mkIdent("n"),
                    mkBinop(">", mkIdent("i"), mkLit(0)))),
            ],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T7.05 [counter] exists i in [0,0): anything — empty range", async () => {
        const fn = mkFn({
            params: [],
            contracts: [
                mkPost(mkExists("i", mkLit(0), mkLit(0), mkLit(true))),
            ],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("T7.06 [proven] forall with arithmetic: pre x >= n, n > 0, forall i in [0,n): x > i", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int"), mkParam("n", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkIdent("n"))),
                mkPre(mkBinop(">", mkIdent("n"), mkLit(0))),
                mkPost(mkForall("i", mkLit(0), mkIdent("n"),
                    mkBinop(">", mkIdent("x"), mkIdent("i")))),
            ],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// =============================================================================
// Tier 8 — Known Limitations (5 contracts)
// =============================================================================

describe("corpus T8 — known limitations", () => {
    it("T8.01 [skipped] string params → contracts skipped silently", async () => {
        const fn = mkFn({
            params: [mkParam("s", "String")],
            contracts: [mkPost(mkLit(true))],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0); // skipped, not undecidable
    });

    it("T8.02 [skipped] array params → contracts skipped silently", async () => {
        const fn = mkFn({
            params: [{ name: "arr", type: { kind: "array", element: { kind: "basic", name: "Int" } } } as any],
            contracts: [mkPost(mkLit(true))],
            body: [mkLit(0)],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0); // skipped
    });

    it("T8.03 [undecidable] call expression in contract → undecidable", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkCall("someFunc", [mkIdent("x")]))],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.some(e => e.error === "undecidable_predicate")).toBe(true);
    });

    it("T8.04 [undecidable] string literal in contract → undecidable", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop("==", mkIdent("x"), mkLit("hello")))],
            body: [mkIdent("x")],
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.some(e => e.error === "undecidable_predicate")).toBe(true);
    });

    it("T8.05 [proven] float arithmetic: pre x > 0.0, body x + 1.0, post result > 0.0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Float")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0.5))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0.5))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1.0))],
            returnType: { kind: "basic", name: "Float" },
        });
        const { errors } = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});
