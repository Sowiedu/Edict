import { describe, it, expect } from "vitest";
import { typeCheck } from "../../src/checker/check.js";
import type { EdictModule } from "../../src/ast/nodes.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

describe("type checker — valid programs", () => {
    it("accepts Int arithmetic", () => {
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

    it("accepts Float arithmetic", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Float" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "*",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "literal", id: "l-1", value: 2.5 },
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts Bool logic", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Bool" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Bool" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "and",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts comparison → Bool", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: ">",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "literal", id: "l-1", value: 0 },
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts if with matching then/else", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "if", id: "if-1",
                    condition: { kind: "binop", id: "e-1", op: ">", left: { kind: "ident", id: "i-x", name: "x" }, right: { kind: "literal", id: "l-0", value: 0 } },
                    then: [{ kind: "ident", id: "i-x2", name: "x" }],
                    else: [{ kind: "literal", id: "l-1", value: 0 }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts if without else → Option<T>", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "option", inner: { kind: "basic", name: "Int" } }, contracts: [],
                body: [{
                    kind: "if", id: "if-1",
                    condition: { kind: "binop", id: "e-1", op: ">", left: { kind: "ident", id: "i-x", name: "x" }, right: { kind: "literal", id: "l-0", value: 0 } },
                    then: [{ kind: "ident", id: "i-x2", name: "x" }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts let with matching type annotation", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [
                    { kind: "let", id: "let-1", name: "x", type: { kind: "basic", name: "Int" }, value: { kind: "literal", id: "l-1", value: 5 } },
                    { kind: "ident", id: "i-x", name: "x" },
                ],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts let with inferred type", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [
                    { kind: "let", id: "let-1", name: "x", value: { kind: "literal", id: "l-1", value: 5 } },
                    { kind: "ident", id: "i-x", name: "x" },
                ],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts function call with correct types", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "double",
                    params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "binop", id: "e-1", op: "*", left: { kind: "ident", id: "i-n", name: "n" }, right: { kind: "literal", id: "l-2", value: 2 } }],
                },
                {
                    kind: "fn", id: "fn-2", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "call", id: "c-1", fn: { kind: "ident", id: "i-d", name: "double" }, args: [{ kind: "literal", id: "l-1", value: 5 }] }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts record field access", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }, { kind: "field", id: "f-2", name: "y", type: { kind: "basic", name: "Float" } }] },
                {
                    kind: "fn", id: "fn-1", name: "getX",
                    params: [{ kind: "param", id: "p-1", name: "p", type: { kind: "named", name: "Point" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{ kind: "access", id: "acc-1", target: { kind: "ident", id: "i-p", name: "p" }, field: "x" }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts record_expr with correct fields", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }, { kind: "field", id: "f-2", name: "y", type: { kind: "basic", name: "Float" } }] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Point" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Point",
                        fields: [
                            { kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1.5 } },
                            { kind: "field_init", name: "y", value: { kind: "literal", id: "l-2", value: 2.5 } },
                        ],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts record_expr with optional defaults omitted", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "record", id: "r-1", name: "Config",
                    fields: [
                        { kind: "field", id: "f-1", name: "name", type: { kind: "basic", name: "String" } },
                        { kind: "field", id: "f-2", name: "timeout", type: { kind: "basic", name: "Int" }, defaultValue: { kind: "literal", id: "l-d", value: 30 } },
                    ],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Config" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Config",
                        fields: [{ kind: "field_init", name: "name", value: { kind: "literal", id: "l-1", value: "test" } }],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts enum constructor", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Shape",
                    variants: [
                        { kind: "variant", id: "v-1", name: "Circle", fields: [{ kind: "field", id: "f-1", name: "radius", type: { kind: "basic", name: "Float" } }] },
                    ],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Shape" }, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Shape", variant: "Circle",
                        fields: [{ kind: "field_init", name: "radius", value: { kind: "literal", id: "l-1", value: 5.5 } }],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts array of uniform type", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "array", element: { kind: "basic", name: "Int" } }, contracts: [],
                body: [{ kind: "array", id: "arr-1", elements: [{ kind: "literal", id: "l-1", value: 1 }, { kind: "literal", id: "l-2", value: 2 }] }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts unit type arithmetic", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "unit_type", base: "Float", unit: "usd" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "unit_type", base: "Float", unit: "usd" } },
                ],
                effects: ["pure"], returnType: { kind: "unit_type", base: "Float", unit: "usd" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("accepts string concatenation with +", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "String" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "String" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "String" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });
});

describe("type checker — invalid programs", () => {
    it("rejects Int + String", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "String" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects Int + Float", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Float" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects non-Bool if condition", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "if", id: "if-1",
                    condition: { kind: "literal", id: "l-1", value: 42 },
                    then: [{ kind: "literal", id: "l-2", value: 1 }],
                    else: [{ kind: "literal", id: "l-3", value: 0 }],
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects if branch type mismatch", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "if", id: "if-1",
                    condition: { kind: "literal", id: "l-c", value: true },
                    then: [{ kind: "literal", id: "l-1", value: 1 }],
                    else: [{ kind: "literal", id: "l-2", value: "nope" }],
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects wrong arg types", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "inc",
                    params: [{ kind: "param", id: "p-1", name: "n", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "binop", id: "e-1", op: "+", left: { kind: "ident", id: "i-n", name: "n" }, right: { kind: "literal", id: "l-1", value: 1 } }],
                },
                {
                    kind: "fn", id: "fn-2", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "call", id: "c-1", fn: { kind: "ident", id: "i-inc", name: "inc" }, args: [{ kind: "literal", id: "l-s", value: "oops" }] }],
                },
            ],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects wrong arity", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "add",
                    params: [
                        { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                        { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                    ],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "binop", id: "e-1", op: "+", left: { kind: "ident", id: "i-a", name: "a" }, right: { kind: "ident", id: "i-b", name: "b" } }],
                },
                {
                    kind: "fn", id: "fn-2", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "call", id: "c-1", fn: { kind: "ident", id: "i-add", name: "add" }, args: [{ kind: "literal", id: "l-1", value: 1 }] }],
                },
            ],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "arity_mismatch", expected: 2, actual: 1 });
    });

    it("rejects call on non-function", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-x", name: "x" },
                    args: [],
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "not_a_function")).toBe(true);
    });

    it("rejects access on non-record", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "access", id: "acc-1", target: { kind: "ident", id: "i-x", name: "x" }, field: "foo" }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects unknown field access", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "p", type: { kind: "named", name: "Point" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{ kind: "access", id: "acc-1", target: { kind: "ident", id: "i-p", name: "p" }, field: "z" }],
                },
            ],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "unknown_field")).toBe(true);
    });

    it("rejects mixing unit types", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "unit_type", base: "Float", unit: "usd" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "unit_type", base: "Float", unit: "eur" } },
                ],
                effects: ["pure"], returnType: { kind: "unit_type", base: "Float", unit: "usd" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("rejects return type mismatch", () => {
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

    it("rejects unknown record in record_expr", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "record_expr", id: "re-1", name: "NonExistent",
                    fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1 } }],
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "unknown_record")).toBe(true);
    });

    it("rejects literal pattern type mismatch", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [
                        {
                            kind: "arm", id: "a-1",
                            pattern: { kind: "literal_pattern", value: "hello" },
                            body: [{ kind: "literal", id: "l-t", value: true }],
                        },
                        {
                            kind: "arm", id: "a-2",
                            pattern: { kind: "wildcard" },
                            body: [{ kind: "literal", id: "l-f", value: false }],
                        },
                    ],
                }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });
});

describe("type checker — unknown propagation", () => {
    it("does not error when imported (unknown) function is called", () => {
        const { errors } = typeCheck(mod({
            imports: [{ kind: "import", id: "imp-1", module: "std", names: ["print"] }],
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["io"],
                returnType: { kind: "basic", name: "String" }, contracts: [],
                body: [{
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-p", name: "print" },
                    args: [{ kind: "literal", id: "l-1", value: "hello" }],
                }],
            }],
        }));
        // No type errors — importing triggers unknown propagation
        expect(errors).toEqual([]);
    });
});
