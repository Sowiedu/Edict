// =============================================================================
// Regex Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using each regex builtin and verify outputs.

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
        throw new Error(`Compile failed: ${compileResult.errors.join(", ")}`);
    }
    return runDirect(compileResult.wasm);
}

// Helper: build a minimal Edict program that returns a Bool from main
function boolProgram(bodyExprs: unknown[]): unknown {
    return {
        kind: "module",
        id: "mod-001",
        name: "test",
        imports: [],
        definitions: [
            {
                kind: "fn",
                id: "fn-main-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Bool" },
                contracts: [],
                body: bodyExprs,
            },
        ],
    };
}

// Helper: build a minimal Edict program that returns an Int from main
function intProgram(bodyExprs: unknown[]): unknown {
    return {
        kind: "module",
        id: "mod-001",
        name: "test",
        imports: [],
        definitions: [
            {
                kind: "fn",
                id: "fn-main-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: bodyExprs,
            },
        ],
    };
}

// Helper: build a program that prints output and returns 0
function printProgram(bodyExprs: unknown[]): unknown {
    return {
        kind: "module",
        id: "mod-001",
        name: "test",
        imports: [],
        definitions: [
            {
                kind: "fn",
                id: "fn-main-001",
                name: "main",
                params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [...bodyExprs, { kind: "literal", id: "lit-ret", value: 0 }],
            },
        ],
    };
}

// =============================================================================
// regexTest
// =============================================================================

describe("regexTest builtin", () => {
    it("returns 1 (true) when pattern matches", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "regexTest" },
                args: [
                    { kind: "literal", id: "lit-001", value: "\\d+" },
                    { kind: "literal", id: "lit-002", value: "abc123" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 (false) when pattern does not match", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "regexTest" },
                args: [
                    { kind: "literal", id: "lit-001", value: "\\d+" },
                    { kind: "literal", id: "lit-002", value: "abc" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });

    it("works with special regex characters", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "regexTest" },
                args: [
                    { kind: "literal", id: "lit-001", value: "^hello.*world$" },
                    { kind: "literal", id: "lit-002", value: "hello beautiful world" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 for invalid regex", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "regexTest" },
                args: [
                    { kind: "literal", id: "lit-001", value: "[invalid" },
                    { kind: "literal", id: "lit-002", value: "test" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });

    it("works with anchored patterns", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "regexTest" },
                args: [
                    { kind: "literal", id: "lit-001", value: "^abc$" },
                    { kind: "literal", id: "lit-002", value: "abc" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });
});

// =============================================================================
// regexMatch
// =============================================================================

describe("regexMatch builtin", () => {
    it("returns matched text", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexMatch" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "\\d+" },
                            { kind: "literal", id: "lit-002", value: "abc123def" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("123");
    });

    it("returns empty string when no match", async () => {
        // string_length of the result should be 0
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexMatch" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "\\d+" },
                            { kind: "literal", id: "lit-002", value: "abc" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });

    it("returns empty string for invalid regex", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexMatch" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "[invalid" },
                            { kind: "literal", id: "lit-002", value: "test" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });

    it("matches full pattern with groups", async () => {
        // Pattern with groups — returns the full match (not just group)
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexMatch" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "(\\d+)-(\\d+)" },
                            { kind: "literal", id: "lit-002", value: "phone: 123-456" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("123-456");
    });
});

// =============================================================================
// regexReplace
// =============================================================================

describe("regexReplace builtin", () => {
    it("replaces all occurrences", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexReplace" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "a1b2c3" },
                            { kind: "literal", id: "lit-002", value: "\\d" },
                            { kind: "literal", id: "lit-003", value: "*" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("a*b*c*");
    });

    it("returns original when pattern does not match", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexReplace" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "hello" },
                            { kind: "literal", id: "lit-002", value: "\\d+" },
                            { kind: "literal", id: "lit-003", value: "X" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });

    it("returns original for invalid regex", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexReplace" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "hello" },
                            { kind: "literal", id: "lit-002", value: "[invalid" },
                            { kind: "literal", id: "lit-003", value: "X" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });

    it("supports capture group references", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "regexReplace" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "John Smith" },
                            { kind: "literal", id: "lit-002", value: "(\\w+) (\\w+)" },
                            { kind: "literal", id: "lit-003", value: "$2, $1" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("Smith, John");
    });
});

// =============================================================================
// Composition — regex builtins with other builtins
// =============================================================================

describe("regex builtin composition", () => {
    it("regexTest + if conditional", async () => {
        // If input matches email pattern, return 1, else return 0
        const ast = intProgram([
            {
                kind: "if",
                id: "if-001",
                condition: {
                    kind: "call",
                    id: "call-test",
                    fn: { kind: "ident", id: "id-test", name: "regexTest" },
                    args: [
                        { kind: "literal", id: "lit-pat", value: "^[a-z]+@[a-z]+\\.[a-z]+$" },
                        { kind: "literal", id: "lit-input", value: "test@example.com" },
                    ],
                },
                then: [{ kind: "literal", id: "lit-yes", value: 1 }],
                else: [{ kind: "literal", id: "lit-no", value: 0 }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("regexReplace + string_length pipeline", async () => {
        // Replace all digits with nothing, then measure length
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-replace",
                        fn: { kind: "ident", id: "id-replace", name: "regexReplace" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "a1b2c3" },
                            { kind: "literal", id: "lit-002", value: "\\d" },
                            { kind: "literal", id: "lit-003", value: "" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3); // "abc" has length 3
    });
});
