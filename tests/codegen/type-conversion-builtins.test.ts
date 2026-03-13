// =============================================================================
// Type Conversion Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using each type conversion builtin and verify outputs.

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
    const compileResult = compile(checkResult.module!, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        throw new Error(`Compile failed: ${JSON.stringify(compileResult.errors)}`);
    }
    return runDirect(compileResult.wasm);
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
                body: [
                    ...bodyExprs,
                    { kind: "literal", id: "lit-ret-001", value: 0 },
                ],
            },
        ],
    };
}

// =============================================================================
// intToString
// =============================================================================

describe("intToString builtin", () => {
    it("intToString(42) prints '42'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-its-001", name: "intToString" },
                        args: [{ kind: "literal", id: "lit-001", value: 42 }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("42");
    });

    it("intToString(-7) prints '-7'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-its-001", name: "intToString" },
                        args: [
                            { kind: "unop", id: "unop-001", op: "-", operand: { kind: "literal", id: "lit-001", value: 7 } },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("-7");
    });

    it("intToString(0) prints '0'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-its-001", name: "intToString" },
                        args: [{ kind: "literal", id: "lit-001", value: 0 }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("0");
    });
});

// =============================================================================
// floatToString
// =============================================================================

describe("floatToString builtin", () => {
    it("floatToString(3.14) prints '3.14'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-fts-001", name: "floatToString" },
                        args: [
                            { kind: "literal", id: "lit-001", value: 3.14, type: { kind: "basic", name: "Float" } },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("3.14");
    });

    it("floatToString(0.0) prints '0'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-fts-001", name: "floatToString" },
                        args: [
                            { kind: "literal", id: "lit-001", value: 0.0, type: { kind: "basic", name: "Float" } },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("0");
    });
});

// =============================================================================
// boolToString
// =============================================================================

describe("boolToString builtin", () => {
    it("boolToString(true) prints 'true'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-bts-001", name: "boolToString" },
                        args: [{ kind: "literal", id: "lit-001", value: true }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("true");
    });

    it("boolToString(false) prints 'false'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-001",
                        fn: { kind: "ident", id: "id-bts-001", name: "boolToString" },
                        args: [{ kind: "literal", id: "lit-001", value: false }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("false");
    });
});

// =============================================================================
// floatToInt
// =============================================================================

describe("floatToInt builtin", () => {
    it("floatToInt(3.7) = 3 (truncation)", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-fti-001", name: "floatToInt" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3.7, type: { kind: "basic", name: "Float" } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });

    it("floatToInt(-2.9) = -2 (truncation toward zero)", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-fti-001", name: "floatToInt" },
                args: [
                    {
                        kind: "unop", id: "unop-001", op: "-",
                        operand: { kind: "literal", id: "lit-001", value: 2.9, type: { kind: "basic", name: "Float" } }
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(-2);
    });

    it("floatToInt(5.0) = 5", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-fti-001", name: "floatToInt" },
                args: [
                    { kind: "literal", id: "lit-001", value: 5.0, type: { kind: "basic", name: "Float" } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });
});

// =============================================================================
// intToFloat — returns Float, test via floatToInt roundtrip
// =============================================================================

describe("intToFloat builtin", () => {
    it("floatToInt(intToFloat(7)) = 7 (roundtrip)", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-fti-001",
                fn: { kind: "ident", id: "id-fti-001", name: "floatToInt" },
                args: [
                    {
                        kind: "call",
                        id: "call-itf-001",
                        fn: { kind: "ident", id: "id-itf-001", name: "intToFloat" },
                        args: [{ kind: "literal", id: "lit-001", value: 7 }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(7);
    });

    it("floor(intToFloat(42)) = 42", async () => {
        const ast = intProgram([
            {
                kind: "let",
                id: "let-001",
                name: "f",
                type: { kind: "basic", name: "Float" },
                value: {
                    kind: "call",
                    id: "call-itf-001",
                    fn: { kind: "ident", id: "id-itf-001", name: "intToFloat" },
                    args: [{ kind: "literal", id: "lit-001", value: 42 }],
                },
            },
            {
                kind: "call",
                id: "call-floor-001",
                fn: { kind: "ident", id: "id-floor-001", name: "floor" },
                args: [
                    { kind: "ident", id: "id-f-001", name: "f" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(42);
    });
});

// =============================================================================
// Composition — using multiple conversion builtins together
// =============================================================================

describe("type conversion composition", () => {
    it("intToString(floatToInt(3.14)) prints '3'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-its-001",
                        fn: { kind: "ident", id: "id-its-001", name: "intToString" },
                        args: [
                            {
                                kind: "call",
                                id: "call-fti-001",
                                fn: { kind: "ident", id: "id-fti-001", name: "floatToInt" },
                                args: [
                                    { kind: "literal", id: "lit-001", value: 3.14, type: { kind: "basic", name: "Float" } },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("3");
    });

    it("string_concat(intToString(10), boolToString(true)) prints '10true'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print",
                fn: { kind: "ident", id: "id-print", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-concat-001",
                        fn: { kind: "ident", id: "id-concat-001", name: "string_concat" },
                        args: [
                            {
                                kind: "call",
                                id: "call-its-001",
                                fn: { kind: "ident", id: "id-its-001", name: "intToString" },
                                args: [{ kind: "literal", id: "lit-001", value: 10 }],
                            },
                            {
                                kind: "call",
                                id: "call-bts-001",
                                fn: { kind: "ident", id: "id-bts-001", name: "boolToString" },
                                args: [{ kind: "literal", id: "lit-002", value: true }],
                            },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("10true");
    });
});

// =============================================================================
// print/println auto-coercion
// =============================================================================

describe("print auto-coercion", () => {
    it("print(42) auto-coerces Int to String", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-001",
                fn: { kind: "ident", id: "id-print-001", name: "print" },
                args: [{ kind: "literal", id: "lit-int-001", value: 42 }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("42");
    });

    it("print(3.14) auto-coerces Float to String", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-002",
                fn: { kind: "ident", id: "id-print-002", name: "print" },
                args: [{ kind: "literal", id: "lit-float-001", value: 3.14, type: { kind: "basic", name: "Float" } }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("3.14");
    });

    it("print(true) auto-coerces Bool to String", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-003",
                fn: { kind: "ident", id: "id-print-003", name: "print" },
                args: [{ kind: "literal", id: "lit-bool-001", value: true }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("true");
    });

    it("println(42) auto-coerces Int with newline", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-println-001",
                fn: { kind: "ident", id: "id-println-001", name: "println" },
                args: [{ kind: "literal", id: "lit-int-002", value: 42 }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("42\n");
    });

    it("print(false) auto-coerces Bool false", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-004",
                fn: { kind: "ident", id: "id-print-004", name: "print" },
                args: [{ kind: "literal", id: "lit-bool-002", value: false }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("false");
    });
});

// =============================================================================
// toString builtin
// =============================================================================

describe("toString builtin", () => {
    it("toString(42) returns string '42'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-ts-001",
                fn: { kind: "ident", id: "id-print-ts-001", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-ts-001",
                        fn: { kind: "ident", id: "id-ts-001", name: "toString" },
                        args: [{ kind: "literal", id: "lit-ts-int-001", value: 42 }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("42");
    });

    it("toString(3.14) returns string '3.14'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-ts-002",
                fn: { kind: "ident", id: "id-print-ts-002", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-ts-002",
                        fn: { kind: "ident", id: "id-ts-002", name: "toString" },
                        args: [{ kind: "literal", id: "lit-ts-float-001", value: 3.14, type: { kind: "basic", name: "Float" } }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("3.14");
    });

    it("toString(true) returns string 'true'", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-ts-003",
                fn: { kind: "ident", id: "id-print-ts-003", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-ts-003",
                        fn: { kind: "ident", id: "id-ts-003", name: "toString" },
                        args: [{ kind: "literal", id: "lit-ts-bool-001", value: true }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("true");
    });

    it("toString(\"hello\") is identity for String", async () => {
        const ast = printProgram([
            {
                kind: "call",
                id: "call-print-ts-004",
                fn: { kind: "ident", id: "id-print-ts-004", name: "print" },
                args: [
                    {
                        kind: "call",
                        id: "call-ts-004",
                        fn: { kind: "ident", id: "id-ts-004", name: "toString" },
                        args: [{ kind: "literal", id: "lit-ts-str-001", value: "hello" }],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });
});
