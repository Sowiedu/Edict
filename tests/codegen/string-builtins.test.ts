// =============================================================================
// String Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using each string builtin and verify outputs.

import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { run } from "../../src/codegen/runner.js";

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
    return run(compileResult.wasm);
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
// string_length
// =============================================================================

describe("string_length builtin", () => {
    it("returns length of a string literal", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_length" },
                args: [{ kind: "literal", id: "lit-001", value: "hello" }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });

    it("returns 0 for empty string", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_length" },
                args: [{ kind: "literal", id: "lit-001", value: "" }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// toUpperCase / toLowerCase
// =============================================================================

describe("toUpperCase/toLowerCase builtins", () => {
    it("toUpperCase converts to uppercase and prints", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-upper",
                        fn: { kind: "ident", id: "id-upper", name: "toUpperCase" },
                        args: [{ kind: "literal", id: "lit-001", value: "hello" }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("HELLO");
    });

    it("toLowerCase converts to lowercase and prints", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-lower",
                        fn: { kind: "ident", id: "id-lower", name: "toLowerCase" },
                        args: [{ kind: "literal", id: "lit-001", value: "WORLD" }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("world");
    });
});

// =============================================================================
// string_trim
// =============================================================================

describe("string_trim builtin", () => {
    it("trims whitespace from both sides", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-trim",
                        fn: { kind: "ident", id: "id-trim", name: "string_trim" },
                        args: [{ kind: "literal", id: "lit-001", value: "  hello  " }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });
});

// =============================================================================
// string_concat
// =============================================================================

describe("string_concat builtin", () => {
    it("concatenates two strings", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-concat",
                        fn: { kind: "ident", id: "id-concat", name: "string_concat" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "hello" },
                            { kind: "literal", id: "lit-002", value: " world" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello world");
    });
});

// =============================================================================
// substring
// =============================================================================

describe("substring builtin", () => {
    it("extracts a substring", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-sub",
                        fn: { kind: "ident", id: "id-sub", name: "substring" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "hello world" },
                            { kind: "literal", id: "lit-002", value: 0 },
                            { kind: "literal", id: "lit-003", value: 5 },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });
});

// =============================================================================
// string_indexOf
// =============================================================================

describe("string_indexOf builtin", () => {
    it("finds substring position", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_indexOf" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello world" },
                    { kind: "literal", id: "lit-002", value: "world" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(6);
    });

    it("returns -1 when not found", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_indexOf" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello" },
                    { kind: "literal", id: "lit-002", value: "xyz" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        // -1 as signed i32
        expect(result.returnValue).toBe(-1);
    });
});

// =============================================================================
// string_startsWith / string_endsWith / string_contains
// =============================================================================

describe("string_startsWith builtin", () => {
    it("returns 1 (true) when string starts with prefix", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_startsWith" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello world" },
                    { kind: "literal", id: "lit-002", value: "hello" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 (false) when string does not start with prefix", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_startsWith" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello world" },
                    { kind: "literal", id: "lit-002", value: "world" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

describe("string_endsWith builtin", () => {
    it("returns 1 (true) when string ends with suffix", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_endsWith" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello world" },
                    { kind: "literal", id: "lit-002", value: "world" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 (false) when string does not end with suffix", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_endsWith" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello world" },
                    { kind: "literal", id: "lit-002", value: "hello" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

describe("string_contains builtin", () => {
    it("returns 1 (true) when string contains substring", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_contains" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello world" },
                    { kind: "literal", id: "lit-002", value: "lo wo" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 (false) when string does not contain substring", async () => {
        const ast = boolProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-001", name: "string_contains" },
                args: [
                    { kind: "literal", id: "lit-001", value: "hello" },
                    { kind: "literal", id: "lit-002", value: "xyz" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// string_repeat
// =============================================================================

describe("string_repeat builtin", () => {
    it("repeats a string N times", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-repeat",
                        fn: { kind: "ident", id: "id-repeat", name: "string_repeat" },
                        args: [
                            { kind: "literal", id: "lit-001", value: "ab" },
                            { kind: "literal", id: "lit-002", value: 3 },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("ababab");
    });
});

// =============================================================================
// Composition — using multiple string builtins together
// =============================================================================

describe("string builtin composition", () => {
    it("string_length(toUpperCase(s)) preserves length", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-len",
                fn: { kind: "ident", id: "id-len", name: "string_length" },
                args: [
                    {
                        kind: "call",
                        id: "call-upper",
                        fn: { kind: "ident", id: "id-upper", name: "toUpperCase" },
                        args: [{ kind: "literal", id: "lit-001", value: "hello" }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });

    it("toUpperCase + string_concat + print", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-concat",
                        fn: { kind: "ident", id: "id-concat", name: "string_concat" },
                        args: [
                            {
                                kind: "call",
                                id: "call-upper",
                                fn: { kind: "ident", id: "id-upper", name: "toUpperCase" },
                                args: [{ kind: "literal", id: "lit-001", value: "hello" }],
                            },
                            { kind: "literal", id: "lit-002", value: " world" },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("HELLO world");
    });

    it("string_contains after string_replace via let binding", async () => {
        const ast = boolProgram([
            {
                kind: "let",
                id: "let-001",
                name: "modified",
                type: { kind: "basic", name: "String" },
                value: {
                    kind: "call",
                    id: "call-replace",
                    fn: { kind: "ident", id: "id-replace", name: "string_replace" },
                    args: [
                        { kind: "literal", id: "lit-001", value: "hello world" },
                        { kind: "literal", id: "lit-002", value: "world" },
                        { kind: "literal", id: "lit-003", value: "edict" },
                    ],
                },
            },
            {
                kind: "call",
                id: "call-contains",
                fn: { kind: "ident", id: "id-contains", name: "string_contains" },
                args: [
                    { kind: "ident", id: "id-modified", name: "modified" },
                    { kind: "literal", id: "lit-004", value: "edict" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1); // true
    });
});
