
import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { run, runDirect } from "../../src/codegen/runner.js";
import { EdictModule } from "../../src/ast/nodes.js";

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

describe("Tuple Access", () => {
    it("should allow accessing tuple fields", async () => {
        const ast = {
            kind: "module",
            id: "tup-test",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "let",
                            id: "l-1",
                            name: "t",
                            type: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
                            value: {
                                kind: "tuple_expr",
                                id: "te-1",
                                elements: [
                                    { kind: "literal", id: "lit-1", value: 42 },
                                    { kind: "literal", id: "lit-2", value: "hello" }
                                ]
                            }
                        },
                        {
                            kind: "access",
                            id: "acc-1",
                            target: { kind: "ident", id: "id-1", name: "t" },
                            field: "0"
                        }
                    ]
                }
            ]
        };

        const result = await compileAndRun(ast);
        expect(result.returnValue).toBe(42);
    });

    it("should allow accessing string fields in tuples", async () => {
        const ast = {
            kind: "module",
            id: "tup-test-string",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main",
                    name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "let",
                            id: "l-1",
                            name: "t",
                            type: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
                            value: {
                                kind: "tuple_expr",
                                id: "te-1",
                                elements: [
                                    { kind: "literal", id: "lit-1", value: 42 },
                                    { kind: "literal", id: "lit-2", value: "hello" }
                                ]
                            }
                        },
                        {
                            kind: "call",
                            id: "c-1",
                            fn: { kind: "ident", id: "id-1", name: "print" },
                            args: [
                                {
                                    kind: "access",
                                    id: "acc-1",
                                    target: { kind: "ident", id: "id-2", name: "t" },
                                    field: "1"
                                }
                            ]
                        },
                        { kind: "literal", id: "lit-3", value: 0 }
                    ]
                }
            ]
        };

        const result = await compileAndRun(ast);
        expect(result.output).toBe("hello");
    });
});
