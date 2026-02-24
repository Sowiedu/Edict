import { describe, it, expect } from "vitest";
import { resolve } from "../../src/resolver/resolve.js";
import type { EdictModule, Definition } from "../../src/ast/nodes.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

describe("resolver — additional coverage", () => {
    it("resolves type alias referencing another type", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }] } as Definition,
                { kind: "type", id: "t-1", name: "Pos", definition: { kind: "named", name: "Point" } } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves type alias referencing unknown type", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "type", id: "t-1", name: "Alias", definition: { kind: "named", name: "Nonexistent" } } as Definition,
            ],
        }));
        expect(errors.some(e => e.error === "undefined_reference")).toBe(true);
    });

    it("resolves record fields with named types", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Inner", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Int" } }] } as Definition,
                { kind: "record", id: "r-2", name: "Outer", fields: [{ kind: "field", id: "f-2", name: "inner", type: { kind: "named", name: "Inner" } }] } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves enum variant fields", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Payload", fields: [] } as Definition,
                {
                    kind: "enum", id: "e-1", name: "Msg",
                    variants: [{ kind: "variant", id: "v-1", name: "Data", fields: [{ kind: "field", id: "f-1", name: "payload", type: { kind: "named", name: "Payload" } }] }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves enum constructor expressions", () => {
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Color",
                    variants: [{ kind: "variant", id: "v-1", name: "Red", fields: [] }],
                } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Color" }, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Color", variant: "Red", fields: [],
                    }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves record_expr field values", () => {
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "record", id: "r-1", name: "Point",
                    fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Int" } }],
                } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Point" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Point",
                        fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1 } }],
                    }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves block expression", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "block", id: "b-1",
                    body: [{ kind: "literal", id: "l-1", value: 42 }],
                }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves tuple expression", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "tuple_expr", id: "t-1",
                    elements: [{ kind: "literal", id: "l-1", value: 1 }],
                }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves access expression", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "p", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "access", id: "a-1", target: { kind: "ident", id: "i-p", name: "p" }, field: "x" }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves unop expression", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Bool" } }],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{ kind: "unop", id: "u-1", op: "not", operand: { kind: "ident", id: "i-x", name: "x" } }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves types in fn_type param", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "f", type: { kind: "fn_type", params: [{ kind: "named", name: "Point" }], effects: [], returnType: { kind: "basic", name: "Int" } } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves types in array type expr", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "arr", type: { kind: "array", element: { kind: "named", name: "Point" } } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves types in option type expr", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "opt", type: { kind: "option", inner: { kind: "named", name: "Point" } } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves types in result type expr", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "r", type: { kind: "result", ok: { kind: "named", name: "Point" }, err: { kind: "basic", name: "String" } } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves types in tuple type expr", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "t", type: { kind: "tuple", elements: [{ kind: "named", name: "Point" }] } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                } as Definition,
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves const definitions", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "const", id: "c-1", name: "PI", type: { kind: "basic", name: "Float" },
                value: { kind: "literal", id: "l-1", value: 3.14 },
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves wildcard and literal patterns", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [
                        { kind: "arm", id: "a-1", pattern: { kind: "literal_pattern", value: 1 }, body: [{ kind: "literal", id: "l-1", value: 10 }] },
                        { kind: "arm", id: "a-2", pattern: { kind: "wildcard" }, body: [{ kind: "literal", id: "l-2", value: 0 }] },
                    ],
                }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves record fields with default values", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "record", id: "r-1", name: "Config",
                fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Int" }, defaultValue: { kind: "literal", id: "l-1", value: 0 } }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });
});
