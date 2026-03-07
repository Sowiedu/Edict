
import { describe, it, expect } from "vitest";
import { typeCheck } from "../../src/checker/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { run } from "../../src/codegen/runner.js";
import { EdictModule } from "../../src/ast/nodes.js";
import * as fs from "node:fs";

describe("Tuple Access", () => {
    it("should allow accessing tuple fields", async () => {
        const mod: EdictModule = {
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

        const checkResult = typeCheck(mod);
        expect(checkResult.errors).toHaveLength(0);

        const compileResult = compile(mod);
        if (!compileResult.ok) {
            throw new Error(`Compilation failed: ${JSON.stringify(compileResult.errors, null, 2)}`);
        }
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const result = await run(compileResult.wasm);
        expect(result.returnValue).toBe(42);
    });
    // Skipped due to Issue #95: String lengths are lost when stored in data structures
    // because they are not length-prefixed on the heap.
    it.skip("should allow accessing string fields in tuples", async () => {
        const mod: EdictModule = {
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

        const compileResult = compile(mod, { emitWat: true });
        if (!compileResult.ok) {
            throw new Error(`Compilation failed: ${JSON.stringify(compileResult.errors, null, 2)}`);
        }
        fs.writeFileSync("/tmp/debug.wat", compileResult.wat || "");

        const result = await run(compileResult.wasm);
        expect(result.output).toBe("hello");
    });
});
