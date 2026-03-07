// =============================================================================
// Crypto Hashing Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using sha256, md5, hmac builtins and verify outputs.

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

// Helper: build a program that prints a string result and returns 0
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

// Helper: build a program that returns Int from main
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

// =============================================================================
// sha256
// =============================================================================

describe("sha256 builtin", () => {
    it("returns correct hex hash of 'hello'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "sha256" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "hello" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    });

    it("returns correct hash of empty string", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "sha256" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("hash output has length 64", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "sha256" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "test data" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(64);
    });
});

// =============================================================================
// md5
// =============================================================================

describe("md5 builtin", () => {
    it("returns correct hex hash of 'hello'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "md5" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "hello" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("5d41402abc4b2a76b9719d911017c592");
    });

    it("returns correct hash of empty string", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "md5" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("d41d8cd98f00b204e9800998ecf8427e");
    });

    it("hash output has length 32", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "md5" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "test data" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(32);
    });
});

// =============================================================================
// hmac
// =============================================================================

describe("hmac builtin", () => {
    it("returns correct HMAC-SHA256", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "hmac" },
                        args: [
                            { kind: "literal", id: "lit-algo", value: "sha256" },
                            { kind: "literal", id: "lit-key", value: "secret" },
                            { kind: "literal", id: "lit-data", value: "hello" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        // Known HMAC-SHA256("secret", "hello") value
        expect(result.output).toBe("88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b");
    });

    it("returns correct HMAC-MD5", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "hmac" },
                        args: [
                            { kind: "literal", id: "lit-algo", value: "md5" },
                            { kind: "literal", id: "lit-key", value: "key" },
                            { kind: "literal", id: "lit-data", value: "data" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        // Known HMAC-MD5("key", "data") value
        expect(result.output).toBe("9d5c73ef85594d34ec4438b7c97e51d8");
    });

    it("returns empty string for invalid algorithm", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-001", name: "hmac" },
                        args: [
                            { kind: "literal", id: "lit-algo", value: "notahashalgorithm" },
                            { kind: "literal", id: "lit-key", value: "key" },
                            { kind: "literal", id: "lit-data", value: "data" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0); // empty string has length 0
    });
});

// =============================================================================
// Composition — crypto builtins with other builtins
// =============================================================================

describe("crypto builtin composition", () => {
    it("sha256 + regexTest — hash matches hex pattern", async () => {
        // Verify sha256 output is all hex characters
        const ast = intProgram([
            {
                kind: "if",
                id: "if-001",
                condition: {
                    kind: "call",
                    id: "call-test",
                    fn: { kind: "ident", id: "id-test", name: "regexTest" },
                    args: [
                        { kind: "literal", id: "lit-pat", value: "^[0-9a-f]{64}$" },
                        {
                            kind: "call",
                            id: "call-hash",
                            fn: { kind: "ident", id: "id-hash", name: "sha256" },
                            args: [
                                { kind: "literal", id: "lit-input", value: "anything" },
                            ],
                        },
                    ],
                },
                then: [{ kind: "literal", id: "lit-yes", value: 1 }],
                else: [{ kind: "literal", id: "lit-no", value: 0 }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("md5 + string_length pipeline", async () => {
        // MD5 hash is always 32 hex chars
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-hash",
                        fn: { kind: "ident", id: "id-hash", name: "md5" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "some content to hash" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(32);
    });

    it("sha256 determinism — same input always produces same output", async () => {
        // Hash same string twice, compare via regexTest with the known hash
        const ast = intProgram([
            {
                kind: "if",
                id: "if-001",
                condition: {
                    kind: "call",
                    id: "call-test",
                    fn: { kind: "ident", id: "id-test", name: "regexTest" },
                    args: [
                        // The exact SHA256 of "deterministic"
                        { kind: "literal", id: "lit-pat", value: "^0badac3c6df445ad3aea62da1350683923aba37c685978afed96a515d12921a3$" },
                        {
                            kind: "call",
                            id: "call-hash",
                            fn: { kind: "ident", id: "id-hash", name: "sha256" },
                            args: [
                                { kind: "literal", id: "lit-input", value: "deterministic" },
                            ],
                        },
                    ],
                },
                then: [{ kind: "literal", id: "lit-yes", value: 1 }],
                else: [{ kind: "literal", id: "lit-no", value: 0 }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });
});
