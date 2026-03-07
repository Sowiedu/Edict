// =============================================================================
// Math Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using each math builtin and verify outputs.

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

// =============================================================================
// abs
// =============================================================================

describe("abs builtin", () => {
    it("abs(-5) = 5", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-abs-001", name: "abs" },
                args: [
                    { kind: "unop", id: "unop-001", op: "-", operand: { kind: "literal", id: "lit-001", value: 5 } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });

    it("abs(3) = 3", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-abs-001", name: "abs" },
                args: [{ kind: "literal", id: "lit-001", value: 3 }],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });
});

// =============================================================================
// min / max
// =============================================================================

describe("min/max builtins", () => {
    it("min(3, 7) = 3", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-min-001", name: "min" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3 },
                    { kind: "literal", id: "lit-002", value: 7 },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });

    it("max(3, 7) = 7", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-max-001", name: "max" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3 },
                    { kind: "literal", id: "lit-002", value: 7 },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(7);
    });
});

// =============================================================================
// pow
// =============================================================================

describe("pow builtin", () => {
    it("pow(2, 10) = 1024", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-pow-001", name: "pow" },
                args: [
                    { kind: "literal", id: "lit-001", value: 2 },
                    { kind: "literal", id: "lit-002", value: 10 },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1024);
    });
});

// =============================================================================
// floor / ceil / round
// =============================================================================

describe("floor/ceil/round builtins", () => {
    it("floor(3.7) = 3", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-floor-001", name: "floor" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3.7, type: { kind: "basic", name: "Float" } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });

    it("ceil(3.2) = 4", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-ceil-001", name: "ceil" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3.2, type: { kind: "basic", name: "Float" } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(4);
    });

    it("round(3.5) = 4", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-round-001", name: "round" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3.5, type: { kind: "basic", name: "Float" } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(4);
    });

    it("round(3.4) = 3", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "id-round-001", name: "round" },
                args: [
                    { kind: "literal", id: "lit-001", value: 3.4, type: { kind: "basic", name: "Float" } },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });
});

// =============================================================================
// sqrt — returns Float, so we test via let binding + floor to get Int
// =============================================================================

describe("sqrt builtin", () => {
    it("floor(sqrt(16.0)) = 4", async () => {
        const ast = intProgram([
            // let s = sqrt(16.0)
            {
                kind: "let",
                id: "let-001",
                name: "s",
                type: { kind: "basic", name: "Float" },
                value: {
                    kind: "call",
                    id: "call-sqrt-001",
                    fn: { kind: "ident", id: "id-sqrt-001", name: "sqrt" },
                    args: [
                        { kind: "literal", id: "lit-001", value: 16.0, type: { kind: "basic", name: "Float" } },
                    ],
                },
            },
            // floor(s)
            {
                kind: "call",
                id: "call-floor-001",
                fn: { kind: "ident", id: "id-floor-001", name: "floor" },
                args: [
                    { kind: "ident", id: "id-s-001", name: "s" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(4);
    });

    it("floor(sqrt(2.0)) = 1", async () => {
        const ast = intProgram([
            {
                kind: "let",
                id: "let-001",
                name: "s",
                type: { kind: "basic", name: "Float" },
                value: {
                    kind: "call",
                    id: "call-sqrt-001",
                    fn: { kind: "ident", id: "id-sqrt-001", name: "sqrt" },
                    args: [
                        { kind: "literal", id: "lit-001", value: 2.0, type: { kind: "basic", name: "Float" } },
                    ],
                },
            },
            {
                kind: "call",
                id: "call-floor-001",
                fn: { kind: "ident", id: "id-floor-001", name: "floor" },
                args: [
                    { kind: "ident", id: "id-s-001", name: "s" },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });
});

// =============================================================================
// Composition — using multiple math builtins together
// =============================================================================

describe("math builtin composition", () => {
    it("abs(min(-10, 5)) = 10", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-abs-001",
                fn: { kind: "ident", id: "id-abs-001", name: "abs" },
                args: [
                    {
                        kind: "call",
                        id: "call-min-001",
                        fn: { kind: "ident", id: "id-min-001", name: "min" },
                        args: [
                            { kind: "unop", id: "unop-001", op: "-", operand: { kind: "literal", id: "lit-001", value: 10 } },
                            { kind: "literal", id: "lit-002", value: 5 },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(10);
    });

    it("max(pow(2, 3), pow(3, 2)) = 9", async () => {
        const ast = intProgram([
            {
                kind: "call",
                id: "call-max-001",
                fn: { kind: "ident", id: "id-max-001", name: "max" },
                args: [
                    {
                        kind: "call",
                        id: "call-pow-001",
                        fn: { kind: "ident", id: "id-pow-001", name: "pow" },
                        args: [
                            { kind: "literal", id: "lit-001", value: 2 },
                            { kind: "literal", id: "lit-002", value: 3 },
                        ],
                    },
                    {
                        kind: "call",
                        id: "call-pow-002",
                        fn: { kind: "ident", id: "id-pow-002", name: "pow" },
                        args: [
                            { kind: "literal", id: "lit-003", value: 3 },
                            { kind: "literal", id: "lit-004", value: 2 },
                        ],
                    },
                ],
            },
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(9);
    });
});
