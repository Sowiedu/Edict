import { describe, it, expect } from "vitest";
import { typeCheck } from "../../src/checker/check.js";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { run } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef } from "../../src/ast/nodes.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

describe("return type inference", () => {
    it("infers Int return type from body", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "answer",
                params: [], effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "l-1", value: 42 }],
            } as FunctionDef],
        }));
        expect(errors).toEqual([]);
    });

    it("infers String return type from body", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "greet",
                params: [], effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "l-1", value: "hello" }],
            } as FunctionDef],
        }));
        expect(errors).toEqual([]);
    });

    it("infers Float return type from body", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "pi",
                params: [], effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "l-1", value: 3.14 }],
            } as FunctionDef],
        }));
        expect(errors).toEqual([]);
    });

    it("infers Bool return type from comparison", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "isPositive",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: ">",
                    left: { kind: "ident", id: "i-x", name: "x" },
                    right: { kind: "literal", id: "l-0", value: 0 },
                }],
            } as FunctionDef],
        }));
        expect(errors).toEqual([]);
    });

    it("infers return type from arithmetic expression", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "double",
                params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "*",
                    left: { kind: "ident", id: "i-n", name: "n" },
                    right: { kind: "literal", id: "l-2", value: 2 },
                }],
            } as FunctionDef],
        }));
        expect(errors).toEqual([]);
    });

    it("stores inferred returnType in typeInfo side-table (no AST mutation)", () => {
        const module = mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "answer",
                params: [], effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "l-1", value: 42 }],
            } as FunctionDef],
        });
        const { errors, typeInfo } = typeCheck(module);
        expect(errors).toEqual([]);
        const fn = module.definitions[0] as FunctionDef;
        // AST should NOT be mutated
        expect(fn.returnType).toBeUndefined();
        // Inferred type should be in the side-table
        expect(typeInfo.inferredReturnTypes.get("fn-1")).toEqual({ kind: "basic", name: "Int" });
    });

    it("explicit returnType still works (backward compat)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "add",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("explicit returnType mismatch still errors", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "literal", id: "l-1", value: "not an int" }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("inferred function can be called by other functions", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "double",
                    params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"], contracts: [],
                    body: [{
                        kind: "binop", id: "e-1", op: "*",
                        left: { kind: "ident", id: "i-n", name: "n" },
                        right: { kind: "literal", id: "l-2", value: 2 },
                    }],
                } as FunctionDef,
                {
                    kind: "fn", id: "fn-2", name: "main",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-d", name: "double" },
                        args: [{ kind: "literal", id: "l-5", value: 5 }],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });
});

describe("return type inference — postconditions", () => {
    it("inferred return type works with postcondition using result", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "abs",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"],
                contracts: [{
                    kind: "post", id: "post-1",
                    condition: {
                        kind: "binop", id: "e-cond", op: ">=",
                        left: { kind: "ident", id: "i-result", name: "result" },
                        right: { kind: "literal", id: "l-0", value: 0 },
                    },
                }],
                body: [{
                    kind: "if", id: "if-1",
                    condition: {
                        kind: "binop", id: "e-gt", op: ">=",
                        left: { kind: "ident", id: "i-x", name: "x" },
                        right: { kind: "literal", id: "l-z", value: 0 },
                    },
                    then: [{ kind: "ident", id: "i-x2", name: "x" }],
                    else: [{
                        kind: "binop", id: "e-neg", op: "*",
                        left: { kind: "literal", id: "l-neg", value: -1 },
                        right: { kind: "ident", id: "i-x3", name: "x" },
                    }],
                }],
            } as FunctionDef],
        }));
        expect(errors).toEqual([]);
    });
});

describe("return type inference — full pipeline", () => {
    it("validate → check passes with omitted returnType", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [{
                kind: "fn", id: "fn-1", name: "main",
                params: [], effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "l-1", value: 42 }],
            } as FunctionDef],
        });
        expect(result).toMatchObject({ ok: true });
    });

    it("validate → check → compile → run with omitted returnType", async () => {
        const module: EdictModule = {
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [{
                kind: "fn", id: "fn-1", name: "main",
                params: [], effects: ["pure"], contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "literal", id: "l-a", value: 20 },
                    right: { kind: "literal", id: "l-b", value: 22 },
                }],
            } as FunctionDef],
        };

        const checkResult = await check(module);
        expect(checkResult).toMatchObject({ ok: true });

        const compileResult = compile(module, { typeInfo: checkResult.typeInfo });
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await run(compileResult.wasm);
        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(42);
    });
});
