// =============================================================================
// Expression → Z3 Translation Tests
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { getZ3 } from "../../src/contracts/z3-context.js";
import { translateExpr, translateExprList, createParamVariables, type TranslationContext } from "../../src/contracts/translate.js";
import type { Expression, Param, EdictModule, FunctionDef } from "../../src/ast/nodes.js";
import type { Context } from "z3-solver";

type Z3Context = Context<"main">;

let ctx: Z3Context;

beforeAll(async () => {
    ctx = await getZ3();
});

function freshTctx(): TranslationContext {
    return { ctx, variables: new Map(), errors: [] };
}

let uid = 0;
function mkLit(value: number | boolean | string): Expression {
    return { kind: "literal", id: `t-${++uid}`, value } as any;
}
function mkIdent(name: string): Expression {
    return { kind: "ident", id: `t-${++uid}`, name };
}
function mkBinop(op: string, left: Expression, right: Expression): Expression {
    return { kind: "binop", id: `t-${++uid}`, op, left, right } as any;
}
function mkUnop(op: string, operand: Expression): Expression {
    return { kind: "unop", id: `t-${++uid}`, op, operand } as any;
}
function mkIf(condition: Expression, thenBranch: Expression[], elseBranch?: Expression[]): Expression {
    return { kind: "if", id: `t-${++uid}`, condition, then: thenBranch, else: elseBranch } as any;
}
function mkLet(name: string, value: Expression): Expression {
    return { kind: "let", id: `t-${++uid}`, name, value } as any;
}
function mkMatch(target: Expression, arms: { pattern: any; body: Expression[] }[]): Expression {
    return {
        kind: "match", id: `t-${++uid}`, target,
        arms: arms.map(a => ({ kind: "arm", id: `t-${++uid}`, pattern: a.pattern, body: a.body })),
    } as any;
}
function mkCall(fnName: string, args: Expression[]): Expression {
    return { kind: "call", id: `t-${++uid}`, fn: mkIdent(fnName), args } as any;
}
function mkBlock(body: Expression[]): Expression {
    return { kind: "block", id: `t-${++uid}`, body } as any;
}
function mkParam(name: string): Param {
    return { kind: "param", id: `t-${++uid}`, name, type: { kind: "basic", name: "Int" } } as any;
}
function mkFnDef(name: string, params: Param[], body: Expression[], effects = ["pure"]): FunctionDef {
    return {
        kind: "fn", id: `t-${++uid}`, name, params, effects,
        returnType: { kind: "basic", name: "Int" }, contracts: [], body,
    } as any;
}
function mkModule(defs: FunctionDef[]): EdictModule {
    return { kind: "module", id: `t-${++uid}`, name: "test", imports: [], definitions: defs } as any;
}
function freshTctxWithModule(mod: EdictModule): TranslationContext {
    return { ctx, variables: new Map(), errors: [], module: mod };
}

// ---------------------------------------------------------------------------
// Literal translation
// ---------------------------------------------------------------------------

describe("translateExpr — literals", () => {
    it("translates integer literal", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkLit(42), "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toBe("42");
        expect(tctx.errors).toHaveLength(0);
    });

    it("translates boolean literal true", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkLit(true), "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toBe("true");
    });

    it("translates boolean literal false", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkLit(false), "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toBe("false");
    });

    it("returns null for string literal", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkLit("hello"), "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("literal:string");
    });
});

// ---------------------------------------------------------------------------
// Identifier translation
// ---------------------------------------------------------------------------

describe("translateExpr — identifiers", () => {
    it("translates a known variable", () => {
        const tctx = freshTctx();
        const x = ctx.Int.const("x");
        tctx.variables.set("x", x);
        const result = translateExpr(tctx, mkIdent("x"), "c1", "fn");
        expect(result).toBe(x);
    });

    it("returns null for unknown identifier", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkIdent("unknown"), "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("ident:unknown");
    });
});

// ---------------------------------------------------------------------------
// Binary operations
// ---------------------------------------------------------------------------

describe("translateExpr — binary operations", () => {
    it("translates arithmetic +", () => {
        const tctx = freshTctx();
        tctx.variables.set("a", ctx.Int.const("a"));
        tctx.variables.set("b", ctx.Int.const("b"));
        const result = translateExpr(tctx, mkBinop("+", mkIdent("a"), mkIdent("b")), "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toContain("a");
    });

    it("translates comparison ==", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const result = translateExpr(tctx, mkBinop("==", mkIdent("x"), mkLit(0)), "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("translates logical and/or/implies", () => {
        const tctx = freshTctx();
        tctx.variables.set("a", ctx.Bool.const("a"));
        tctx.variables.set("b", ctx.Bool.const("b"));

        const andResult = translateExpr(tctx, mkBinop("and", mkIdent("a"), mkIdent("b")), "c1", "fn");
        expect(andResult).not.toBeNull();

        const orResult = translateExpr(tctx, mkBinop("or", mkIdent("a"), mkIdent("b")), "c1", "fn");
        expect(orResult).not.toBeNull();

        const implResult = translateExpr(tctx, mkBinop("implies", mkIdent("a"), mkIdent("b")), "c1", "fn");
        expect(implResult).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Unary operations
// ---------------------------------------------------------------------------

describe("translateExpr — unary operations", () => {
    it("translates not", () => {
        const tctx = freshTctx();
        tctx.variables.set("a", ctx.Bool.const("a"));
        const result = translateExpr(tctx, mkUnop("not", mkIdent("a")), "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("translates negation -", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const result = translateExpr(tctx, mkUnop("-", mkIdent("x")), "c1", "fn");
        expect(result).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Float literal
// ---------------------------------------------------------------------------

describe("translateExpr — float literal", () => {
    it("translates float literal to Real", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkLit(3.14), "c1", "fn");
        expect(result).not.toBeNull();
        // Z3 represents 3.14 as a rational (/ 157 50), so check sort instead
        expect(result.sort.name()).toBe("Real");
        expect(tctx.errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Access expression
// ---------------------------------------------------------------------------

describe("translateExpr — access expression", () => {
    it("translates simple field access (x.length) to fresh Int variable", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr: any = {
            kind: "access", id: `t-${++uid}`,
            target: { kind: "ident", id: `t-${++uid}`, name: "x" },
            field: "length",
        };
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(tctx.variables.has("x.length")).toBe(true);
        expect(tctx.errors).toHaveLength(0);
    });

    it("returns null for access on complex target", () => {
        const tctx = freshTctx();
        const expr: any = {
            kind: "access", id: `t-${++uid}`,
            target: { kind: "call", id: `t-${++uid}`, fn: mkIdent("f"), args: [] },
            field: "length",
        };
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("access:complex_target");
    });
});

// ---------------------------------------------------------------------------
// createParamVariables
// ---------------------------------------------------------------------------

describe("createParamVariables", () => {
    it("creates variables for Int, Float, Bool params", () => {
        const tctx = freshTctx();
        const params: Param[] = [
            { name: "i", type: { kind: "basic", name: "Int" } },
            { name: "f", type: { kind: "basic", name: "Float" } },
            { name: "b", type: { kind: "basic", name: "Bool" } },
        ];
        const ok = createParamVariables(tctx, params);
        expect(ok).toBe(true);
        expect(tctx.variables.size).toBe(3);
        expect(tctx.variables.has("i")).toBe(true);
        expect(tctx.variables.has("f")).toBe(true);
        expect(tctx.variables.has("b")).toBe(true);
    });

    it("returns false for unsupported type", () => {
        const tctx = freshTctx();
        const params: Param[] = [
            { name: "s", type: { kind: "basic", name: "String" } },
        ];
        const ok = createParamVariables(tctx, params);
        expect(ok).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported expressions
// ---------------------------------------------------------------------------

describe("translateExpr — unsupported expressions", () => {
    it("returns null and pushes error for call expression without module", () => {
        const tctx = freshTctx();
        const expr: any = { kind: "call", id: "c-1", fn: mkIdent("f"), args: [] };
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toContain("call:");
    });

    it("returns null for truly unsupported expression kinds", () => {
        const tctx = freshTctx();
        const expr: any = { kind: "lambda", id: "l-1", params: [], body: [] };
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("lambda");
    });
});

// ---------------------------------------------------------------------------
// If expression
// ---------------------------------------------------------------------------

describe("translateExpr — if expressions", () => {
    it("1. translates if with both branches", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkIf(
            mkBinop(">", mkIdent("x"), mkLit(0)),
            [mkLit(1)],
            [mkLit(0)],
        );
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toContain("ite");
        expect(tctx.errors).toHaveLength(0);
    });

    it("2. returns null for if with missing else", () => {
        const tctx = freshTctx();
        const expr = mkIf(mkLit(true), [mkLit(1)]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("if:missing_else");
    });

    it("3. handles multi-expr then block (uses last expression)", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkIf(
            mkBinop(">", mkIdent("x"), mkLit(0)),
            [mkLet("y", mkLit(10)), mkIdent("y")],  // let y = 10; y
            [mkLit(0)],
        );
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(tctx.errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Let expression
// ---------------------------------------------------------------------------

describe("translateExpr — let expressions", () => {
    it("4. let binding makes variable accessible", () => {
        const tctx = freshTctx();
        translateExpr(tctx, mkLet("y", mkLit(42)), "c1", "fn");
        expect(tctx.variables.has("y")).toBe(true);
        // Retrieving bound variable works
        const result = translateExpr(tctx, mkIdent("y"), "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toBe("42");
    });

    it("5. let as final expression returns null", () => {
        const tctx = freshTctx();
        const result = translateExpr(tctx, mkLet("y", mkLit(42)), "c1", "fn");
        expect(result).toBeNull(); // let is not a value
    });
});

// ---------------------------------------------------------------------------
// translateExprList
// ---------------------------------------------------------------------------

describe("translateExprList", () => {
    it("6. walks let chain and returns last expr", () => {
        const tctx = freshTctx();
        const exprs = [
            mkLet("a", mkLit(10)),
            mkLet("b", mkLit(20)),
            mkBinop("+", mkIdent("a"), mkIdent("b")),
        ];
        const result = translateExprList(tctx, exprs, "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toContain("+");
        expect(tctx.errors).toHaveLength(0);
    });

    it("6b. returns null for empty list", () => {
        const tctx = freshTctx();
        const result = translateExprList(tctx, [], "c1", "fn");
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Match expression
// ---------------------------------------------------------------------------

describe("translateExpr — match expressions", () => {
    it("7. translates match with literal patterns", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkMatch(mkIdent("x"), [
            { pattern: { kind: "literal_pattern", id: `t-${++uid}`, value: 1 }, body: [mkLit(10)] },
            { pattern: { kind: "literal_pattern", id: `t-${++uid}`, value: 2 }, body: [mkLit(20)] },
            { pattern: { kind: "wildcard", id: `t-${++uid}` }, body: [mkLit(0)] },
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toContain("ite");
        expect(tctx.errors).toHaveLength(0);
    });

    it("8. match with wildcard-only uses default body", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkMatch(mkIdent("x"), [
            { pattern: { kind: "wildcard", id: `t-${++uid}` }, body: [mkLit(99)] },
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toBe("99");
    });

    it("9. match with binding pattern → binds target to name", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkMatch(mkIdent("x"), [
            { pattern: { kind: "binding", id: `t-${++uid}`, name: "v" }, body: [mkIdent("v")] },
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        // v is bound to x, so result is just x
        expect(result.toString()).toBe("x");
        expect(tctx.errors).toHaveLength(0);
    });

    it("9b. match with no wildcard → undecidable", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkMatch(mkIdent("x"), [
            { pattern: { kind: "literal_pattern", id: `t-${++uid}`, value: 1 }, body: [mkLit(10)] },
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors.some(e => e.unsupportedNodeKind === "match:no_wildcard")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Call expression (inlining)
// ---------------------------------------------------------------------------

describe("translateExpr — call inlining", () => {
    it("10. inlines pure single-expr function", () => {
        const double = mkFnDef("double", [mkParam("n")], [mkBinop("*", mkIdent("n"), mkLit(2))]);
        const mod = mkModule([double]);
        const tctx = freshTctxWithModule(mod);
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkCall("double", [mkIdent("x")]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(result.toString()).toContain("*");
        expect(tctx.errors).toHaveLength(0);
    });

    it("11. rejects non-pure function call", () => {
        const impure = mkFnDef("sideEffect", [mkParam("n")], [mkIdent("n")], ["io"]);
        const mod = mkModule([impure]);
        const tctx = freshTctxWithModule(mod);
        tctx.variables.set("x", ctx.Int.const("x"));
        const expr = mkCall("sideEffect", [mkIdent("x")]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors.some(e => e.unsupportedNodeKind.includes("not_pure"))).toBe(true);
    });

    it("11b. detects recursive call and returns null", () => {
        const rec = mkFnDef("rec", [mkParam("n")], [mkCall("rec", [mkIdent("n")])]);
        const mod = mkModule([rec]);
        const tctx = freshTctxWithModule(mod);
        tctx.variables.set("n", ctx.Int.const("n"));
        // Simulate being inside a call to rec
        tctx.visitedFunctions = new Set(["rec"]);
        const expr = mkCall("rec", [mkIdent("n")]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors.some(e => e.unsupportedNodeKind.includes("recursive"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Block expression
// ---------------------------------------------------------------------------

describe("translateExpr — block expressions", () => {
    it("12. block with let + final expr", () => {
        const tctx = freshTctx();
        const expr = mkBlock([
            mkLet("a", mkLit(5)),
            mkBinop("+", mkIdent("a"), mkLit(3)),
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        expect(tctx.errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Binding patterns in match
// ---------------------------------------------------------------------------

describe("translateExpr — match binding patterns", () => {
    it("13. binding pattern binds target to name", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        // match x { v => v + 1 }
        const expr = mkMatch(mkIdent("x"), [
            { pattern: { kind: "binding", name: "v" }, body: [mkBinop("+", mkIdent("v"), mkLit(1))] },
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        // v is bound to x, so result should be x + 1
        expect(result.toString()).toContain("+");
        expect(tctx.errors).toHaveLength(0);
        // v should not leak into outer scope
        expect(tctx.variables.has("v")).toBe(false);
    });

    it("14. binding pattern as catch-all after literals", () => {
        const tctx = freshTctx();
        tctx.variables.set("x", ctx.Int.const("x"));
        // match x { 0 => 100, n => n * 2 }
        const expr = mkMatch(mkIdent("x"), [
            { pattern: { kind: "literal_pattern", value: 0 }, body: [mkLit(100)] },
            { pattern: { kind: "binding", name: "n" }, body: [mkBinop("*", mkIdent("n"), mkLit(2))] },
        ]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        // Should be ite(x == 0, 100, x * 2)
        const str = result.toString();
        expect(str).toContain("ite");
        expect(tctx.errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Multi-expression call inlining
// ---------------------------------------------------------------------------

describe("translateExpr — multi-expression call inlining", () => {
    it("15. call to multi-expression body (let x = 1; x + n)", () => {
        const addOne = mkFnDef("addOne", [mkParam("n")], [
            mkLet("x", mkLit(1)),
            mkBinop("+", mkIdent("x"), mkIdent("n")),
        ]);
        const mod = mkModule([addOne]);
        const tctx = freshTctxWithModule(mod);
        tctx.variables.set("a", ctx.Int.const("a"));

        const expr = mkCall("addOne", [mkIdent("a")]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        // Should be 1 + a (constant-folded from let x = 1; x + n)
        expect(result.toString()).toContain("+");
        expect(tctx.errors).toHaveLength(0);
    });

    it("16. callee let bindings don't leak into caller scope", () => {
        const helper = mkFnDef("helper", [mkParam("n")], [
            mkLet("internal", mkLit(99)),
            mkBinop("+", mkIdent("internal"), mkIdent("n")),
        ]);
        const mod = mkModule([helper]);
        const tctx = freshTctxWithModule(mod);
        tctx.variables.set("a", ctx.Int.const("a"));

        const expr = mkCall("helper", [mkIdent("a")]);
        const result = translateExpr(tctx, expr, "c1", "fn");
        expect(result).not.toBeNull();
        // "internal" should not leak into the caller's scope
        expect(tctx.variables.has("internal")).toBe(false);
        expect(tctx.errors).toHaveLength(0);
    });
});
