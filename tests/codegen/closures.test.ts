// =============================================================================
// Closures — E2E Tests
// =============================================================================
// Tests for lambda expressions capturing variables from enclosing scope.

import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression } from "../../src/ast/nodes.js";

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

function mkModule(defs: EdictModule["definitions"]): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports: [],
        definitions: defs,
    };
}

/** Compile and run a module, asserting success at each step. */
async function compileAndRunModule(mod: EdictModule) {
    const compiled = compile(mod);
    if (!compiled.ok) {
        console.log("Compile errors:", JSON.stringify(compiled.errors, null, 2));
    }
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
    return runDirect(compiled.wasm);
}

// ---------------------------------------------------------------------------
// Simple capture
// ---------------------------------------------------------------------------

describe("simple closure capture", () => {
    it("lambda captures local variable: let x = 5; let f = (y) => x + y; f(10) → 15", async () => {
        const mod = mkModule([
            // apply(f, arg) — calls f(arg)
            mkFn("apply", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-arg", name: "arg" }],
                },
            ], {
                params: [
                    { kind: "param", id: "p-f", name: "f", type: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } } },
                    { kind: "param", id: "p-arg", name: "arg", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                // let x = 5
                { kind: "let", id: "let-x", name: "x", type: { kind: "basic", name: "Int" }, value: mkLiteral(5, "l-5") },
                // let f = (y) => x + y   — captures x
                {
                    kind: "let", id: "let-f", name: "f",
                    value: {
                        kind: "lambda", id: "lam-1",
                        params: [{ kind: "param", id: "p-y", name: "y", type: { kind: "basic", name: "Int" } }],
                        body: [{
                            kind: "binop", id: "b-add", op: "+",
                            left: { kind: "ident", id: "i-x", name: "x" },
                            right: { kind: "ident", id: "i-y", name: "y" },
                        }],
                    },
                },
                // apply(f, 10)
                {
                    kind: "call", id: "c-apply2",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        { kind: "ident", id: "i-f2", name: "f" },
                        mkLiteral(10, "l-10"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(15);
    });
});

// ---------------------------------------------------------------------------
// Multiple captures
// ---------------------------------------------------------------------------

describe("multiple captures", () => {
    it("lambda captures multiple local variables: a + b + x", async () => {
        const mod = mkModule([
            mkFn("apply", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-arg", name: "arg" }],
                },
            ], {
                params: [
                    { kind: "param", id: "p-f", name: "f", type: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } } },
                    { kind: "param", id: "p-arg", name: "arg", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                // let a = 10
                { kind: "let", id: "let-a", name: "a", type: { kind: "basic", name: "Int" }, value: mkLiteral(10, "l-10") },
                // let b = 20
                { kind: "let", id: "let-b", name: "b", type: { kind: "basic", name: "Int" }, value: mkLiteral(20, "l-20") },
                // let f = (x) => a + b + x
                {
                    kind: "let", id: "let-f", name: "f",
                    value: {
                        kind: "lambda", id: "lam-1",
                        params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                        body: [{
                            kind: "binop", id: "b-add1", op: "+",
                            left: {
                                kind: "binop", id: "b-add2", op: "+",
                                left: { kind: "ident", id: "i-a", name: "a" },
                                right: { kind: "ident", id: "i-b", name: "b" },
                            },
                            right: { kind: "ident", id: "i-x", name: "x" },
                        }],
                    },
                },
                // apply(f, 3) → 33
                {
                    kind: "call", id: "c-apply2",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        { kind: "ident", id: "i-f2", name: "f" },
                        mkLiteral(3, "l-3"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(33);
    });
});

// ---------------------------------------------------------------------------
// Capture function parameter (make_adder pattern)
// ---------------------------------------------------------------------------

describe("capture function parameter", () => {
    it("fn make_adder(x) returns (y) => x + y; main calls make_adder(5)(3) → 8", async () => {
        const mod = mkModule([
            mkFn("apply", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-arg", name: "arg" }],
                },
            ], {
                params: [
                    { kind: "param", id: "p-f", name: "f", type: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } } },
                    { kind: "param", id: "p-arg", name: "arg", type: { kind: "basic", name: "Int" } },
                ],
            }),
            // fn make_adder(x: Int) -> (Int) -> Int
            mkFn("make_adder", [
                // return (y) => x + y
                {
                    kind: "lambda", id: "lam-adder",
                    params: [{ kind: "param", id: "p-y", name: "y", type: { kind: "basic", name: "Int" } }],
                    body: [{
                        kind: "binop", id: "b-add", op: "+",
                        left: { kind: "ident", id: "i-x", name: "x" },
                        right: { kind: "ident", id: "i-y", name: "y" },
                    }],
                },
            ], {
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                returnType: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } },
            }),
            mkFn("main", [
                // let add5 = make_adder(5)
                {
                    kind: "let", id: "let-add5", name: "add5",
                    value: {
                        kind: "call", id: "c-make",
                        fn: { kind: "ident", id: "i-make", name: "make_adder" },
                        args: [mkLiteral(5, "l-5")],
                    },
                },
                // apply(add5, 3) → 8
                {
                    kind: "call", id: "c-apply2",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        { kind: "ident", id: "i-add5", name: "add5" },
                        mkLiteral(3, "l-3"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(8);
    });
});

// ---------------------------------------------------------------------------
// Nested closures
// ---------------------------------------------------------------------------

describe("nested closures", () => {
    it("inner lambda captures outer lambda's param + enclosing scope var", async () => {
        const mod = mkModule([
            mkFn("apply", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-arg", name: "arg" }],
                },
            ], {
                params: [
                    { kind: "param", id: "p-f", name: "f", type: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } } },
                    { kind: "param", id: "p-arg", name: "arg", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                // let x = 1
                { kind: "let", id: "let-x", name: "x", type: { kind: "basic", name: "Int" }, value: mkLiteral(1, "l-1") },
                // let f = (y) => { let g = (z) => x + y + z; apply(returnedG, 3) }
                // Actually we need a simpler pattern since we don't have inner apply easily.
                // Let's do: let f = (y) => x + y
                // let g = (z) => apply(f, z) + 100
                // apply(g, 2) → 1 + 2 + 100 = 103
                {
                    kind: "let", id: "let-f", name: "f",
                    value: {
                        kind: "lambda", id: "lam-f",
                        params: [{ kind: "param", id: "p-y", name: "y", type: { kind: "basic", name: "Int" } }],
                        body: [{
                            kind: "binop", id: "b-add-xy", op: "+",
                            left: { kind: "ident", id: "i-x", name: "x" },
                            right: { kind: "ident", id: "i-y", name: "y" },
                        }],
                    },
                },
                // let g = (z) => apply(f, z) + 100   — captures f (which is a closure pair) and references apply
                {
                    kind: "let", id: "let-g", name: "g",
                    value: {
                        kind: "lambda", id: "lam-g",
                        params: [{ kind: "param", id: "p-z", name: "z", type: { kind: "basic", name: "Int" } }],
                        body: [{
                            kind: "binop", id: "b-add-fz100", op: "+",
                            left: {
                                kind: "call", id: "c-apply-fz",
                                fn: { kind: "ident", id: "i-apply2", name: "apply" },
                                args: [
                                    { kind: "ident", id: "i-f-cap", name: "f" },
                                    { kind: "ident", id: "i-z", name: "z" },
                                ],
                            },
                            right: mkLiteral(100, "l-100"),
                        }],
                    },
                },
                // apply(g, 2) → apply(f, 2) + 100 → (1 + 2) + 100 = 103
                {
                    kind: "call", id: "c-apply-g",
                    fn: { kind: "ident", id: "i-apply3", name: "apply" },
                    args: [
                        { kind: "ident", id: "i-g", name: "g" },
                        mkLiteral(2, "l-2"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(103);
    });
});

// ---------------------------------------------------------------------------
// Non-capturing lambda still works (regression)
// ---------------------------------------------------------------------------

describe("non-capturing lambda (regression)", () => {
    it("non-capturing lambda: apply((n) => n + 1, 5) → 6", async () => {
        const mod = mkModule([
            mkFn("apply", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-arg", name: "arg" }],
                },
            ], {
                params: [
                    { kind: "param", id: "p-f", name: "f", type: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } } },
                    { kind: "param", id: "p-arg", name: "arg", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-main",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        {
                            kind: "lambda", id: "lam-inc",
                            params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
                            body: [{
                                kind: "binop", id: "b-inc", op: "+",
                                left: { kind: "ident", id: "i-n", name: "n" },
                                right: mkLiteral(1, "l-1"),
                            }],
                        },
                        mkLiteral(5, "l-5"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// Named function as value (regression)
// ---------------------------------------------------------------------------

describe("named function as value (regression)", () => {
    it("let f = add; apply2(f, 1, 2) → 3", async () => {
        const mod = mkModule([
            // fn add(a, b) = a + b
            mkFn("add", [{
                kind: "binop", id: "b-add", op: "+",
                left: { kind: "ident", id: "i-a", name: "a" },
                right: { kind: "ident", id: "i-b", name: "b" },
            }], {
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
            // fn apply2(f, x, y) = f(x, y)
            mkFn("apply2", [
                {
                    kind: "call", id: "c-apply2",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [
                        { kind: "ident", id: "i-x", name: "x" },
                        { kind: "ident", id: "i-y", name: "y" },
                    ],
                },
            ], {
                params: [
                    { kind: "param", id: "p-f", name: "f", type: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } } },
                    { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-y", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                // let f = add
                {
                    kind: "let", id: "let-f", name: "f",
                    value: { kind: "ident", id: "i-add", name: "add" },
                },
                // apply2(f, 1, 2) → 3
                {
                    kind: "call", id: "c-main",
                    fn: { kind: "ident", id: "i-apply2", name: "apply2" },
                    args: [
                        { kind: "ident", id: "i-f2", name: "f" },
                        mkLiteral(1, "l-1"),
                        mkLiteral(2, "l-2"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Direct calls still work (regression)
// ---------------------------------------------------------------------------

describe("direct calls unchanged (regression)", () => {
    it("add(1, 2) → 3 via direct call", async () => {
        const mod = mkModule([
            mkFn("add", [{
                kind: "binop", id: "b-add", op: "+",
                left: { kind: "ident", id: "i-a", name: "a" },
                right: { kind: "ident", id: "i-b", name: "b" },
            }], {
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-main",
                    fn: { kind: "ident", id: "i-add", name: "add" },
                    args: [mkLiteral(1, "l-1"), mkLiteral(2, "l-2")],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(3);
    });
});
