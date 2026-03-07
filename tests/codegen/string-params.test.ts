// =============================================================================
// String Function Parameters — Regression Tests for Issue #95
// =============================================================================
// Verifies that String parameters in user-defined functions correctly preserve
// their length across call boundaries. Before this fix, String params were
// compiled as a single i32 (pointer only) — the length was lost.

import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";

// Helper: check → compile → run and return the result
async function compileAndRun(ast: unknown) {
    const checkResult = await check(ast);
    if (!checkResult.ok) {
        throw new Error(`Check failed: ${JSON.stringify(checkResult.errors)}`);
    }
    const compileResult = compile(checkResult.module!);
    if (!compileResult.ok) {
        throw new Error(`Compile failed: ${JSON.stringify(compileResult.errors)}`);
    }
    return runDirect(compileResult.wasm);
}

// =============================================================================
// Issue #95 reproduction — string_concat(s, s) where s is a function param
// =============================================================================

describe("Issue #95 — String function param length preservation", () => {
    it("string_concat(s, s) on function param returns correct result", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-double", name: "double",
                    params: [{ kind: "param", id: "p-s", name: "s", type: { kind: "basic", name: "String" } }],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "String" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c1",
                        fn: { kind: "ident", id: "i1", name: "string_concat" },
                        args: [
                            { kind: "ident", id: "i-s1", name: "s" },
                            { kind: "ident", id: "i-s2", name: "s" },
                        ],
                    }],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "call", id: "c-print",
                            fn: { kind: "ident", id: "i-print", name: "print" },
                            args: [{
                                kind: "call", id: "c-double",
                                fn: { kind: "ident", id: "i-double", name: "double" },
                                args: [{ kind: "literal", id: "lit-ab", value: "AB" }],
                            }],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("ABAB");
    });
});

// =============================================================================
// string_length on function param
// =============================================================================

describe("string_length on function param", () => {
    it("returns correct length for String param", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-len", name: "len",
                    params: [{ kind: "param", id: "p-s", name: "s", type: { kind: "basic", name: "String" } }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c1",
                        fn: { kind: "ident", id: "i1", name: "string_length" },
                        args: [{ kind: "ident", id: "i-s", name: "s" }],
                    }],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c-len",
                        fn: { kind: "ident", id: "i-len", name: "len" },
                        args: [{ kind: "literal", id: "lit-hello", value: "hello" }],
                    }],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });
});

// =============================================================================
// print on function param
// =============================================================================

describe("print on function param", () => {
    it("prints the full string from a function param", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-shout", name: "shout",
                    params: [{ kind: "param", id: "p-s", name: "s", type: { kind: "basic", name: "String" } }],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "call", id: "c1",
                            fn: { kind: "ident", id: "i1", name: "print" },
                            args: [{ kind: "ident", id: "i-s", name: "s" }],
                        },
                        { kind: "literal", id: "lit-0", value: 0 },
                    ],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c-shout",
                        fn: { kind: "ident", id: "i-shout", name: "shout" },
                        args: [{ kind: "literal", id: "lit-hi", value: "hi there" }],
                    }],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hi there");
    });
});

// =============================================================================
// Multiple String params
// =============================================================================

describe("multiple String params", () => {
    it("joins two String params correctly", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-join", name: "join",
                    params: [
                        { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "String" } },
                        { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "String" } },
                    ],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "String" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c1",
                        fn: { kind: "ident", id: "i1", name: "string_concat" },
                        args: [
                            { kind: "ident", id: "i-a", name: "a" },
                            { kind: "ident", id: "i-b", name: "b" },
                        ],
                    }],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "call", id: "c-print",
                            fn: { kind: "ident", id: "i-print", name: "print" },
                            args: [{
                                kind: "call", id: "c-join",
                                fn: { kind: "ident", id: "i-join", name: "join" },
                                args: [
                                    { kind: "literal", id: "lit-1", value: "hello" },
                                    { kind: "literal", id: "lit-2", value: " world" },
                                ],
                            }],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello world");
    });
});

// =============================================================================
// Nested user function calls with String params
// =============================================================================

describe("nested string function calls", () => {
    it("function calling another function with String param", async () => {
        // wrap(s) calls double(s); double(s) = string_concat(s, s)
        // wrap("X") should produce "XX"
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-double", name: "double",
                    params: [{ kind: "param", id: "p-s1", name: "s", type: { kind: "basic", name: "String" } }],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "String" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c1",
                        fn: { kind: "ident", id: "i1", name: "string_concat" },
                        args: [
                            { kind: "ident", id: "i-s1", name: "s" },
                            { kind: "ident", id: "i-s2", name: "s" },
                        ],
                    }],
                },
                {
                    kind: "fn", id: "fn-wrap", name: "wrap",
                    params: [{ kind: "param", id: "p-s2", name: "s", type: { kind: "basic", name: "String" } }],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "String" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c2",
                        fn: { kind: "ident", id: "i2", name: "double" },
                        args: [{ kind: "ident", id: "i-s3", name: "s" }],
                    }],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "call", id: "c-print",
                            fn: { kind: "ident", id: "i-print", name: "print" },
                            args: [{
                                kind: "call", id: "c-wrap",
                                fn: { kind: "ident", id: "i-wrap", name: "wrap" },
                                args: [{ kind: "literal", id: "lit-x", value: "X" }],
                            }],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("XX");
    });
});

// =============================================================================
// String param + let binding in same function
// =============================================================================

describe("String param with let binding", () => {
    it("function uses both param and let-bound string", async () => {
        // greet(name) = let greeting = "Hello "; string_concat(greeting, name)
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-greet", name: "greet",
                    params: [{ kind: "param", id: "p-name", name: "name", type: { kind: "basic", name: "String" } }],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "String" },
                    contracts: [],
                    body: [
                        {
                            kind: "let", id: "let-1", name: "greeting",
                            type: { kind: "basic", name: "String" },
                            value: { kind: "literal", id: "lit-hello", value: "Hello " },
                        },
                        {
                            kind: "call", id: "c1",
                            fn: { kind: "ident", id: "i1", name: "string_concat" },
                            args: [
                                { kind: "ident", id: "i-greeting", name: "greeting" },
                                { kind: "ident", id: "i-name", name: "name" },
                            ],
                        },
                    ],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "call", id: "c-print",
                            fn: { kind: "ident", id: "i-print", name: "print" },
                            args: [{
                                kind: "call", id: "c-greet",
                                fn: { kind: "ident", id: "i-greet", name: "greet" },
                                args: [{ kind: "literal", id: "lit-world", value: "World" }],
                            }],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("Hello World");
    });
});

// =============================================================================
// Mixed String and non-String params
// =============================================================================

describe("mixed String and non-String params", () => {
    it("function with String and Int params works correctly", async () => {
        // repeat_n(s, n) uses string_length(s) to verify s is intact, returns n + string_length(s)
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "fn", id: "fn-f", name: "f",
                    params: [
                        { kind: "param", id: "p-s", name: "s", type: { kind: "basic", name: "String" } },
                        { kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } },
                    ],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "binop", id: "b1", op: "+",
                        left: { kind: "ident", id: "i-n", name: "n" },
                        right: {
                            kind: "call", id: "c1",
                            fn: { kind: "ident", id: "i1", name: "string_length" },
                            args: [{ kind: "ident", id: "i-s", name: "s" }],
                        },
                    }],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "c-f",
                        fn: { kind: "ident", id: "i-f", name: "f" },
                        args: [
                            { kind: "literal", id: "lit-abc", value: "abc" },
                            { kind: "literal", id: "lit-10", value: 10 },
                        ],
                    }],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(13); // 10 + 3
    });
});
