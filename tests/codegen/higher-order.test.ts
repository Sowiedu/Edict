import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { run } from "../../src/codegen/runner.js";
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
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
    return run(compiled.wasm);
}

// ---------------------------------------------------------------------------
// Tests — Higher-Order Functions
// ---------------------------------------------------------------------------

describe("higher-order functions — lambda passed as argument", () => {
    it("apply(f, x) where f is a lambda (n) => n + 1", async () => {
        // apply: (f: (Int) -> Int, x: Int) -> Int = f(x)
        // main: apply((n) => n + 1, 5)
        const mod = mkModule([
            mkFn("apply", [
                {
                    kind: "call", id: "c-f",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-x", name: "x" }],
                },
            ], {
                params: [
                    {
                        kind: "param", id: "p-f", name: "f",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: ["pure"],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                    {
                        kind: "param", id: "p-x", name: "x",
                        type: { kind: "basic", name: "Int" },
                    },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        {
                            kind: "lambda", id: "lam-1",
                            params: [{
                                kind: "param", id: "p-n", name: "n",
                                type: { kind: "basic", name: "Int" },
                            }],
                            body: [{
                                kind: "binop", id: "b-add", op: "+",
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

describe("higher-order functions — named function passed as argument", () => {
    it("apply(double, 5) where double(n) = n * 2", async () => {
        const mod = mkModule([
            mkFn("double", [
                {
                    kind: "binop", id: "b-mul", op: "*",
                    left: { kind: "ident", id: "i-n", name: "n" },
                    right: mkLiteral(2, "l-2"),
                },
            ], {
                params: [{
                    kind: "param", id: "p-n", name: "n",
                    type: { kind: "basic", name: "Int" },
                }],
            }),
            mkFn("apply", [
                {
                    kind: "call", id: "c-f",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-x", name: "x" }],
                },
            ], {
                params: [
                    {
                        kind: "param", id: "p-f", name: "f",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: ["pure"],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                    {
                        kind: "param", id: "p-x", name: "x",
                        type: { kind: "basic", name: "Int" },
                    },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-apply",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        { kind: "ident", id: "i-double", name: "double" },
                        mkLiteral(5, "l-5"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(10);
    });
});

describe("higher-order functions — function stored in variable", () => {
    it("let f = add; f(1, 2) returns 3", async () => {
        const mod = mkModule([
            mkFn("add", [
                {
                    kind: "binop", id: "b-add", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                },
            ], {
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                {
                    kind: "let", id: "let-f", name: "f",
                    value: { kind: "ident", id: "i-add", name: "add" },
                },
                {
                    kind: "call", id: "c-f",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [mkLiteral(1, "l-1"), mkLiteral(2, "l-2")],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(3);
    });
});

describe("higher-order functions — lambda with multiple params", () => {
    it("apply2(f, 3, 4) where f = (a, b) => a * b returns 12", async () => {
        const mod = mkModule([
            mkFn("apply2", [
                {
                    kind: "call", id: "c-f",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [
                        { kind: "ident", id: "i-a", name: "a" },
                        { kind: "ident", id: "i-b", name: "b" },
                    ],
                },
            ], {
                params: [
                    {
                        kind: "param", id: "p-f", name: "f",
                        type: {
                            kind: "fn_type",
                            params: [
                                { kind: "basic", name: "Int" },
                                { kind: "basic", name: "Int" },
                            ],
                            effects: ["pure"],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-apply2",
                    fn: { kind: "ident", id: "i-apply2", name: "apply2" },
                    args: [
                        {
                            kind: "lambda", id: "lam-mul",
                            params: [
                                { kind: "param", id: "p-la", name: "a", type: { kind: "basic", name: "Int" } },
                                { kind: "param", id: "p-lb", name: "b", type: { kind: "basic", name: "Int" } },
                            ],
                            body: [{
                                kind: "binop", id: "b-mul", op: "*",
                                left: { kind: "ident", id: "i-la", name: "a" },
                                right: { kind: "ident", id: "i-lb", name: "b" },
                            }],
                        },
                        mkLiteral(3, "l-3"),
                        mkLiteral(4, "l-4"),
                    ],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(12);
    });
});

describe("higher-order functions — function returning function", () => {
    it("getIncrementer returns lambda, caller invokes it", async () => {
        // getIncrementer() returns a lambda (n) => n + 10
        // main calls getIncrementer(), stores result, invokes with 5 → 15
        const mod = mkModule([
            mkFn("getIncrementer", [
                {
                    kind: "lambda", id: "lam-inc",
                    params: [{
                        kind: "param", id: "p-n", name: "n",
                        type: { kind: "basic", name: "Int" },
                    }],
                    body: [{
                        kind: "binop", id: "b-add", op: "+",
                        left: { kind: "ident", id: "i-n", name: "n" },
                        right: mkLiteral(10, "l-10"),
                    }],
                },
            ], {
                returnType: {
                    kind: "fn_type",
                    params: [{ kind: "basic", name: "Int" }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                },
            }),
            mkFn("main", [
                {
                    kind: "let", id: "let-inc", name: "inc",
                    value: {
                        kind: "call", id: "c-getinc",
                        fn: { kind: "ident", id: "i-getinc", name: "getIncrementer" },
                        args: [],
                    },
                },
                {
                    kind: "call", id: "c-inc",
                    fn: { kind: "ident", id: "i-inc", name: "inc" },
                    args: [mkLiteral(5, "l-5")],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(15);
    });
});

describe("higher-order functions — direct calls still work", () => {
    it("existing direct call patterns are unaffected", async () => {
        const mod = mkModule([
            mkFn("add", [
                {
                    kind: "binop", id: "b-add", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                },
            ], {
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-add",
                    fn: { kind: "ident", id: "i-add", name: "add" },
                    args: [mkLiteral(10, "l-10"), mkLiteral(32, "l-32")],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(42);
    });
});

describe("higher-order functions — lambda called inline", () => {
    it("immediately invoked lambda expression", async () => {
        // main: ((n) => n * 3)(7) = 21
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-iife",
                    fn: {
                        kind: "lambda", id: "lam-triple",
                        params: [{
                            kind: "param", id: "p-n", name: "n",
                            type: { kind: "basic", name: "Int" },
                        }],
                        body: [{
                            kind: "binop", id: "b-mul", op: "*",
                            left: { kind: "ident", id: "i-n", name: "n" },
                            right: mkLiteral(3, "l-3"),
                        }],
                    },
                    args: [mkLiteral(7, "l-7")],
                },
            ]),
        ]);
        const result = await compileAndRunModule(mod);
        expect(result.returnValue).toBe(21);
    });
});
