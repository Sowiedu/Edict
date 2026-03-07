// =============================================================================
// Contract Translate Branch Coverage Tests
// =============================================================================
// Tests edge-case branches in translate.ts that are not covered by existing
// contract integration tests. Focuses on the translateCall, translateMatch,
// translateAccess, translateLiteral, and translateExprList error paths.

import { describe, it, expect } from "vitest";
import { getZ3 } from "../../src/contracts/z3-context.js";
import {
    createParamVariables,
    translateExpr,
    translateExprList,
    type TranslationContext,
} from "../../src/contracts/translate.js";
import type { Expression, EdictModule, FunctionDef } from "../../src/ast/nodes.js";

/** Helper to create a simple translation context with Int params. */
async function makeCtx(
    paramNames: string[] = [],
    mod?: EdictModule,
): Promise<TranslationContext> {
    const ctx = await getZ3();
    const tctx: TranslationContext = {
        ctx,
        variables: new Map(),
        errors: [],
        module: mod,
    };
    for (const name of paramNames) {
        tctx.variables.set(name, ctx.Int.const(name));
    }
    return tctx;
}

// Helper to build a simple module with one function
function simpleFn(overrides: Partial<FunctionDef> = {}): FunctionDef {
    return {
        kind: "fn",
        id: "fn-helper-001",
        name: "helper",
        params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{ kind: "ident", id: "id-x-001", name: "x" }],
        ...overrides,
    } as FunctionDef;
}

function simpleModule(...fns: FunctionDef[]): EdictModule {
    return {
        kind: "module",
        id: "mod-001",
        name: "test",
        imports: [],
        definitions: fns,
    };
}

// =============================================================================
// createParamVariables branches
// =============================================================================

describe("createParamVariables", () => {
    it("creates Int, Float, Bool variables", async () => {
        const tctx = await makeCtx();
        const ok = createParamVariables(tctx, [
            { kind: "param", id: "p1", name: "x", type: { kind: "basic", name: "Int" } },
            { kind: "param", id: "p2", name: "y", type: { kind: "basic", name: "Float" } },
            { kind: "param", id: "p3", name: "z", type: { kind: "basic", name: "Bool" } },
        ] as any[]);
        expect(ok).toBe(true);
        expect(tctx.variables.has("x")).toBe(true);
        expect(tctx.variables.has("y")).toBe(true);
        expect(tctx.variables.has("z")).toBe(true);
    });

    it("returns false for unsupported basic type (String)", async () => {
        const tctx = await makeCtx();
        const ok = createParamVariables(tctx, [
            { kind: "param", id: "p1", name: "s", type: { kind: "basic", name: "String" } },
        ] as any[]);
        expect(ok).toBe(false);
    });

    it("returns false for non-basic types (array, record, etc.)", async () => {
        const tctx = await makeCtx();
        const ok = createParamVariables(tctx, [
            { kind: "param", id: "p1", name: "arr", type: { kind: "array", elementType: { kind: "basic", name: "Int" } } },
        ] as any[]);
        expect(ok).toBe(false);
    });
});

// =============================================================================
// translateLiteral branches
// =============================================================================

describe("translateLiteral (via translateExpr)", () => {
    it("translates boolean literal", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, { kind: "literal", id: "l1", value: true } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("translates integer literal", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, { kind: "literal", id: "l1", value: 42 } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("translates float literal", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, { kind: "literal", id: "l1", value: 3.14 } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("returns null for string literal", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, { kind: "literal", id: "l1", value: "hello" } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors).toHaveLength(1);
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("literal:string");
    });
});

// =============================================================================
// translateIdent branches
// =============================================================================

describe("translateIdent", () => {
    it("returns null for unknown identifier", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, { kind: "ident", id: "i1", name: "unknown" } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("ident:unknown");
    });
});

// =============================================================================
// translateBinop branches
// =============================================================================

describe("translateBinop", () => {
    it("translates all arithmetic operators", async () => {
        const ops = ["+", "-", "*", "/", "%"];
        for (const op of ops) {
            const tctx = await makeCtx(["x", "y"]);
            const result = translateExpr(tctx, {
                kind: "binop", id: "b1", op,
                left: { kind: "ident", id: "l1", name: "x" },
                right: { kind: "ident", id: "r1", name: "y" },
            } as Expression, "c1", "fn");
            expect(result).not.toBeNull();
        }
    });

    it("translates all comparison operators", async () => {
        const ops = ["==", "!=", "<", ">", "<=", ">="];
        for (const op of ops) {
            const tctx = await makeCtx(["x", "y"]);
            const result = translateExpr(tctx, {
                kind: "binop", id: "b1", op,
                left: { kind: "ident", id: "l1", name: "x" },
                right: { kind: "ident", id: "r1", name: "y" },
            } as Expression, "c1", "fn");
            expect(result).not.toBeNull();
        }
    });

    it("translates logical operators (and, or, implies)", async () => {
        const ctx = await getZ3();
        const tctx: TranslationContext = { ctx, variables: new Map(), errors: [] };
        tctx.variables.set("a", ctx.Bool.const("a"));
        tctx.variables.set("b", ctx.Bool.const("b"));

        for (const op of ["and", "or", "implies"]) {
            const result = translateExpr(tctx, {
                kind: "binop", id: "b1", op,
                left: { kind: "ident", id: "l1", name: "a" },
                right: { kind: "ident", id: "r1", name: "b" },
            } as Expression, "c1", "fn");
            expect(result).not.toBeNull();
            tctx.errors = [];
        }
    });

    it("returns null for unsupported binop operator", async () => {
        const tctx = await makeCtx(["x", "y"]);
        const result = translateExpr(tctx, {
            kind: "binop", id: "b1", op: "++",
            left: { kind: "ident", id: "l1", name: "x" },
            right: { kind: "ident", id: "r1", name: "y" },
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("binop:++");
    });
});

// =============================================================================
// translateUnop branches
// =============================================================================

describe("translateUnop", () => {
    it("translates not operator", async () => {
        const ctx = await getZ3();
        const tctx: TranslationContext = { ctx, variables: new Map(), errors: [] };
        tctx.variables.set("a", ctx.Bool.const("a"));
        const result = translateExpr(tctx, {
            kind: "unop", id: "u1", op: "not",
            operand: { kind: "ident", id: "i1", name: "a" },
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("translates negate operator", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "unop", id: "u1", op: "-",
            operand: { kind: "ident", id: "i1", name: "x" },
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("returns null for unsupported unop", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "unop", id: "u1", op: "~" as any,
            operand: { kind: "ident", id: "i1", name: "x" },
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("unop:~");
    });
});

// =============================================================================
// translateAccess branches
// =============================================================================

describe("translateAccess", () => {
    it("translates simple ident.field access", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "access", id: "a1", field: "length",
            target: { kind: "ident", id: "i1", name: "x" },
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("reuses variable on repeated access", async () => {
        const tctx = await makeCtx(["x"]);
        translateExpr(tctx, {
            kind: "access", id: "a1", field: "length",
            target: { kind: "ident", id: "i1", name: "x" },
        } as Expression, "c1", "fn");
        const result2 = translateExpr(tctx, {
            kind: "access", id: "a2", field: "length",
            target: { kind: "ident", id: "i2", name: "x" },
        } as Expression, "c1", "fn");
        expect(result2).not.toBeNull();
    });

    it("returns null for complex target (non-ident)", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "access", id: "a1", field: "length",
            target: {
                kind: "call", id: "c-001",
                fn: { kind: "ident", id: "i1", name: "foo" },
                args: [],
            },
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("access:complex_target");
    });
});

// =============================================================================
// translateIf branches
// =============================================================================

describe("translateIf", () => {
    it("returns null for if without else", async () => {
        const ctx = await getZ3();
        const tctx: TranslationContext = { ctx, variables: new Map(), errors: [] };
        tctx.variables.set("x", ctx.Bool.const("x"));
        const result = translateExpr(tctx, {
            kind: "if", id: "if1",
            condition: { kind: "ident", id: "i1", name: "x" },
            then: [{ kind: "literal", id: "l1", value: 1 }],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("if:missing_else");
    });
});

// =============================================================================
// translateMatch branches
// =============================================================================

describe("translateMatch", () => {
    it("translates match with literal and wildcard arms", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "match", id: "m1",
            target: { kind: "ident", id: "i1", name: "x" },
            arms: [
                { pattern: { kind: "literal_pattern", value: 1 }, body: [{ kind: "literal", id: "l1", value: 10 }] },
                { pattern: { kind: "wildcard" }, body: [{ kind: "literal", id: "l2", value: 0 }] },
            ],
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("translates match with binding arm", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "match", id: "m1",
            target: { kind: "ident", id: "i1", name: "x" },
            arms: [
                { pattern: { kind: "binding", name: "val" }, body: [{ kind: "ident", id: "i2", name: "val" }] },
            ],
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("returns null for constructor pattern", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "match", id: "m1",
            target: { kind: "ident", id: "i1", name: "x" },
            arms: [
                { pattern: { kind: "constructor", name: "Some", fields: [] }, body: [{ kind: "literal", id: "l1", value: 1 }] },
            ],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
    });

    it("returns null for empty match", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "match", id: "m1",
            target: { kind: "ident", id: "i1", name: "x" },
            arms: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("match:empty");
    });

    it("returns null for match without wildcard", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "match", id: "m1",
            target: { kind: "ident", id: "i1", name: "x" },
            arms: [
                { pattern: { kind: "literal_pattern", value: 1 }, body: [{ kind: "literal", id: "l1", value: 10 }] },
            ],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("match:no_wildcard");
    });
});

// =============================================================================
// translateCall branches
// =============================================================================

describe("translateCall", () => {
    it("inlines a simple pure function call", async () => {
        const helper = simpleFn();
        const mod = simpleModule(helper);
        const tctx = await makeCtx(["a"], mod);
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [{ kind: "ident", id: "i2", name: "a" }],
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });

    it("returns null for complex fn (non-ident)", async () => {
        const tctx = await makeCtx(["x"]);
        tctx.module = simpleModule();
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "access", id: "a1", target: { kind: "ident", id: "i1", name: "x" }, field: "apply" },
            args: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:complex_fn");
    });

    it("returns null for call without module context", async () => {
        const tctx = await makeCtx(["x"]);
        // tctx.module is undefined
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:no_module");
    });

    it("returns null for unknown function", async () => {
        const mod = simpleModule();
        const tctx = await makeCtx(["x"], mod);
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "unknown_fn" },
            args: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:unknown_fn:unknown_fn");
    });

    it("returns null for non-pure callee", async () => {
        const impureFn = simpleFn({ effects: ["io"] as any });
        const mod = simpleModule(impureFn);
        const tctx = await makeCtx(["x"], mod);
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [{ kind: "ident", id: "i2", name: "x" }],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:not_pure:helper");
    });

    it("returns null for callee with empty body", async () => {
        const emptyFn = simpleFn({ body: [] });
        const mod = simpleModule(emptyFn);
        const tctx = await makeCtx(["x"], mod);
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [{ kind: "ident", id: "i2", name: "x" }],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:empty_body:helper");
    });

    it("returns null for arity mismatch", async () => {
        const helper = simpleFn();
        const mod = simpleModule(helper);
        const tctx = await makeCtx(["x"], mod);
        // Call with 0 args but helper expects 1
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:arity:helper");
    });

    it("returns null for recursive calls", async () => {
        const helper = simpleFn({
            body: [{
                kind: "call", id: "c-rec",
                fn: { kind: "ident", id: "i-rec", name: "helper" },
                args: [{ kind: "ident", id: "i-x", name: "x" }],
            } as Expression],
        });
        const mod = simpleModule(helper);
        const tctx = await makeCtx(["a"], mod);
        tctx.visitedFunctions = new Set(["helper"]);
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [{ kind: "ident", id: "i2", name: "a" }],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:recursive:helper");
    });

    it("returns null at max call depth", async () => {
        const helper = simpleFn();
        const mod = simpleModule(helper);
        const tctx = await makeCtx(["a"], mod);
        tctx.callDepth = 5;
        const result = translateExpr(tctx, {
            kind: "call", id: "c1",
            fn: { kind: "ident", id: "i1", name: "helper" },
            args: [{ kind: "ident", id: "i2", name: "a" }],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("call:max_depth:helper");
    });
});

// =============================================================================
// translateExprList branches
// =============================================================================

describe("translateExprList", () => {
    it("returns null for empty list", async () => {
        const tctx = await makeCtx();
        const result = translateExprList(tctx, [], "c1", "fn");
        expect(result).toBeNull();
    });

    it("accumulates let bindings in multi-expression list", async () => {
        const tctx = await makeCtx();
        const exprs: Expression[] = [
            { kind: "let", id: "let1", name: "a", mutable: false, value: { kind: "literal", id: "l1", value: 5 }, type: { kind: "basic", name: "Int" } },
            { kind: "ident", id: "i1", name: "a" },
        ] as Expression[];
        const result = translateExprList(tctx, exprs, "c1", "fn");
        expect(result).not.toBeNull();
    });
});

// =============================================================================
// translateBlock
// =============================================================================

describe("translateBlock", () => {
    it("translates block expression", async () => {
        const tctx = await makeCtx(["x"]);
        const result = translateExpr(tctx, {
            kind: "block", id: "b1",
            body: [{ kind: "ident", id: "i1", name: "x" }],
        } as Expression, "c1", "fn");
        expect(result).not.toBeNull();
    });
});

// =============================================================================
// Default unsupported expression kinds
// =============================================================================

describe("unsupported expression kinds", () => {
    it("returns null for array expressions", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, {
            kind: "array", id: "a1", elements: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("array");
    });

    it("returns null for tuple_expr", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, {
            kind: "tuple_expr", id: "t1", elements: [],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("tuple_expr");
    });

    it("returns null for lambda", async () => {
        const tctx = await makeCtx();
        const result = translateExpr(tctx, {
            kind: "lambda", id: "lam1", params: [], body: [{ kind: "literal", id: "l1", value: 0 }],
        } as Expression, "c1", "fn");
        expect(result).toBeNull();
        expect(tctx.errors[0]!.unsupportedNodeKind).toBe("lambda");
    });
});
