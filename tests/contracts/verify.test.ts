// =============================================================================
// Contract Verifier Tests
// =============================================================================
// 20 provable + 10 failing + 5 undecidable + 2 edge cases = 37 tests

import { describe, it, expect, beforeAll } from "vitest";
import { contractVerify } from "../../src/contracts/verify.js";
import type { EdictModule, FunctionDef, Expression, Contract, Param } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(): string { return `test-${++idCounter}`; }

function mkLit(value: number | boolean | string): Expression {
    const id = uid();
    if (typeof value === "number") {
        return { kind: "literal", id, value, type: Number.isInteger(value) ? { kind: "basic", name: "Int" } : { kind: "basic", name: "Float" } } as any;
    }
    if (typeof value === "boolean") {
        return { kind: "literal", id, value, type: { kind: "basic", name: "Bool" } } as any;
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
// 20 Provable Contracts
// ---------------------------------------------------------------------------

describe("contract verifier — provable contracts", () => {
    it("1. x > 0 pre, body x + 1, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("2. x != 0 pre, body x * x, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop("!=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkIdent("x"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("3. a >= 0 and b >= 0, body a + b, post result >= 0", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">=", mkIdent("a"), mkLit(0)),
                    mkBinop(">=", mkIdent("b"), mkLit(0)),
                )),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("a"), mkIdent("b"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("4. no contracts → zero errors", async () => {
        const fn = mkFn({ params: [mkParam("x", "Int")], contracts: [] });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("5. only preconditions, no postconditions → zero errors", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("6. x > 0 pre, body x, post result > 0 (identity)", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("7. a and b pre, post a (boolean)", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("and", mkIdent("a"), mkIdent("b"))),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("8. two preconditions, one postcondition → all preconditions assumed", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int"), mkParam("y", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("y"), mkLit(0))),
                mkPost(mkBinop(">", mkBinop("+", mkIdent("x"), mkIdent("y")), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkIdent("y"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("9. body x - x, post result == 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPost(mkBinop("==", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkIdent("x"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("10. x >= 0 pre, body x, post result >= 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("11. x > 0 and y > 0 pre, body x + y, post result > 1", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int"), mkParam("y", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">", mkIdent("x"), mkLit(0)),
                    mkBinop(">", mkIdent("y"), mkLit(0)),
                )),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(1))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkIdent("y"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("12. x > 10 pre, body x - 5, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(10))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkLit(5))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("13. a == true pre, post a or false", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool")],
            contracts: [
                mkPre(mkBinop("==", mkIdent("a"), mkLit(true))),
                mkPost(mkBinop("or", mkIdent("a"), mkLit(false))),
            ],
            body: [mkIdent("a")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("14. boolean implies: a implies b pre, a pre, post b", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkIdent("a")),
                mkPost(mkIdent("b")),
            ],
            body: [mkIdent("b")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("15. n > 0 pre, body n, post result != 0", async () => {
        const fn = mkFn({
            params: [mkParam("n", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("n"), mkLit(0))),
                mkPost(mkBinop("!=", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("n")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("16. x >= 0 pre, body x + 1, post result >= 1", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(1))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("17. x > 0 and y > 0 pre, body x * y, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int"), mkParam("y", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">", mkIdent("x"), mkLit(0)),
                    mkBinop(">", mkIdent("y"), mkLit(0)),
                )),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkIdent("y"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("18. pre x > 5, body x, post result > 3", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(5))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(3))),
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("19. pre true (literal), body 42, post result == 42", async () => {
        const fn = mkFn({
            params: [],
            contracts: [
                mkPre(mkLit(true)),
                mkPost(mkBinop("==", mkIdent("result"), mkLit(42))),
            ],
            body: [mkLit(42)],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("20. multi-pre: a > 0, b > 0, a > b, body a - b, post result > 0", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("a"), mkIdent("b"))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("a"), mkIdent("b"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 10 Failing Contracts
// ---------------------------------------------------------------------------

describe("contract verifier — failing contracts (with counterexamples)", () => {
    it("1. no pre, body x, post x > 0 → counterexample x ≤ 0", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
        const ce = (errors[0] as any).counterexample;
        expect(Number(ce.x)).toBeLessThanOrEqual(0);
    });

    it("2. pre x > 0, body x - 10, post result > 0 → counterexample x in [1,10]", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkLit(10))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
        const ce = (errors[0] as any).counterexample;
        expect(Number(ce.x)).toBeGreaterThan(0);
        expect(Number(ce.x)).toBeLessThanOrEqual(10);
    });

    it("3. pre d != 0, body n / d, post n > 0 implies result > 0 → counterexample d < 0", async () => {
        const fn = mkFn({
            params: [mkParam("n", "Int"), mkParam("d", "Int")],
            contracts: [
                mkPre(mkBinop("!=", mkIdent("d"), mkLit(0))),
                mkPost(mkBinop("implies",
                    mkBinop(">", mkIdent("n"), mkLit(0)),
                    mkBinop(">", mkIdent("result"), mkLit(0)),
                )),
            ],
            body: [mkBinop("/", mkIdent("n"), mkIdent("d"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("4. no pre, post false → always fails", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkLit(false))],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("5. pre x > 0, post x < 0 → contradicts", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop("<", mkIdent("x"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("6. body -x, post result > 0 → fails for positive x", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkLit(0)))],
            body: [mkUnop("-", mkIdent("x"))],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("7. two posts, second fails → error on second only", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("x"), mkLit(0))),       // passes (same as pre)
                mkPost(mkBinop(">", mkIdent("x"), mkLit(1000))),    // fails
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("8. pre x > 0 and x < 10, body x, post result > 100", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">", mkIdent("x"), mkLit(0)),
                    mkBinop("<", mkIdent("x"), mkLit(10)),
                )),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(100))),
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("9. pre a > 0, body a, post result > a → fails (result == a)", async () => {
        const fn = mkFn({
            params: [mkParam("a", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkIdent("a"))),
            ],
            body: [mkIdent("a")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toBe("contract_failure");
    });

    it("10. counterexample values have correct variable names", async () => {
        const fn = mkFn({
            params: [mkParam("myVar", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("myVar"), mkLit(0)))],
            body: [mkIdent("myVar")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(1);
        const err = errors[0] as any;
        expect(err.error).toBe("contract_failure");
        expect(err.counterexample).toHaveProperty("myVar");
        expect(typeof err.counterexample.myVar).toBe("string");
    });
});

// ---------------------------------------------------------------------------
// 5 Undecidable Scenarios
// ---------------------------------------------------------------------------

describe("contract verifier — undecidable scenarios", () => {
    it("1. contract with call expression → undecidable_predicate", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost({
                kind: "call", id: uid(),
                fn: { kind: "ident", id: uid(), name: "someFunc" },
                args: [mkIdent("x")],
            } as any)],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.some(e => e.error === "undecidable_predicate")).toBe(true);
    });

    it("2. contract with if expression → undecidable_predicate", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost({
                kind: "if", id: uid(),
                condition: mkLit(true),
                then: [mkLit(1)],
                else: [mkLit(0)],
            } as any)],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors.some(e => e.error === "undecidable_predicate")).toBe(true);
    });

    it("3. contract with match expression → undecidable_predicate", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost({
                kind: "match", id: uid(),
                target: mkIdent("x"),
                arms: [],
            } as any)],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors.some(e => e.error === "undecidable_predicate")).toBe(true);
    });

    it("4. function with String param type → silently skipped", async () => {
        const fn = mkFn({
            params: [mkParam("s", "String")],
            contracts: [mkPost(mkLit(true))],
            body: [mkLit(0)],
        });
        const errors = await contractVerify(mkModule([fn]));
        // Unsupported param types → skip silently (no errors)
        expect(errors).toHaveLength(0);
    });

    it("5. function with array type param → silently skipped", async () => {
        const fn = mkFn({
            params: [{ name: "arr", type: { kind: "array", element: { kind: "basic", name: "Int" } } } as any],
            contracts: [mkPost(mkLit(true))],
            body: [mkLit(0)],
        });
        const errors = await contractVerify(mkModule([fn]));
        // Unsupported param types → skip silently (no errors)
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("contract verifier — edge cases", () => {
    it("empty module → zero errors", async () => {
        const errors = await contractVerify(mkModule([]));
        expect(errors).toHaveLength(0);
    });

    it("multiple functions, only one with contracts", async () => {
        const fn1 = mkFn({ name: "noContracts", params: [mkParam("x", "Int")] });
        const fn2 = mkFn({
            name: "withContract",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });
        const errors = await contractVerify(mkModule([fn1, fn2]));
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Multi-expression body support
// ---------------------------------------------------------------------------

function mkIf(condition: Expression, then: Expression[], else_?: Expression[]): Expression {
    return { kind: "if", id: uid(), condition, then, else: else_ } as any;
}
function mkLet(name: string, value: Expression): Expression {
    return { kind: "let", id: uid(), name, value } as any;
}
function mkBlock(body: Expression[]): Expression {
    return { kind: "block", id: uid(), body } as any;
}

describe("contract verifier — multi-expression bodies", () => {
    it("1. postcondition with if in body", async () => {
        // fn abs(x: Int) pre true post result >= 0 = if x > 0 then x else -x
        const fn = mkFn({
            name: "abs",
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(0)),
                [mkIdent("x")],
                [mkUnop("-", mkIdent("x"))],
            )],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("2. multi-expression body with let chain → result", async () => {
        // fn f(x: Int) pre x > 0 post result > 0 = let y = x; y
        const fn = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkLet("y", mkIdent("x")), mkIdent("y")],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });

    it("3. block body → result binds correctly", async () => {
        // fn f(x: Int) pre x > 0 post result > 0 = { let y = x; y }
        const fn = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBlock([mkLet("y", mkIdent("x")), mkIdent("y")])],
        });
        const errors = await contractVerify(mkModule([fn]));
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Callsite precondition checking
// ---------------------------------------------------------------------------

describe("contract verifier — callsite precondition checking", () => {
    it("5. caller pre satisfies callee pre → 0 errors", async () => {
        // fn callee(x: Int) pre x > 0 = x
        // fn caller(n: Int) pre n > 0 = callee(n)
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
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkIdent("n")] } as any],
        });
        const errors = await contractVerify(mkModule([callee, caller]));
        expect(errors).toHaveLength(0);
    });

    it("6. caller doesn't satisfy callee pre → precondition_not_met", async () => {
        // fn callee(x: Int) pre x > 0 = x
        // fn caller(n: Int) = callee(n)  -- no pre, so n could be <= 0
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkIdent("n")] } as any],
        });
        const errors = await contractVerify(mkModule([callee, caller]));
        expect(errors.some(e => e.error === "precondition_not_met")).toBe(true);
    });

    it("7. counterexample has caller param names", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkIdent("n")] } as any],
        });
        const errors = await contractVerify(mkModule([callee, caller]));
        const pnm = errors.find(e => e.error === "precondition_not_met");
        expect(pnm).toBeDefined();
        if (pnm && "counterexample" in pnm) {
            expect(Object.keys(pnm.counterexample)).toContain("n");
        }
    });

    it("8. callee with no preconds → 0 errors", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkIdent("n")] } as any],
        });
        const errors = await contractVerify(mkModule([callee, caller]));
        expect(errors).toHaveLength(0);
    });

    it("9. call to unknown function → 0 errors (skipped)", async () => {
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [{ kind: "call", id: uid(), fn: mkIdent("unknownFn"), args: [mkIdent("n")] } as any],
        });
        const errors = await contractVerify(mkModule([caller]));
        expect(errors).toHaveLength(0);
    });

    it("10. multiple calls, one fails → 1 error", async () => {
        const safe = mkFn({
            name: "safe",
            params: [mkParam("x", "Int")],
            body: [mkIdent("x")],
        });
        const strict = mkFn({
            name: "strict",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(100)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [mkBinop("+",
                { kind: "call", id: uid(), fn: mkIdent("safe"), args: [mkIdent("n")] } as any,
                { kind: "call", id: uid(), fn: mkIdent("strict"), args: [mkIdent("n")] } as any,
            )],
        });
        const errors = await contractVerify(mkModule([safe, strict, caller]));
        expect(errors.filter(e => e.error === "precondition_not_met")).toHaveLength(1);
    });

    it("11. function with no calls in body → 0 errors", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const noCalls = mkFn({
            name: "noCalls",
            params: [mkParam("n", "Int")],
            body: [mkBinop("+", mkIdent("n"), mkLit(1))],
        });
        const errors = await contractVerify(mkModule([callee, noCalls]));
        expect(errors).toHaveLength(0);
    });

    it("12. caller with unsupported params → 0 errors (skipped)", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("s", "String")],
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkLit(42)] } as any],
        });
        const errors = await contractVerify(mkModule([callee, caller]));
        // Skipped because caller has unsupported param types
        expect(errors.filter(e => e.error === "precondition_not_met")).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Branch-aware callsite checking
// ---------------------------------------------------------------------------

describe("contract verifier — branch-aware callsite checking", () => {
    it("1. self-recursive call in else branch with sufficient pre → 0 errors", async () => {
        // fn fib(n: Int) pre n >= 0 = if n <= 1 then n else fib(n-1) + fib(n-2)
        const fib = mkFn({
            name: "fib",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">=", mkIdent("n"), mkLit(0)))],
            body: [
                mkIf(
                    mkBinop("<=", mkIdent("n"), mkLit(1)),
                    [mkIdent("n")],
                    [mkBinop("+",
                        { kind: "call", id: uid(), fn: mkIdent("fib"), args: [mkBinop("-", mkIdent("n"), mkLit(1))] } as any,
                        { kind: "call", id: uid(), fn: mkIdent("fib"), args: [mkBinop("-", mkIdent("n"), mkLit(2))] } as any,
                    )],
                ),
            ],
        });
        const errors = await contractVerify(mkModule([fib]));
        // Branch condition not(n <= 1) → n > 1, so n-1 >= 0 and n-2 >= 0
        expect(errors.filter(e => e.error === "precondition_not_met")).toHaveLength(0);
    });

    it("2. self-recursive call without branch guard → 1+ precondition_not_met", async () => {
        // fn bad(n: Int) pre n >= 0 = bad(n - 1) — no if guard
        const bad = mkFn({
            name: "bad",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">=", mkIdent("n"), mkLit(0)))],
            body: [
                { kind: "call", id: uid(), fn: mkIdent("bad"), args: [mkBinop("-", mkIdent("n"), mkLit(1))] } as any,
            ],
        });
        const errors = await contractVerify(mkModule([bad]));
        // No branch condition to protect, n-1 >= 0 not guaranteed by n >= 0 alone (n=0 is counterexample)
        expect(errors.filter(e => e.error === "precondition_not_met").length).toBeGreaterThanOrEqual(1);
    });

    it("3. nested if with accumulated path conditions → 0 errors", async () => {
        // fn f(n: Int) pre n >= 0 = if n > 10 then (if n > 5 then g(n - 5) else 0) else 0
        // where g(x) pre x > 0
        // At the inner call: n > 10 ∧ n > 5, so n-5 > 0 ✓
        const g = mkFn({
            name: "g",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const f = mkFn({
            name: "f",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">=", mkIdent("n"), mkLit(0)))],
            body: [
                mkIf(
                    mkBinop(">", mkIdent("n"), mkLit(10)),
                    [mkIf(
                        mkBinop(">", mkIdent("n"), mkLit(5)),
                        [{ kind: "call", id: uid(), fn: mkIdent("g"), args: [mkBinop("-", mkIdent("n"), mkLit(5))] } as any],
                        [mkLit(0)],
                    )],
                    [mkLit(0)],
                ),
            ],
        });
        const errors = await contractVerify(mkModule([g, f]));
        expect(errors.filter(e => e.error === "precondition_not_met")).toHaveLength(0);
    });

    it("4. call in then branch directly helped by condition → 0 errors", async () => {
        // fn f(n: Int) = if n > 0 then g(n) else 0
        // where g(x) pre x > 0
        // In then branch: n > 0, so g(n) with pre x > 0 is satisfied
        const g = mkFn({
            name: "g",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const f = mkFn({
            name: "f",
            params: [mkParam("n", "Int")],
            body: [
                mkIf(
                    mkBinop(">", mkIdent("n"), mkLit(0)),
                    [{ kind: "call", id: uid(), fn: mkIdent("g"), args: [mkIdent("n")] } as any],
                    [mkLit(0)],
                ),
            ],
        });
        const errors = await contractVerify(mkModule([g, f]));
        expect(errors.filter(e => e.error === "precondition_not_met")).toHaveLength(0);
    });
});
