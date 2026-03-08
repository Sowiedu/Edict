// =============================================================================
// String in Data Structures — Tests for string length preservation in tuples,
// records, and enum variants
// =============================================================================
// Verifies that String values stored in heap-allocated data structures retain
// their length. Before this fix, only the pointer was stored — the length
// was lost, causing string operations to produce empty/corrupted results.

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
// Tuples
// =============================================================================

describe("String in tuples", () => {
    it("string_length on string from tuple returns correct length", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-main", name: "main",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    {
                        kind: "let", id: "l-1", name: "t",
                        type: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
                        value: {
                            kind: "tuple_expr", id: "te-1",
                            elements: [
                                { kind: "literal", id: "lit-1", value: 10 },
                                { kind: "literal", id: "lit-2", value: "hello" },
                            ],
                        },
                    },
                    {
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-1", name: "string_length" },
                        args: [{
                            kind: "access", id: "acc-1",
                            target: { kind: "ident", id: "id-t", name: "t" },
                            field: "1",
                        }],
                    },
                ],
            }],
        };
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(5);
    });

    it("concat string from tuple with another string", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-main", name: "main",
                params: [], effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    {
                        kind: "let", id: "l-1", name: "t",
                        type: { kind: "tuple", elements: [{ kind: "basic", name: "String" }, { kind: "basic", name: "Int" }] },
                        value: {
                            kind: "tuple_expr", id: "te-1",
                            elements: [
                                { kind: "literal", id: "lit-1", value: "hello" },
                                { kind: "literal", id: "lit-2", value: 42 },
                            ],
                        },
                    },
                    {
                        kind: "call", id: "c-print",
                        fn: { kind: "ident", id: "i-print", name: "print" },
                        args: [{
                            kind: "call", id: "c-concat",
                            fn: { kind: "ident", id: "i-concat", name: "string_concat" },
                            args: [
                                {
                                    kind: "access", id: "acc-1",
                                    target: { kind: "ident", id: "id-t", name: "t" },
                                    field: "0",
                                },
                                { kind: "literal", id: "lit-world", value: " world" },
                            ],
                        }],
                    },
                    { kind: "literal", id: "lit-ret", value: 0 },
                ],
            }],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello world");
    });

    it("tuple with multiple string fields preserves all lengths", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-main", name: "main",
                params: [], effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    {
                        kind: "let", id: "l-1", name: "t",
                        type: { kind: "tuple", elements: [{ kind: "basic", name: "String" }, { kind: "basic", name: "String" }] },
                        value: {
                            kind: "tuple_expr", id: "te-1",
                            elements: [
                                { kind: "literal", id: "lit-1", value: "AB" },
                                { kind: "literal", id: "lit-2", value: "CD" },
                            ],
                        },
                    },
                    {
                        kind: "call", id: "c-print",
                        fn: { kind: "ident", id: "i-print", name: "print" },
                        args: [{
                            kind: "call", id: "c-concat",
                            fn: { kind: "ident", id: "i-concat", name: "string_concat" },
                            args: [
                                {
                                    kind: "access", id: "acc-0",
                                    target: { kind: "ident", id: "id-t1", name: "t" },
                                    field: "0",
                                },
                                {
                                    kind: "access", id: "acc-1",
                                    target: { kind: "ident", id: "id-t2", name: "t" },
                                    field: "1",
                                },
                            ],
                        }],
                    },
                    { kind: "literal", id: "lit-ret", value: 0 },
                ],
            }],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("ABCD");
    });
});

// =============================================================================
// Records
// =============================================================================

describe("String in records", () => {
    it("print string field from record", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "record", id: "rec-user", name: "User",
                    fields: [
                        { kind: "field", id: "f-name", name: "name", type: { kind: "basic", name: "String" } },
                        { kind: "field", id: "f-age", name: "age", type: { kind: "basic", name: "Int" } },
                    ],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [], effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "let", id: "l-1", name: "u",
                            type: { kind: "named", name: "User" },
                            value: {
                                kind: "record_expr", id: "re-1", name: "User",
                                fields: [
                                    { kind: "field_init", name: "name", value: { kind: "literal", id: "lit-name", value: "Alice" } },
                                    { kind: "field_init", name: "age", value: { kind: "literal", id: "lit-age", value: 30 } },
                                ],
                            },
                        },
                        {
                            kind: "call", id: "c-print",
                            fn: { kind: "ident", id: "i-print", name: "print" },
                            args: [{
                                kind: "access", id: "acc-1",
                                target: { kind: "ident", id: "id-u", name: "u" },
                                field: "name",
                            }],
                        },
                        { kind: "literal", id: "lit-ret", value: 0 },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.output).toBe("Alice");
    });

    it("string_length on string field from record", async () => {
        const ast = {
            kind: "module", id: "mod-1", name: "test", imports: [],
            definitions: [
                {
                    kind: "record", id: "rec-item", name: "Item",
                    fields: [
                        { kind: "field", id: "f-label", name: "label", type: { kind: "basic", name: "String" } },
                    ],
                },
                {
                    kind: "fn", id: "fn-main", name: "main",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "let", id: "l-1", name: "item",
                            type: { kind: "named", name: "Item" },
                            value: {
                                kind: "record_expr", id: "re-1", name: "Item",
                                fields: [
                                    { kind: "field_init", name: "label", value: { kind: "literal", id: "lit-lbl", value: "testing" } },
                                ],
                            },
                        },
                        {
                            kind: "call", id: "c-1",
                            fn: { kind: "ident", id: "i-1", name: "string_length" },
                            args: [{
                                kind: "access", id: "acc-1",
                                target: { kind: "ident", id: "id-item", name: "item" },
                                field: "label",
                            }],
                        },
                    ],
                },
            ],
        };
        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(7); // "testing".length
    });
});
