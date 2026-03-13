import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";
import { validateTypeExpr, validateExpression } from "../../src/validator/node-validators.js";
import { IdTracker } from "../../src/validator/id-tracker.js";
import type { StructuredError } from "../../src/errors/structured-errors.js";

function expectErrors(
    ast: unknown,
    ...matchers: Array<Partial<StructuredError>>
) {
    const result = validate(ast);
    expect(result.ok).toBe(false);
    if (!result.ok) {
        for (const matcher of matchers) {
            expect(result.errors).toEqual(
                expect.arrayContaining([expect.objectContaining(matcher)]),
            );
        }
    }
    return result.ok === false ? result.errors : [];
}

function expectErrorCount(ast: unknown, count: number) {
    const result = validate(ast);
    expect(result.ok).toBe(false);
    if (!result.ok) {
        expect(result.errors).toHaveLength(count);
    }
}

describe("invalid programs", () => {
    it("rejects null input", () => {
        expectErrors(null, { error: "invalid_field_type" });
    });

    it("rejects non-object input", () => {
        expectErrors(42, { error: "invalid_field_type" });
        expectErrors("string", { error: "invalid_field_type" });
        expectErrors(true, { error: "invalid_field_type" });
    });

    it("rejects arrays", () => {
        expectErrors([], { error: "invalid_field_type" });
    });

    it("rejects object without kind", () => {
        expectErrors({ id: "m1", name: "test" }, { error: "missing_field", field: "kind" });
    });

    it("rejects unknown module kind", () => {
        expectErrors(
            { kind: "program", id: "m1", name: "test" },
            { error: "unknown_node_kind", received: "program" },
        );
    });

    it("rejects module missing name", () => {
        expectErrors(
            { kind: "module", id: "m1", imports: [], definitions: [] },
            { error: "missing_field", field: "name" },
        );
    });

    it("rejects module missing id", () => {
        expectErrors(
            { kind: "module", name: "test", imports: [], definitions: [] },
            { error: "missing_field", field: "id" },
        );
    });

    it("rejects module missing imports", () => {
        expectErrors(
            { kind: "module", id: "m1", name: "test", definitions: [] },
            { error: "missing_field", field: "imports" },
        );
    });

    it("rejects module missing definitions", () => {
        expectErrors(
            { kind: "module", id: "m1", name: "test", imports: [] },
            { error: "missing_field", field: "definitions" },
        );
    });

    it("rejects module with non-array imports", () => {
        expectErrors(
            { kind: "module", id: "m1", name: "test", imports: "bad", definitions: [] },
            { error: "invalid_field_type", field: "imports", expectedFormat: "array" },
        );
    });

    it("rejects import with wrong kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test",
                imports: [{ kind: "require", id: "i1", module: "a", names: [] }],
                definitions: [],
            },
            { error: "unknown_node_kind", received: "require" },
        );
    });

    it("rejects import with non-string names", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test",
                imports: [{ kind: "import", id: "i1", module: "a", names: [42] }],
                definitions: [],
            },
            { error: "invalid_field_type", field: "names[0]", expectedFormat: "string" },
        );
    });

    it("rejects unknown definition kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test",
                imports: [],
                definitions: [{ kind: "class", id: "c1", name: "Foo" }],
            },
            { error: "unknown_node_kind", received: "class" },
        );
    });

    it("rejects function missing params", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "missing_field", field: "params" },
        );
    });

    it("rejects invalid effect", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["async"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "invalid_effect", received: "async" },
        );
    });

    it("rejects param with wrong kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [{ kind: "arg", id: "p1", name: "x", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "unknown_node_kind", received: "arg" },
        );
    });

    it("rejects contract with wrong kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [{
                        kind: "invariant", id: "inv1",
                        condition: { kind: "literal", id: "l1", value: true },
                    }],
                    body: [],
                }],
            },
            { error: "unknown_node_kind", received: "invariant" },
        );
    });

    it("rejects unknown type expression kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "generic", name: "T" },
                    contracts: [], body: [],
                }],
            },
            { error: "unknown_node_kind", received: "generic" },
        );
    });

    it("rejects invalid basic type name", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Number" },
                    contracts: [], body: [],
                }],
            },
            { error: "invalid_basic_type_name", received: "Number" },
        );
    });

    it("rejects unknown expression kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "yield", id: "y1", value: 1 }],
                }],
            },
            { error: "unknown_node_kind", received: "yield" },
        );
    });

    it("rejects invalid binary operator", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "binop", id: "bo1", op: "**",
                        left: { kind: "literal", id: "l1", value: 2 },
                        right: { kind: "literal", id: "l2", value: 3 },
                    }],
                }],
            },
            { error: "invalid_operator", received: "**" },
        );
    });

    it("rejects invalid unary operator", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "unop", id: "uo1", op: "++",
                        operand: { kind: "literal", id: "l1", value: 1 },
                    }],
                }],
            },
            { error: "invalid_operator", received: "++" },
        );
    });

    it("rejects non-object literal value", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "l1", value: [1, 2] }],
                }],
            },
            { error: "invalid_field_type", field: "value" },
        );
    });

    it("rejects record field with wrong kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "record", id: "r1", name: "Foo",
                    fields: [{ kind: "prop", id: "f1", name: "x", type: { kind: "basic", name: "Int" } }],
                }],
            },
            { error: "unknown_node_kind", received: "prop" },
        );
    });

    it("rejects enum variant with wrong kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "enum", id: "e1", name: "Foo",
                    variants: [{ kind: "case", id: "v1", name: "A", fields: [] }],
                }],
            },
            { error: "unknown_node_kind", received: "case" },
        );
    });

    it("rejects match arm with wrong kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [{
                            kind: "branch", id: "a1",
                            pattern: { kind: "wildcard" },
                            body: [{ kind: "literal", id: "l2", value: 1 }],
                        }],
                    }],
                }],
            },
            { error: "unknown_node_kind", received: "branch" },
        );
    });

    it("rejects unknown pattern kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [{
                            kind: "arm", id: "a1",
                            pattern: { kind: "regex", value: ".*" },
                            body: [{ kind: "literal", id: "l2", value: 1 }],
                        }],
                    }],
                }],
            },
            { error: "unknown_node_kind", received: "regex" },
        );
    });

    it("rejects invalid unit_type base", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "type", id: "t1", name: "Bad",
                    definition: { kind: "unit_type", base: "String", unit: "usd" },
                }],
            },
            { error: "invalid_field_type", field: "base" },
        );
    });

    it("rejects non-object in definition array", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [42],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object param", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: ["bad"],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object import", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [null],
                definitions: [],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object contract", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [123], body: [],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object in record_expr fields", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "record_expr", id: "re1", name: "Foo",
                        fields: ["bad"],
                    }],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object in enum_constructor fields", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec1", enumName: "Foo", variant: "Bar",
                        fields: [42],
                    }],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object record field", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "record", id: "r1", name: "Foo",
                    fields: [42],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object enum variant", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "enum", id: "e1", name: "Foo",
                    variants: ["bad"],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects definition without kind field", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{ id: "d1", name: "test" }],
            },
            { error: "missing_field", field: "kind" },
        );
    });

    it("rejects non-object expression in body", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [42],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects expression without kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ id: "x1", value: 1 }],
                }],
            },
            { error: "missing_field", field: "kind" },
        );
    });

    it("rejects type expr without kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "missing_field", field: "kind" },
        );
    });

    it("rejects non-object type expression", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: "Int",
                    contracts: [], body: [],
                }],
            },
            { error: "invalid_field_type", field: "returnType" },
        );
    });

    it("rejects literal_pattern with invalid value type", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [{
                            kind: "arm", id: "a1",
                            pattern: { kind: "literal_pattern", value: [1] },
                            body: [{ kind: "literal", id: "l2", value: 1 }],
                        }],
                    }],
                }],
            },
            { error: "invalid_field_type", field: "value" },
        );
    });

    it("rejects non-object pattern", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [{
                            kind: "arm", id: "a1",
                            pattern: "wildcard",
                            body: [{ kind: "literal", id: "l2", value: 1 }],
                        }],
                    }],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object match arm", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [42],
                    }],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects invalid let type annotation (non-object)", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "let", id: "let1", name: "x",
                        type: "Int",
                        value: { kind: "literal", id: "l1", value: 1 },
                    }],
                }],
            },
            { error: "invalid_field_type", field: "type" },
        );
    });

    it("rejects invalid literal type annotation (non-object)", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "literal", id: "l1", value: 1,
                        type: "Int",
                    }],
                }],
            },
            { error: "invalid_field_type", field: "type" },
        );
    });

    it("rejects fn_type effect with invalid value", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [{
                        kind: "param", id: "p1", name: "f",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: ["async"],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "invalid_effect", received: "async" },
        );
    });

    it("rejects non-object in fn_type params", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [{
                        kind: "param", id: "p1", name: "f",
                        type: {
                            kind: "fn_type",
                            params: [42],
                            effects: ["pure"],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [], body: [],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects non-object in tuple type elements", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "type", id: "t1", name: "Bad",
                    definition: {
                        kind: "tuple",
                        elements: ["Int", "String"],
                    },
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects pattern without kind", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [{
                            kind: "arm", id: "a1",
                            pattern: { name: "x" },
                            body: [{ kind: "literal", id: "l2", value: 1 }],
                        }],
                    }],
                }],
            },
            { error: "missing_field", field: "kind" },
        );
    });

    // =========================================================================
    // Coverage gap tests — targeted at specific uncovered branches
    // =========================================================================

    it("rejects module with non-string name (requireString wrong-type branch)", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: 42, imports: [], definitions: [],
            },
            { error: "invalid_field_type", field: "name", expectedFormat: "string", actualFormat: "number" },
        );
    });

    it("rejects literal with missing value field", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "l1" }],
                }],
            },
            { error: "missing_field", field: "value" },
        );
    });

    it("rejects literal_pattern with missing value field", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match", id: "m1",
                        target: { kind: "literal", id: "l1", value: 1 },
                        arms: [{
                            kind: "arm", id: "a1",
                            pattern: { kind: "literal_pattern" },
                            body: [{ kind: "literal", id: "l2", value: 1 }],
                        }],
                    }],
                }],
            },
            { error: "missing_field", field: "value" },
        );
    });

    it("rejects contract with missing condition (requireObject missing field)", () => {
        expectErrors(
            {
                kind: "module", id: "m1", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [{ kind: "pre", id: "c1" }],
                    body: [],
                }],
            },
            { error: "missing_field", field: "condition" },
        );
    });

    it("rejects non-object type expression via direct call (defensive guard)", () => {
        const errors: StructuredError[] = [];
        const idTracker = new IdTracker();
        validateTypeExpr("Int", "$.test", errors, idTracker);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "invalid_field_type",
            expectedFormat: "object",
        });
    });

    it("rejects non-object expression via direct call (defensive guard)", () => {
        const errors: StructuredError[] = [];
        const idTracker = new IdTracker();
        validateExpression(42, "$.test", errors, idTracker);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "invalid_field_type",
            expectedFormat: "object",
        });
    });

    it("rejects pure combined with other effects", () => {
        expectErrors(
            {
                kind: "module",
                id: "mod-eff-conflict",
                name: "test",
                imports: [],
                definitions: [{
                    kind: "fn",
                    id: "fn-eff-conflict",
                    name: "test",
                    params: [],
                    effects: ["pure", "io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-eff-c1", value: 0 }],
                }],
            },
            { error: "conflicting_effects" },
        );
    });

    it("auto-normalizes record_expr field without field_init kind", () => {
        // After normalization, bare fields in record_expr get kind: "field_init" auto-injected
        const result = validate({
            kind: "module",
            id: "mod-fi-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-fi-001",
                name: "test",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "record_expr",
                    id: "rec-fi-001",
                    name: "Point",
                    fields: [{
                        name: "x",
                        value: { kind: "literal", id: "lit-fi-001", value: 1 },
                    }],
                }],
            }],
        });
        // Should pass validation now (no unknown_node_kind error)
        // There may be downstream errors (e.g., record "Point" not defined), but no structural errors
        if (!result.ok) {
            const structuralErrors = result.errors.filter(
                (e) => e.error === "unknown_node_kind" || e.error === "missing_field",
            );
            expect(structuralErrors).toHaveLength(0);
        }
    });

    it("rejects non-object field_init", () => {
        expectErrors(
            {
                kind: "module",
                id: "mod-nofi-001",
                name: "test",
                imports: [],
                definitions: [{
                    kind: "fn",
                    id: "fn-nofi-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "record_expr",
                        id: "rec-nofi-001",
                        name: "Point",
                        fields: ["not-an-object"],
                    }],
                }],
            },
            { error: "invalid_field_type" },
        );
    });

    it("rejects call with string fn (must be expression)", () => {
        expectErrors(
            {
                kind: "module",
                id: "mod-callfn-001",
                name: "test",
                imports: [],
                definitions: [{
                    kind: "fn",
                    id: "fn-callfn-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call",
                        id: "call-str-001",
                        fn: "foo",
                        args: [{ kind: "literal", id: "lit-cs-001", value: 1 }],
                    }],
                }],
            },
            { error: "invalid_field_type", field: "fn" },
        );
    });

    it("rejects non-object pattern in match arm", () => {
        expectErrors(
            {
                kind: "module",
                id: "mod-pat-obj-001",
                name: "test",
                imports: [],
                definitions: [{
                    kind: "fn",
                    id: "fn-pat-obj-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "match",
                        id: "match-pat-obj-001",
                        target: { kind: "literal", id: "lit-mp-001", value: 1 },
                        arms: [{
                            kind: "arm",
                            id: "arm-pat-obj-001",
                            pattern: "not_a_pattern",
                            body: [{ kind: "literal", id: "lit-ap-001", value: 0 }],
                        }],
                    }],
                }],
            },
            { error: "invalid_field_type" },
        );
    });
});
