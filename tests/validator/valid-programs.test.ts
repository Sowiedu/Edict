import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";

/**
 * Tests that structurally valid ASTs pass validation.
 */
describe("valid programs", () => {
    it("accepts a minimal module", () => {
        const result = validate({
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a module with a simple function", () => {
        const result = validate({
            kind: "module",
            id: "mod-002",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-001",
                    name: "add",
                    params: [
                        {
                            kind: "param",
                            id: "p-001",
                            name: "a",
                            type: { kind: "basic", name: "Int" },
                        },
                        {
                            kind: "param",
                            id: "p-002",
                            name: "b",
                            type: { kind: "basic", name: "Int" },
                        },
                    ],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "binop",
                            id: "expr-001",
                            op: "+",
                            left: { kind: "ident", id: "id-a", name: "a" },
                            right: { kind: "ident", id: "id-b", name: "b" },
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a module with imports", () => {
        const result = validate({
            kind: "module",
            id: "mod-003",
            name: "test",
            imports: [
                { kind: "import", id: "imp-001", module: "math", names: ["sqrt"] },
            ],
            definitions: [],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a function with contracts", () => {
        const result = validate({
            kind: "module",
            id: "mod-004",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-002",
                    name: "abs",
                    params: [
                        {
                            kind: "param",
                            id: "p-003",
                            name: "x",
                            type: { kind: "basic", name: "Int" },
                        },
                    ],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [
                        {
                            kind: "post",
                            id: "post-001",
                            condition: {
                                kind: "binop",
                                id: "expr-post-001",
                                op: ">=",
                                left: {
                                    kind: "ident",
                                    id: "id-result",
                                    name: "result",
                                },
                                right: { kind: "literal", id: "lit-zero", value: 0 },
                            },
                        },
                    ],
                    body: [
                        {
                            kind: "if",
                            id: "if-001",
                            condition: {
                                kind: "binop",
                                id: "expr-gt",
                                op: ">=",
                                left: { kind: "ident", id: "id-x", name: "x" },
                                right: { kind: "literal", id: "lit-zero-2", value: 0 },
                            },
                            then: [{ kind: "ident", id: "id-x2", name: "x" }],
                            else: [
                                {
                                    kind: "unop",
                                    id: "unop-neg",
                                    op: "-",
                                    operand: { kind: "ident", id: "id-x3", name: "x" },
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a record definition", () => {
        const result = validate({
            kind: "module",
            id: "mod-005",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "record",
                    id: "rec-001",
                    name: "Point",
                    fields: [
                        {
                            kind: "field",
                            id: "f-001",
                            name: "x",
                            type: { kind: "basic", name: "Float" },
                        },
                        {
                            kind: "field",
                            id: "f-002",
                            name: "y",
                            type: { kind: "basic", name: "Float" },
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts an enum definition", () => {
        const result = validate({
            kind: "module",
            id: "mod-006",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "enum",
                    id: "enum-001",
                    name: "Option",
                    variants: [
                        { kind: "variant", id: "v-001", name: "None", fields: [] },
                        {
                            kind: "variant",
                            id: "v-002",
                            name: "Some",
                            fields: [
                                {
                                    kind: "field",
                                    id: "f-val-001",
                                    name: "value",
                                    type: { kind: "basic", name: "Int" },
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a const definition", () => {
        const result = validate({
            kind: "module",
            id: "mod-007",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "const",
                    id: "const-001",
                    name: "PI",
                    type: { kind: "basic", name: "Float" },
                    value: { kind: "literal", id: "lit-pi", value: 3.14159 },
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a type alias", () => {
        const result = validate({
            kind: "module",
            id: "mod-008",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "type",
                    id: "type-001",
                    name: "Money",
                    definition: { kind: "unit_type", base: "Float", unit: "usd" },
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts all expression kinds", () => {
        const result = validate({
            kind: "module",
            id: "mod-009",
            name: "allExprs",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-all-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        { kind: "literal", id: "lit-001", value: 42 },
                        { kind: "literal", id: "lit-str-001", value: "hello" },
                        { kind: "literal", id: "lit-bool-001", value: true },
                        {
                            kind: "array",
                            id: "arr-001",
                            elements: [
                                { kind: "literal", id: "lit-arr-001", value: 1 },
                            ],
                        },
                        {
                            kind: "tuple_expr",
                            id: "tup-001",
                            elements: [
                                { kind: "literal", id: "lit-tup-001", value: 1 },
                                { kind: "literal", id: "lit-tup-002", value: "a" },
                            ],
                        },
                        {
                            kind: "record_expr",
                            id: "rec-expr-001",
                            name: "Point",
                            fields: [
                                {
                                    kind: "field_init",
                                    name: "x",
                                    value: { kind: "literal", id: "lit-rx-001", value: 1.0 },
                                },
                            ],
                        },
                        {
                            kind: "enum_constructor",
                            id: "econst-001",
                            enumName: "Option",
                            variant: "Some",
                            fields: [
                                {
                                    kind: "field_init",
                                    name: "value",
                                    value: { kind: "literal", id: "lit-ec-001", value: 42 },
                                },
                            ],
                        },
                        {
                            kind: "access",
                            id: "acc-001",
                            target: { kind: "ident", id: "id-acc-001", name: "p" },
                            field: "x",
                        },
                        {
                            kind: "block",
                            id: "blk-001",
                            body: [{ kind: "literal", id: "lit-blk-001", value: 1 }],
                        },
                        {
                            kind: "lambda",
                            id: "lam-001",
                            params: [
                                {
                                    kind: "param",
                                    id: "p-lam-001",
                                    name: "x",
                                    type: { kind: "basic", name: "Int" },
                                },
                            ],
                            body: [{ kind: "ident", id: "id-lam-001", name: "x" }],
                        },
                        {
                            kind: "call",
                            id: "call-001",
                            fn: { kind: "ident", id: "id-foo-001", name: "foo" },
                            args: [{ kind: "literal", id: "lit-call-001", value: 1 }],
                        },
                        {
                            kind: "match",
                            id: "match-001",
                            target: { kind: "literal", id: "lit-m-tgt", value: 1 },
                            arms: [
                                {
                                    kind: "arm",
                                    id: "arm-001",
                                    pattern: { kind: "literal_pattern", value: 1 },
                                    body: [{ kind: "literal", id: "lit-m-001", value: true }],
                                },
                                {
                                    kind: "arm",
                                    id: "arm-002",
                                    pattern: { kind: "wildcard" },
                                    body: [{ kind: "literal", id: "lit-m-002", value: false }],
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts all type expression kinds", () => {
        const result = validate({
            kind: "module",
            id: "mod-010",
            name: "allTypes",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-types-001",
                    name: "test",
                    params: [
                        {
                            kind: "param",
                            id: "p-basic",
                            name: "a",
                            type: { kind: "basic", name: "Int" },
                        },
                        {
                            kind: "param",
                            id: "p-arr",
                            name: "b",
                            type: {
                                kind: "array",
                                element: { kind: "basic", name: "String" },
                            },
                        },
                        {
                            kind: "param",
                            id: "p-opt",
                            name: "c",
                            type: { kind: "option", inner: { kind: "basic", name: "Bool" } },
                        },
                        {
                            kind: "param",
                            id: "p-res",
                            name: "d",
                            type: {
                                kind: "result",
                                ok: { kind: "basic", name: "Int" },
                                err: { kind: "basic", name: "String" },
                            },
                        },
                        {
                            kind: "param",
                            id: "p-named",
                            name: "e",
                            type: { kind: "named", name: "Point" },
                        },
                        {
                            kind: "param",
                            id: "p-tuple",
                            name: "f",
                            type: {
                                kind: "tuple",
                                elements: [
                                    { kind: "basic", name: "Int" },
                                    { kind: "basic", name: "String" },
                                ],
                            },
                        },
                        {
                            kind: "param",
                            id: "p-fn",
                            name: "g",
                            type: {
                                kind: "fn_type",
                                params: [{ kind: "basic", name: "Int" }],
                                effects: ["pure"],
                                returnType: { kind: "basic", name: "Int" },
                            },
                        },
                    ],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-ret-001", value: 0 }],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a record field with a default value", () => {
        const result = validate({
            kind: "module",
            id: "mod-011",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "record",
                    id: "rec-def-001",
                    name: "Config",
                    fields: [
                        {
                            kind: "field",
                            id: "f-def-001",
                            name: "timeout",
                            type: { kind: "basic", name: "Int" },
                            defaultValue: { kind: "literal", id: "lit-def-001", value: 30 },
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a let expression with optional type annotation", () => {
        const result = validate({
            kind: "module",
            id: "mod-012",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-let-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "let",
                            id: "let-001",
                            name: "x",
                            type: { kind: "basic", name: "Int" },
                            value: { kind: "literal", id: "lit-x-001", value: 5 },
                        },
                        { kind: "ident", id: "id-x-ret", name: "x" },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts a literal with optional type annotation", () => {
        const result = validate({
            kind: "module",
            id: "mod-013",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-tlit-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "unit_type", base: "Float", unit: "usd" },
                    contracts: [],
                    body: [
                        {
                            kind: "literal",
                            id: "lit-typed-001",
                            value: 100.0,
                            type: { kind: "unit_type", base: "Float", unit: "usd" },
                        },
                    ],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });
});
