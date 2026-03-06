import { describe, it, expect } from "vitest";
import { typeCheck } from "../../src/checker/check.js";
import type { EdictModule, Expression, Param } from "../../src/ast/nodes.js";
import type { TypeExpr } from "../../src/ast/types.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

// Helper: create a function that takes a callback param and calls it with a lambda
function hofModule(
    hofParamType: TypeExpr,
    hofReturnType: TypeExpr,
    lambdaParams: Param[],
    lambdaBody: Expression[],
): EdictModule {
    return mod({
        definitions: [
            // A higher-order function: apply(f: fn_type, x: Int) → ReturnType
            {
                kind: "fn", id: "fn-apply", name: "apply",
                params: [
                    { kind: "param", id: "p-f", name: "f", type: hofParamType },
                    { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
                ],
                effects: ["pure"],
                returnType: hofReturnType,
                contracts: [],
                body: [{
                    kind: "call", id: "call-f",
                    fn: { kind: "ident", id: "i-f", name: "f" },
                    args: [{ kind: "ident", id: "i-x", name: "x" }],
                }],
            },
            // Caller: test() calls apply with a lambda
            {
                kind: "fn", id: "fn-test", name: "test",
                params: [],
                effects: ["pure"],
                returnType: hofReturnType,
                contracts: [],
                body: [{
                    kind: "call", id: "call-apply",
                    fn: { kind: "ident", id: "i-apply", name: "apply" },
                    args: [
                        {
                            kind: "lambda", id: "lam-1",
                            params: lambdaParams,
                            body: lambdaBody,
                        },
                        { kind: "literal", id: "lit-arg", value: 42 },
                    ],
                }],
            },
        ],
    });
}

describe("lambda param type inference", () => {
    it("infers single lambda param type from HOF call site", () => {
        // apply expects fn(Int) → Int, lambda omits type on param
        const program = hofModule(
            {
                kind: "fn_type",
                params: [{ kind: "basic", name: "Int" }],
                effects: [],
                returnType: { kind: "basic", name: "Int" },
            },
            { kind: "basic", name: "Int" },
            // Lambda param WITHOUT type annotation
            [{ kind: "param", id: "p-n", name: "n" }],
            // Body: n + 1
            [{
                kind: "binop", id: "bin-1", op: "+",
                left: { kind: "ident", id: "i-n", name: "n" },
                right: { kind: "literal", id: "lit-1", value: 1 },
            }],
        );

        const { errors } = typeCheck(program);
        expect(errors).toEqual([]);
    });

    it("infers multi-param lambda types from HOF call site", () => {
        // A HOF that takes fn(Int, String) → Bool
        const program = mod({
            definitions: [
                {
                    kind: "fn", id: "fn-hof", name: "check",
                    params: [
                        {
                            kind: "param", id: "p-f", name: "f",
                            type: {
                                kind: "fn_type",
                                params: [
                                    { kind: "basic", name: "Int" },
                                    { kind: "basic", name: "String" },
                                ],
                                effects: [],
                                returnType: { kind: "basic", name: "Bool" },
                            },
                        },
                    ],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Bool" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "call-f",
                        fn: { kind: "ident", id: "i-f", name: "f" },
                        args: [
                            { kind: "literal", id: "lit-1", value: 1 },
                            { kind: "literal", id: "lit-2", value: "hi" },
                        ],
                    }],
                },
                {
                    kind: "fn", id: "fn-test", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Bool" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "call-check",
                        fn: { kind: "ident", id: "i-check", name: "check" },
                        args: [{
                            kind: "lambda", id: "lam-1",
                            // Both params omit type
                            params: [
                                { kind: "param", id: "p-a", name: "a" },
                                { kind: "param", id: "p-b", name: "b" },
                            ],
                            body: [{ kind: "literal", id: "lit-ret", value: true }],
                        }],
                    }],
                },
            ],
        });

        const { errors } = typeCheck(program);
        expect(errors).toEqual([]);
    });

    it("partial annotation: one param typed, one inferred", () => {
        const program = mod({
            definitions: [
                {
                    kind: "fn", id: "fn-hof", name: "combine",
                    params: [
                        {
                            kind: "param", id: "p-f", name: "f",
                            type: {
                                kind: "fn_type",
                                params: [
                                    { kind: "basic", name: "Int" },
                                    { kind: "basic", name: "String" },
                                ],
                                effects: [],
                                returnType: { kind: "basic", name: "Int" },
                            },
                        },
                    ],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "call-f",
                        fn: { kind: "ident", id: "i-f", name: "f" },
                        args: [
                            { kind: "literal", id: "lit-1", value: 1 },
                            { kind: "literal", id: "lit-2", value: "hi" },
                        ],
                    }],
                },
                {
                    kind: "fn", id: "fn-test", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call", id: "call-combine",
                        fn: { kind: "ident", id: "i-combine", name: "combine" },
                        args: [{
                            kind: "lambda", id: "lam-1",
                            params: [
                                // First param explicitly typed
                                { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                                // Second param inferred
                                { kind: "param", id: "p-b", name: "b" },
                            ],
                            body: [{ kind: "ident", id: "i-a", name: "a" }],
                        }],
                    }],
                },
            ],
        });

        const { errors } = typeCheck(program);
        expect(errors).toEqual([]);
    });

    it("lambda with explicit types still works (regression)", () => {
        const program = hofModule(
            {
                kind: "fn_type",
                params: [{ kind: "basic", name: "Int" }],
                effects: [],
                returnType: { kind: "basic", name: "Int" },
            },
            { kind: "basic", name: "Int" },
            // Lambda with EXPLICIT type
            [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
            [{ kind: "ident", id: "i-n", name: "n" }],
        );

        const { errors } = typeCheck(program);
        expect(errors).toEqual([]);
    });

    it("lambda outside call context with missing types uses unknown", () => {
        // Lambda not passed to a function — just returned directly
        const program = mod({
            definitions: [{
                kind: "fn", id: "fn-test", name: "test",
                params: [],
                effects: ["pure"],
                returnType: {
                    kind: "fn_type",
                    params: [{ kind: "named", name: "unknown" }],
                    effects: [],
                    returnType: { kind: "named", name: "unknown" },
                },
                contracts: [],
                body: [{
                    kind: "lambda", id: "lam-1",
                    params: [{ kind: "param", id: "p-x", name: "x" }],
                    body: [{ kind: "ident", id: "i-x", name: "x" }],
                }],
            }],
        });

        // Should not crash — param type treated as unknown
        const { errors } = typeCheck(program);
        expect(errors).toEqual([]);
    });

    it("stores inferred lambda param types in typeInfo side-table (no AST mutation)", () => {
        const lambdaParam: Param = { kind: "param", id: "p-n", name: "n" };
        const program = hofModule(
            {
                kind: "fn_type",
                params: [{ kind: "basic", name: "Int" }],
                effects: [],
                returnType: { kind: "basic", name: "Int" },
            },
            { kind: "basic", name: "Int" },
            [lambdaParam],
            [{ kind: "ident", id: "i-n", name: "n" }],
        );

        const { errors, typeInfo } = typeCheck(program);
        expect(errors).toEqual([]);
        // AST should NOT be mutated
        expect(lambdaParam.type).toBeUndefined();
        // Inferred type should be in the side-table
        expect(typeInfo.inferredLambdaParamTypes.get("p-n")).toEqual({ kind: "basic", name: "Int" });
    });

    it("detects type mismatch when inferred lambda body conflicts", () => {
        // HOF expects fn(Int) → Int, but lambda body returns String
        const program = hofModule(
            {
                kind: "fn_type",
                params: [{ kind: "basic", name: "Int" }],
                effects: [],
                returnType: { kind: "basic", name: "Int" },
            },
            { kind: "basic", name: "Int" },
            [{ kind: "param", id: "p-n", name: "n" }],
            // Body returns String instead of Int
            [{ kind: "literal", id: "lit-str", value: "oops" }],
        );

        const { errors } = typeCheck(program);
        // Should detect type mismatch: fn returns String but expected Int
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });
});
