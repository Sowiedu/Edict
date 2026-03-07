import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression } from "../../src/ast/nodes.js";
import { resolve } from "../../src/resolver/resolve.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkLiteral(value: number | string | boolean, id = "l-1"): Expression {
    return { kind: "literal", id, value };
}

function mkFn(
    name: string,
    body: Expression[],
    overrides: Partial<FunctionDef> = {},
): FunctionDef {
    return {
        kind: "fn",
        id: `fn-${name}`,
        name,
        params: [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body,
        ...overrides,
    };
}

function mkModule(
    defs: EdictModule["definitions"],
): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports: [],
        definitions: defs,
    };
}

async function compileAndRunModule(mod: EdictModule) {
    const compiled = compile(mod);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.errors.map(e => JSON.stringify(e)).join(", "));
    return runDirect(compiled.wasm);
}

// ---------------------------------------------------------------------------
// Self-recursion tests
// ---------------------------------------------------------------------------

describe("recursion — self-recursion", () => {
    it("recursive factorial computes 5! = 120", async () => {
        // factorial(n) = if n <= 1 then 1 else n * factorial(n - 1)
        const factFn = mkFn("factorial", [
            {
                kind: "if", id: "if-base",
                condition: {
                    kind: "binop", id: "b-lte", op: "<=",
                    left: { kind: "ident", id: "i-n-cond", name: "n" },
                    right: mkLiteral(1, "l-1"),
                },
                then: [mkLiteral(1, "l-base")],
                else: [
                    {
                        kind: "binop", id: "b-mul", op: "*",
                        left: { kind: "ident", id: "i-n-mul", name: "n" },
                        right: {
                            kind: "call", id: "c-rec",
                            fn: { kind: "ident", id: "i-fact", name: "factorial" },
                            args: [{
                                kind: "binop", id: "b-sub", op: "-",
                                left: { kind: "ident", id: "i-n-sub", name: "n" },
                                right: mkLiteral(1, "l-one"),
                            }],
                        },
                    },
                ],
            },
        ], {
            params: [{
                kind: "param", id: "p-n", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const mod = mkModule([
            factFn,
            mkFn("main", [{
                kind: "call", id: "c-main",
                fn: { kind: "ident", id: "i-fact-main", name: "factorial" },
                args: [mkLiteral(5, "l-5")],
            }]),
        ]);

        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(120);
    });

    it("self-recursive function resolves without errors", () => {
        // factorial calls itself — resolver should accept this
        const mod = mkModule([
            mkFn("factorial", [
                {
                    kind: "if", id: "if-1",
                    condition: {
                        kind: "binop", id: "b-1", op: "<=",
                        left: { kind: "ident", id: "i-n-1", name: "n" },
                        right: mkLiteral(1, "l-1"),
                    },
                    then: [mkLiteral(1, "l-base")],
                    else: [{
                        kind: "binop", id: "b-mul", op: "*",
                        left: { kind: "ident", id: "i-n-2", name: "n" },
                        right: {
                            kind: "call", id: "c-1",
                            fn: { kind: "ident", id: "i-fact", name: "factorial" },
                            args: [{
                                kind: "binop", id: "b-sub", op: "-",
                                left: { kind: "ident", id: "i-n-3", name: "n" },
                                right: mkLiteral(1, "l-one"),
                            }],
                        },
                    }],
                },
            ], {
                params: [{
                    kind: "param", id: "p-n", name: "n",
                    type: { kind: "basic", name: "Int" },
                }],
            }),
            mkFn("main", [mkLiteral(0, "l-0")]),
        ]);
        const errors = resolve(mod);
        expect(errors).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Mutual recursion tests
// ---------------------------------------------------------------------------

describe("recursion — mutual recursion", () => {
    it("isEven/isOdd mutual recursion computes correctly", async () => {
        // isEven(n) = if n == 0 then 1 else isOdd(n - 1)
        // isOdd(n)  = if n == 0 then 0 else isEven(n - 1)
        const isEvenFn = mkFn("isEven", [
            {
                kind: "if", id: "if-even",
                condition: {
                    kind: "binop", id: "b-eq-even", op: "==",
                    left: { kind: "ident", id: "i-n-even", name: "n" },
                    right: mkLiteral(0, "l-0-even"),
                },
                then: [mkLiteral(1, "l-true-even")],   // true
                else: [{
                    kind: "call", id: "c-odd",
                    fn: { kind: "ident", id: "i-isOdd", name: "isOdd" },
                    args: [{
                        kind: "binop", id: "b-sub-even", op: "-",
                        left: { kind: "ident", id: "i-n-even-sub", name: "n" },
                        right: mkLiteral(1, "l-1-even"),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: "p-n-even", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const isOddFn = mkFn("isOdd", [
            {
                kind: "if", id: "if-odd",
                condition: {
                    kind: "binop", id: "b-eq-odd", op: "==",
                    left: { kind: "ident", id: "i-n-odd", name: "n" },
                    right: mkLiteral(0, "l-0-odd"),
                },
                then: [mkLiteral(0, "l-false-odd")],   // false
                else: [{
                    kind: "call", id: "c-even",
                    fn: { kind: "ident", id: "i-isEven", name: "isEven" },
                    args: [{
                        kind: "binop", id: "b-sub-odd", op: "-",
                        left: { kind: "ident", id: "i-n-odd-sub", name: "n" },
                        right: mkLiteral(1, "l-1-odd"),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: "p-n-odd", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        // main: isEven(4) should return 1 (true)
        const mod = mkModule([
            isEvenFn,
            isOddFn,
            mkFn("main", [{
                kind: "call", id: "c-main",
                fn: { kind: "ident", id: "i-isEven-main", name: "isEven" },
                args: [mkLiteral(4, "l-4")],
            }]),
        ]);

        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(1); // 4 is even
    });

    it("isEven(3) returns 0 (false)", async () => {
        const isEvenFn = mkFn("isEven", [
            {
                kind: "if", id: "if-even",
                condition: {
                    kind: "binop", id: "b-eq-even", op: "==",
                    left: { kind: "ident", id: "i-n-even", name: "n" },
                    right: mkLiteral(0, "l-0-even"),
                },
                then: [mkLiteral(1, "l-true-even")],
                else: [{
                    kind: "call", id: "c-odd",
                    fn: { kind: "ident", id: "i-isOdd", name: "isOdd" },
                    args: [{
                        kind: "binop", id: "b-sub-even", op: "-",
                        left: { kind: "ident", id: "i-n-even-sub", name: "n" },
                        right: mkLiteral(1, "l-1-even"),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: "p-n-even", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const isOddFn = mkFn("isOdd", [
            {
                kind: "if", id: "if-odd",
                condition: {
                    kind: "binop", id: "b-eq-odd", op: "==",
                    left: { kind: "ident", id: "i-n-odd", name: "n" },
                    right: mkLiteral(0, "l-0-odd"),
                },
                then: [mkLiteral(0, "l-false-odd")],
                else: [{
                    kind: "call", id: "c-even",
                    fn: { kind: "ident", id: "i-isEven", name: "isEven" },
                    args: [{
                        kind: "binop", id: "b-sub-odd", op: "-",
                        left: { kind: "ident", id: "i-n-odd-sub", name: "n" },
                        right: mkLiteral(1, "l-1-odd"),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: "p-n-odd", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const mod = mkModule([
            isEvenFn,
            isOddFn,
            mkFn("main", [{
                kind: "call", id: "c-main",
                fn: { kind: "ident", id: "i-isEven-main", name: "isEven" },
                args: [mkLiteral(3, "l-3")],
            }]),
        ]);

        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(0); // 3 is odd
    });

    it("isOdd(7) returns 1 (true)", async () => {
        const isEvenFn = mkFn("isEven", [
            {
                kind: "if", id: "if-even",
                condition: {
                    kind: "binop", id: "b-eq-even", op: "==",
                    left: { kind: "ident", id: "i-n-even", name: "n" },
                    right: mkLiteral(0, "l-0-even"),
                },
                then: [mkLiteral(1, "l-true-even")],
                else: [{
                    kind: "call", id: "c-odd",
                    fn: { kind: "ident", id: "i-isOdd", name: "isOdd" },
                    args: [{
                        kind: "binop", id: "b-sub-even", op: "-",
                        left: { kind: "ident", id: "i-n-even-sub", name: "n" },
                        right: mkLiteral(1, "l-1-even"),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: "p-n-even", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const isOddFn = mkFn("isOdd", [
            {
                kind: "if", id: "if-odd",
                condition: {
                    kind: "binop", id: "b-eq-odd", op: "==",
                    left: { kind: "ident", id: "i-n-odd", name: "n" },
                    right: mkLiteral(0, "l-0-odd"),
                },
                then: [mkLiteral(0, "l-false-odd")],
                else: [{
                    kind: "call", id: "c-even",
                    fn: { kind: "ident", id: "i-isEven", name: "isEven" },
                    args: [{
                        kind: "binop", id: "b-sub-odd", op: "-",
                        left: { kind: "ident", id: "i-n-odd-sub", name: "n" },
                        right: mkLiteral(1, "l-1-odd"),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: "p-n-odd", name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const mod = mkModule([
            isEvenFn,
            isOddFn,
            mkFn("main", [{
                kind: "call", id: "c-main",
                fn: { kind: "ident", id: "i-isOdd-main", name: "isOdd" },
                args: [mkLiteral(7, "l-7")],
            }]),
        ]);

        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(1); // 7 is odd
    });

    it("mutual recursion resolves without errors", () => {
        // isEven calls isOdd, isOdd calls isEven — resolver should accept
        const mod = mkModule([
            mkFn("isEven", [
                {
                    kind: "call", id: "c-odd",
                    fn: { kind: "ident", id: "i-odd", name: "isOdd" },
                    args: [mkLiteral(0, "l-0")],
                },
            ], {
                params: [{
                    kind: "param", id: "p-n", name: "n",
                    type: { kind: "basic", name: "Int" },
                }],
            }),
            mkFn("isOdd", [
                {
                    kind: "call", id: "c-even",
                    fn: { kind: "ident", id: "i-even", name: "isEven" },
                    args: [mkLiteral(0, "l-0-2")],
                },
            ], {
                params: [{
                    kind: "param", id: "p-n-2", name: "n",
                    type: { kind: "basic", name: "Int" },
                }],
            }),
            mkFn("main", [mkLiteral(0, "l-ret")]),
        ]);
        const errors = resolve(mod);
        expect(errors).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Forward reference tests (B defined after A, A calls B)
// ---------------------------------------------------------------------------

describe("recursion — forward references", () => {
    it("main calls helper defined after it", async () => {
        // main is defined first, helper is defined second
        // main calls helper — this is a forward reference in definition order
        const mod = mkModule([
            mkFn("main", [{
                kind: "call", id: "c-1",
                fn: { kind: "ident", id: "i-helper", name: "helper" },
                args: [],
            }]),
            mkFn("helper", [mkLiteral(42, "l-42")]),
        ]);

        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(42);
    });

    it("three-function chain with mixed definition order", async () => {
        // c() calls b(), b() calls a(), but defined as c, a, b
        const mod = mkModule([
            mkFn("c", [{
                kind: "call", id: "c-b",
                fn: { kind: "ident", id: "i-b", name: "b" },
                args: [],
            }]),
            mkFn("a", [mkLiteral(99, "l-99")]),
            mkFn("b", [{
                kind: "call", id: "c-a",
                fn: { kind: "ident", id: "i-a", name: "a" },
                args: [],
            }]),
            mkFn("main", [{
                kind: "call", id: "c-c",
                fn: { kind: "ident", id: "i-c", name: "c" },
                args: [],
            }]),
        ]);

        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(99);
    });

    it("forward reference resolves without errors", () => {
        const mod = mkModule([
            mkFn("main", [{
                kind: "call", id: "c-1",
                fn: { kind: "ident", id: "i-later", name: "later" },
                args: [],
            }]),
            mkFn("later", [mkLiteral(0, "l-0")]),
        ]);
        const errors = resolve(mod);
        expect(errors).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Three-way mutual recursion
// ---------------------------------------------------------------------------

describe("recursion — three-way mutual recursion", () => {
    it("A→B→C→A chain terminates and returns correct value", async () => {
        // countdownA(n) = if n <= 0 then 0 else countdownB(n - 1)
        // countdownB(n) = if n <= 0 then 0 else countdownC(n - 1)
        // countdownC(n) = if n <= 0 then n else countdownA(n - 1)
        // countdownA(6) → B(5) → C(4) → A(3) → B(2) → C(1) → A(0) → 0
        const mkCountdown = (name: string, next: string, baseVal: number): FunctionDef => mkFn(name, [
            {
                kind: "if", id: `if-${name}`,
                condition: {
                    kind: "binop", id: `b-lte-${name}`, op: "<=",
                    left: { kind: "ident", id: `i-n-${name}`, name: "n" },
                    right: mkLiteral(0, `l-0-${name}`),
                },
                then: [mkLiteral(baseVal, `l-base-${name}`)],
                else: [{
                    kind: "call", id: `c-${name}`,
                    fn: { kind: "ident", id: `i-${next}-from-${name}`, name: next },
                    args: [{
                        kind: "binop", id: `b-sub-${name}`, op: "-",
                        left: { kind: "ident", id: `i-n-sub-${name}`, name: "n" },
                        right: mkLiteral(1, `l-1-${name}`),
                    }],
                }],
            },
        ], {
            params: [{
                kind: "param", id: `p-n-${name}`, name: "n",
                type: { kind: "basic", name: "Int" },
            }],
        });

        const mod = mkModule([
            mkCountdown("countA", "countB", 100),
            mkCountdown("countB", "countC", 200),
            mkCountdown("countC", "countA", 300),
            mkFn("main", [{
                kind: "call", id: "c-main",
                fn: { kind: "ident", id: "i-countA-main", name: "countA" },
                args: [mkLiteral(6, "l-6")],
            }]),
        ]);

        const result = await compileAndRunModule(mod);
        // countA(6)→B(5)→C(4)→A(3)→B(2)→C(1)→A(0)→100
        expect(result.returnValue).toBe(100);
    });
});
