// =============================================================================
// Array Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using each array builtin and verify outputs.

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

// Shorthand: array literal expression node
function arrayExpr(id: string, elements: unknown[]): unknown {
    return {
        kind: "array",
        id,
        elementType: { kind: "basic", name: "Int" },
        elements,
    };
}

// Shorthand: integer literal
function intLit(id: string, value: number): unknown {
    return { kind: "literal", id, value };
}

// Shorthand: call expression
function callExpr(id: string, fnName: string, args: unknown[]): unknown {
    return {
        kind: "call",
        id,
        fn: { kind: "ident", id: `id-${id}`, name: fnName },
        args,
    };
}

// =============================================================================
// array_length
// =============================================================================

describe("array_length builtin", () => {
    it("returns length of a non-empty array", async () => {
        const ast = intProgram([
            callExpr("call-001", "array_length", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 10),
                    intLit("lit-002", 20),
                    intLit("lit-003", 30),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });

    it("returns 0 for an empty array", async () => {
        const ast = intProgram([
            callExpr("call-001", "array_length", [
                arrayExpr("arr-001", []),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// array_get
// =============================================================================

describe("array_get builtin", () => {
    it("returns element at valid index", async () => {
        const ast = intProgram([
            callExpr("call-001", "array_get", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 10),
                    intLit("lit-002", 20),
                    intLit("lit-003", 30),
                ]),
                intLit("lit-idx", 1),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(20);
    });

    it("returns first element at index 0", async () => {
        const ast = intProgram([
            callExpr("call-001", "array_get", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 42),
                    intLit("lit-002", 99),
                ]),
                intLit("lit-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(42);
    });

    it("returns 0 for out-of-bounds index", async () => {
        const ast = intProgram([
            callExpr("call-001", "array_get", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 10),
                    intLit("lit-002", 20),
                ]),
                intLit("lit-idx", 5),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });

    it("returns 0 for negative index", async () => {
        const ast = intProgram([
            callExpr("call-001", "array_get", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 10),
                    intLit("lit-002", 20),
                ]),
                {
                    kind: "unop",
                    id: "unop-001",
                    op: "-",
                    operand: intLit("lit-idx", 1),
                },
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// array_set
// =============================================================================

describe("array_set builtin", () => {
    it("returns new array with updated element", async () => {
        // array_get(array_set([10, 20, 30], 1, 99), 1) → 99
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-set", "array_set", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                        intLit("lit-003", 30),
                    ]),
                    intLit("lit-idx", 1),
                    intLit("lit-val", 99),
                ]),
                intLit("lit-get-idx", 1),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(99);
    });

    it("OOB index returns array unchanged", async () => {
        // array_get(array_set([10, 20], 5, 99), 0) → 10 (unchanged)
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-set", "array_set", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                    ]),
                    intLit("lit-idx", 5),
                    intLit("lit-val", 99),
                ]),
                intLit("lit-get-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(10);
    });
});

// =============================================================================
// array_push
// =============================================================================

describe("array_push builtin", () => {
    it("increases length by 1", async () => {
        // array_length(array_push([10, 20], 30)) → 3
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-push", "array_push", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                    ]),
                    intLit("lit-val", 30),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });

    it("new element is accessible", async () => {
        // array_get(array_push([10, 20], 30), 2) → 30
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-push", "array_push", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                    ]),
                    intLit("lit-val", 30),
                ]),
                intLit("lit-idx", 2),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(30);
    });
});

// =============================================================================
// array_pop
// =============================================================================

describe("array_pop builtin", () => {
    it("removes the last element", async () => {
        // array_length(array_pop([10, 20, 30])) → 2
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-pop", "array_pop", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                        intLit("lit-003", 30),
                    ]),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(2);
    });

    it("popping empty array returns empty array", async () => {
        // array_length(array_pop([])) → 0
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-pop", "array_pop", [
                    arrayExpr("arr-001", []),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });

    it("preserves remaining elements after pop", async () => {
        // array_get(array_pop([10, 20, 30]), 1) → 20
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-pop", "array_pop", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                        intLit("lit-003", 30),
                    ]),
                ]),
                intLit("lit-idx", 1),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(20);
    });
});

// =============================================================================
// array_concat
// =============================================================================

describe("array_concat builtin", () => {
    it("concatenates two arrays", async () => {
        // array_length(array_concat([1, 2], [3, 4, 5])) → 5
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-concat", "array_concat", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 1),
                        intLit("lit-002", 2),
                    ]),
                    arrayExpr("arr-002", [
                        intLit("lit-003", 3),
                        intLit("lit-004", 4),
                        intLit("lit-005", 5),
                    ]),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });

    it("elements from both arrays are correct", async () => {
        // array_get(array_concat([1, 2], [3, 4]), 2) → 3
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-concat", "array_concat", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 1),
                        intLit("lit-002", 2),
                    ]),
                    arrayExpr("arr-002", [
                        intLit("lit-003", 3),
                        intLit("lit-004", 4),
                    ]),
                ]),
                intLit("lit-idx", 2),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(3);
    });
});

// =============================================================================
// array_slice
// =============================================================================

describe("array_slice builtin", () => {
    it("extracts a subarray", async () => {
        // array_length(array_slice([10, 20, 30, 40], 1, 3)) → 2
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-slice", "array_slice", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                        intLit("lit-003", 30),
                        intLit("lit-004", 40),
                    ]),
                    intLit("lit-start", 1),
                    intLit("lit-end", 3),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(2);
    });

    it("first element of slice is correct", async () => {
        // array_get(array_slice([10, 20, 30, 40], 1, 3), 0) → 20
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-slice", "array_slice", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                        intLit("lit-003", 30),
                        intLit("lit-004", 40),
                    ]),
                    intLit("lit-start", 1),
                    intLit("lit-end", 3),
                ]),
                intLit("lit-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(20);
    });

    it("clamps out-of-range indices", async () => {
        // array_length(array_slice([10, 20], 0, 100)) → 2 (clamped to length)
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-slice", "array_slice", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                    ]),
                    intLit("lit-start", 0),
                    intLit("lit-end", 100),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(2);
    });
});

// =============================================================================
// array_isEmpty
// =============================================================================

describe("array_isEmpty builtin", () => {
    it("returns 1 (true) for empty array", async () => {
        const ast = boolProgram([
            callExpr("call-001", "array_isEmpty", [
                arrayExpr("arr-001", []),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 (false) for non-empty array", async () => {
        const ast = boolProgram([
            callExpr("call-001", "array_isEmpty", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 42),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// array_contains
// =============================================================================

describe("array_contains builtin", () => {
    it("returns 1 (true) when element is present", async () => {
        const ast = boolProgram([
            callExpr("call-001", "array_contains", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 10),
                    intLit("lit-002", 20),
                    intLit("lit-003", 30),
                ]),
                intLit("lit-val", 20),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("returns 0 (false) when element is absent", async () => {
        const ast = boolProgram([
            callExpr("call-001", "array_contains", [
                arrayExpr("arr-001", [
                    intLit("lit-001", 10),
                    intLit("lit-002", 20),
                    intLit("lit-003", 30),
                ]),
                intLit("lit-val", 99),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// array_reverse
// =============================================================================

describe("array_reverse builtin", () => {
    it("reverses element order", async () => {
        // array_get(array_reverse([10, 20, 30]), 0) → 30
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-rev", "array_reverse", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 10),
                        intLit("lit-002", 20),
                        intLit("lit-003", 30),
                    ]),
                ]),
                intLit("lit-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(30);
    });

    it("single-element array is identity", async () => {
        // array_get(array_reverse([42]), 0) → 42
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-rev", "array_reverse", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 42),
                    ]),
                ]),
                intLit("lit-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(42);
    });

    it("empty array reverse returns empty", async () => {
        // array_length(array_reverse([])) → 0
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-rev", "array_reverse", [
                    arrayExpr("arr-001", []),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// Composition — chaining multiple array ops
// =============================================================================

describe("array builtin composition", () => {
    it("array_length(array_push(arr, x)) equals length + 1", async () => {
        const ast = intProgram([
            callExpr("call-len", "array_length", [
                callExpr("call-push", "array_push", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 1),
                        intLit("lit-002", 2),
                        intLit("lit-003", 3),
                    ]),
                    intLit("lit-val", 4),
                ]),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(4);
    });

    it("array_contains after array_push finds new element", async () => {
        // array_contains(array_push([1, 2], 99), 99) → true
        const ast = boolProgram([
            callExpr("call-contains", "array_contains", [
                callExpr("call-push", "array_push", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 1),
                        intLit("lit-002", 2),
                    ]),
                    intLit("lit-val", 99),
                ]),
                intLit("lit-search", 99),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(1);
    });

    it("reverse of concat equals concat of reverses in reverse order", async () => {
        // array_get(array_reverse(array_concat([1, 2], [3, 4])), 0) → 4
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-rev", "array_reverse", [
                    callExpr("call-concat", "array_concat", [
                        arrayExpr("arr-001", [
                            intLit("lit-001", 1),
                            intLit("lit-002", 2),
                        ]),
                        arrayExpr("arr-002", [
                            intLit("lit-003", 3),
                            intLit("lit-004", 4),
                        ]),
                    ]),
                ]),
                intLit("lit-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(4);
    });

    it("slice then reverse", async () => {
        // array_get(array_reverse(array_slice([10, 20, 30, 40], 1, 3)), 0) → 30
        const ast = intProgram([
            callExpr("call-get", "array_get", [
                callExpr("call-rev", "array_reverse", [
                    callExpr("call-slice", "array_slice", [
                        arrayExpr("arr-001", [
                            intLit("lit-001", 10),
                            intLit("lit-002", 20),
                            intLit("lit-003", 30),
                            intLit("lit-004", 40),
                        ]),
                        intLit("lit-start", 1),
                        intLit("lit-end", 3),
                    ]),
                ]),
                intLit("lit-idx", 0),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(30);
    });

    it("using let binding with array builtins", async () => {
        // let arr = array_push([1, 2, 3], 4)
        // array_get(arr, 3)  → 4
        const ast = intProgram([
            {
                kind: "let",
                id: "let-001",
                name: "arr",
                type: { kind: "array", element: { kind: "basic", name: "Int" } },
                value: callExpr("call-push", "array_push", [
                    arrayExpr("arr-001", [
                        intLit("lit-001", 1),
                        intLit("lit-002", 2),
                        intLit("lit-003", 3),
                    ]),
                    intLit("lit-val", 4),
                ]),
            },
            callExpr("call-get", "array_get", [
                { kind: "ident", id: "id-arr", name: "arr" },
                intLit("lit-idx", 3),
            ]),
        ]);
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(4);
    });
});
