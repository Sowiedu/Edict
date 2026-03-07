// =============================================================================
// String Interpolation — E2E Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";

// Helper: check → compile → run
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

// Helper: build a program that prints a string_interp result and returns 0
function printInterpProgram(parts: unknown[]): unknown {
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
                body: [
                    {
                        kind: "call",
                        id: "call-print",
                        fn: { kind: "ident", id: "id-print", name: "print" },
                        args: [
                            { kind: "string_interp", id: "si-001", parts },
                        ],
                    },
                    { kind: "literal", id: "lit-ret", value: 0 },
                ],
            },
        ],
    };
}

// =============================================================================
// Validator Tests
// =============================================================================

describe("string_interp — validator", () => {
    it("accepts a valid string_interp expression", () => {
        const raw = printInterpProgram([
            { kind: "literal", id: "s1", value: "hello" },
            { kind: "literal", id: "s2", value: " world" },
        ]);
        const result = validate(raw);
        expect(result.ok).toBe(true);
    });

    it("rejects string_interp with missing parts", () => {
        const raw = {
            kind: "module",
            id: "mod1",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn1",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["pure"],
                    contracts: [],
                    body: [
                        { kind: "string_interp", id: "si1" },
                    ],
                },
            ],
        };
        const result = validate(raw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(e => e.error === "missing_field" && e.field === "parts");
            expect(err).toBeDefined();
        }
    });

    it("rejects string_interp with non-array parts", () => {
        const raw = {
            kind: "module",
            id: "mod1",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn1",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["pure"],
                    contracts: [],
                    body: [
                        { kind: "string_interp", id: "si1", parts: "not_an_array" },
                    ],
                },
            ],
        };
        const result = validate(raw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(e => e.error === "invalid_field_type" && e.field === "parts");
            expect(err).toBeDefined();
        }
    });

    it("accepts string_interp with empty parts", () => {
        const raw = printInterpProgram([]);
        const result = validate(raw);
        expect(result.ok).toBe(true);
    });
});

// =============================================================================
// Type Checker Tests
// =============================================================================

describe("string_interp — type checker", () => {
    it("type-checks valid string_interp with no errors", async () => {
        const ast = printInterpProgram([
            { kind: "literal", id: "s1", value: "hello" },
            { kind: "literal", id: "s2", value: " world" },
        ]);
        const checkResult = await check(ast);
        expect(checkResult.ok).toBe(true);
    });

    it("emits type_mismatch when a part is not String", async () => {
        const ast = {
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
                    body: [
                        {
                            kind: "string_interp",
                            id: "si-001",
                            parts: [
                                { kind: "literal", id: "s1", value: "hello" },
                                { kind: "literal", id: "i1", value: 42 },
                            ],
                        },
                    ],
                },
            ],
        };
        const checkResult = await check(ast);
        expect(checkResult.ok).toBe(false);
        if (!checkResult.ok) {
            const mismatch = checkResult.errors.find(e => e.error === "type_mismatch");
            expect(mismatch).toBeDefined();
        }
    });
});

// =============================================================================
// E2E Codegen Tests
// =============================================================================

describe("string_interp — codegen e2e", () => {
    it("single literal part", async () => {
        const ast = printInterpProgram([
            { kind: "literal", id: "s1", value: "hello" },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });

    it("two literal parts", async () => {
        const ast = printInterpProgram([
            { kind: "literal", id: "s1", value: "hello" },
            { kind: "literal", id: "s2", value: " world" },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello world");
    });

    it("three literal parts", async () => {
        const ast = printInterpProgram([
            { kind: "literal", id: "s1", value: "a" },
            { kind: "literal", id: "s2", value: "b" },
            { kind: "literal", id: "s3", value: "c" },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("abc");
    });

    it("mixed parts with variable", async () => {
        const ast = {
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
                    body: [
                        {
                            kind: "let",
                            id: "let-001",
                            name: "name",
                            type: { kind: "basic", name: "String" },
                            value: { kind: "literal", id: "s0", value: "Edict" },
                        },
                        {
                            kind: "call",
                            id: "call-print",
                            fn: { kind: "ident", id: "id-print", name: "print" },
                            args: [
                                {
                                    kind: "string_interp",
                                    id: "si-001",
                                    parts: [
                                        { kind: "literal", id: "s1", value: "Hello, " },
                                        { kind: "ident", id: "id-name", name: "name" },
                                        { kind: "literal", id: "s2", value: "!" },
                                    ],
                                },
                            ],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("Hello, Edict!");
    });

    it("mixed parts with function call (intToString)", async () => {
        const ast = {
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
                    body: [
                        {
                            kind: "call",
                            id: "call-print",
                            fn: { kind: "ident", id: "id-print", name: "print" },
                            args: [
                                {
                                    kind: "string_interp",
                                    id: "si-001",
                                    parts: [
                                        { kind: "literal", id: "s1", value: "The answer is " },
                                        {
                                            kind: "call",
                                            id: "c-its",
                                            fn: { kind: "ident", id: "id-its", name: "intToString" },
                                            args: [{ kind: "literal", id: "i1", value: 42 }],
                                        },
                                    ],
                                },
                            ],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("The answer is 42");
    });

    it("empty parts prints empty string", async () => {
        const ast = printInterpProgram([]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("");
    });

    it("nested string_interp", async () => {
        const ast = printInterpProgram([
            { kind: "literal", id: "s1", value: "outer(" },
            {
                kind: "string_interp",
                id: "si-inner",
                parts: [
                    { kind: "literal", id: "s2", value: "inner1" },
                    { kind: "literal", id: "s3", value: "+inner2" },
                ],
            },
            { kind: "literal", id: "s4", value: ")" },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("outer(inner1+inner2)");
    });

    it("five parts — stress test", async () => {
        const ast = printInterpProgram([
            { kind: "literal", id: "s1", value: "a" },
            { kind: "literal", id: "s2", value: "b" },
            { kind: "literal", id: "s3", value: "c" },
            { kind: "literal", id: "s4", value: "d" },
            { kind: "literal", id: "s5", value: "e" },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("abcde");
    });
});
