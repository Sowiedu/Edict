import { describe, it, expect } from "vitest";
import { typeCheck } from "../../src/checker/check.js";
import { typesEqual, isUnknown } from "../../src/checker/types-equal.js";
import { TypeEnv } from "../../src/checker/type-env.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import type { TypeExpr } from "../../src/ast/types.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

// =============================================================================
// TypeEnv
// =============================================================================
describe("TypeEnv", () => {
    it("resolves type alias chains", () => {
        const env = new TypeEnv();
        env.registerTypeDef("Age", { kind: "type", id: "t-1", name: "Age", definition: { kind: "basic", name: "Int" } });
        const resolved = env.resolveAlias({ kind: "named", name: "Age" });
        expect(resolved).toEqual({ kind: "basic", name: "Int" });
    });

    it("resolves chained aliases", () => {
        const env = new TypeEnv();
        env.registerTypeDef("A", { kind: "type", id: "t-1", name: "A", definition: { kind: "named", name: "B" } });
        env.registerTypeDef("B", { kind: "type", id: "t-2", name: "B", definition: { kind: "basic", name: "Int" } });
        const resolved = env.resolveAlias({ kind: "named", name: "A" });
        expect(resolved).toEqual({ kind: "basic", name: "Int" });
    });

    it("returns named type for record/enum type defs", () => {
        const env = new TypeEnv();
        env.registerTypeDef("Point", { kind: "record", id: "r-1", name: "Point", fields: [] });
        const resolved = env.resolveAlias({ kind: "named", name: "Point" });
        expect(resolved).toEqual({ kind: "named", name: "Point" });
    });

    it("returns type as-is for unknown named type", () => {
        const env = new TypeEnv();
        const t: TypeExpr = { kind: "named", name: "Unknown" };
        expect(env.resolveAlias(t)).toBe(t);
    });

    it("returns non-named types as-is", () => {
        const env = new TypeEnv();
        const t: TypeExpr = { kind: "basic", name: "Int" };
        expect(env.resolveAlias(t)).toBe(t);
    });
});

// =============================================================================
// typesEqual
// =============================================================================
describe("typesEqual", () => {
    const env = new TypeEnv();

    it("compares arrays", () => {
        expect(typesEqual(
            { kind: "array", element: { kind: "basic", name: "Int" } },
            { kind: "array", element: { kind: "basic", name: "Int" } },
            env,
        )).toBe(true);
        expect(typesEqual(
            { kind: "array", element: { kind: "basic", name: "Int" } },
            { kind: "array", element: { kind: "basic", name: "String" } },
            env,
        )).toBe(false);
    });

    it("compares options", () => {
        expect(typesEqual(
            { kind: "option", inner: { kind: "basic", name: "Int" } },
            { kind: "option", inner: { kind: "basic", name: "Int" } },
            env,
        )).toBe(true);
        expect(typesEqual(
            { kind: "option", inner: { kind: "basic", name: "Int" } },
            { kind: "option", inner: { kind: "basic", name: "String" } },
            env,
        )).toBe(false);
    });

    it("compares results", () => {
        expect(typesEqual(
            { kind: "result", ok: { kind: "basic", name: "Int" }, err: { kind: "basic", name: "String" } },
            { kind: "result", ok: { kind: "basic", name: "Int" }, err: { kind: "basic", name: "String" } },
            env,
        )).toBe(true);
        expect(typesEqual(
            { kind: "result", ok: { kind: "basic", name: "Int" }, err: { kind: "basic", name: "String" } },
            { kind: "result", ok: { kind: "basic", name: "Float" }, err: { kind: "basic", name: "String" } },
            env,
        )).toBe(false);
    });

    it("compares unit types", () => {
        expect(typesEqual(
            { kind: "unit_type", base: "Float", unit: "usd" },
            { kind: "unit_type", base: "Float", unit: "usd" },
            env,
        )).toBe(true);
        expect(typesEqual(
            { kind: "unit_type", base: "Float", unit: "usd" },
            { kind: "unit_type", base: "Float", unit: "eur" },
            env,
        )).toBe(false);
    });

    it("compares fn_types", () => {
        expect(typesEqual(
            { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: [], returnType: { kind: "basic", name: "Int" } },
            { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: [], returnType: { kind: "basic", name: "Int" } },
            env,
        )).toBe(true);
        // Different param count
        expect(typesEqual(
            { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: [], returnType: { kind: "basic", name: "Int" } },
            { kind: "fn_type", params: [], effects: [], returnType: { kind: "basic", name: "Int" } },
            env,
        )).toBe(false);
        // Different param types
        expect(typesEqual(
            { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: [], returnType: { kind: "basic", name: "Int" } },
            { kind: "fn_type", params: [{ kind: "basic", name: "String" }], effects: [], returnType: { kind: "basic", name: "Int" } },
            env,
        )).toBe(false);
    });

    it("compares tuples", () => {
        expect(typesEqual(
            { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
            { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
            env,
        )).toBe(true);
        // Different length
        expect(typesEqual(
            { kind: "tuple", elements: [{ kind: "basic", name: "Int" }] },
            { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
            env,
        )).toBe(false);
        // Different element types
        expect(typesEqual(
            { kind: "tuple", elements: [{ kind: "basic", name: "Int" }] },
            { kind: "tuple", elements: [{ kind: "basic", name: "String" }] },
            env,
        )).toBe(false);
    });

    it("compares named types", () => {
        expect(typesEqual({ kind: "named", name: "Foo" }, { kind: "named", name: "Foo" }, env)).toBe(true);
        expect(typesEqual({ kind: "named", name: "Foo" }, { kind: "named", name: "Bar" }, env)).toBe(false);
    });

    it("handles different kinds", () => {
        expect(typesEqual({ kind: "basic", name: "Int" }, { kind: "array", element: { kind: "basic", name: "Int" } }, env)).toBe(false);
    });

    it("erases refinements before comparison", () => {
        expect(typesEqual(
            { kind: "refined", id: "r-1", base: { kind: "basic", name: "Int" }, variable: "v", predicate: { kind: "literal", id: "l-1", value: true } },
            { kind: "basic", name: "Int" },
            env,
        )).toBe(true);
    });

    it("compares two refined types with same base (both refined → L70)", () => {
        // Calling typesEqual directly (bypassing resolveForComparison) so both
        // sides remain "refined", exercising the refined-vs-refined branch at L70.
        const refinedA: TypeExpr = { kind: "refined", id: "r-1", base: { kind: "basic", name: "Int" }, variable: "v", predicate: { kind: "literal", id: "l-1", value: true } };
        const refinedB: TypeExpr = { kind: "refined", id: "r-2", base: { kind: "basic", name: "Int" }, variable: "w", predicate: { kind: "literal", id: "l-2", value: false } };
        expect(typesEqual(refinedA, refinedB, env)).toBe(true);
    });
});

// =============================================================================
// isUnknown
// =============================================================================
describe("isUnknown", () => {
    it("returns true for named unknown", () => {
        expect(isUnknown({ kind: "named", name: "unknown" })).toBe(true);
    });
    it("returns false for other named types", () => {
        expect(isUnknown({ kind: "named", name: "Foo" })).toBe(false);
    });
    it("returns false for basic types", () => {
        expect(isUnknown({ kind: "basic", name: "Int" })).toBe(false);
    });
});



// =============================================================================
// Checker edge cases
// =============================================================================
describe("type checker — additional coverage", () => {
    it("handles block expression", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "block", id: "b-1",
                    body: [{ kind: "literal", id: "l-1", value: 42 }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles tuple expression", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
                contracts: [],
                body: [{
                    kind: "tuple_expr", id: "t-1",
                    elements: [
                        { kind: "literal", id: "l-1", value: 1 },
                        { kind: "literal", id: "l-2", value: "hi" },
                    ],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles empty array", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "array", element: { kind: "named", name: "unknown" } }, contracts: [],
                body: [{ kind: "array", id: "arr-1", elements: [] }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles unary not on non-Bool", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{ kind: "unop", id: "u-1", op: "not", operand: { kind: "ident", id: "i-x", name: "x" } }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toMatchObject({ error: "type_mismatch" });
    });

    it("handles unary minus on non-numeric", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "String" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "unop", id: "u-1", op: "-", operand: { kind: "ident", id: "i-x", name: "x" } }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles valid unary minus", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "unop", id: "u-1", op: "-", operand: { kind: "ident", id: "i-x", name: "x" } }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles surplus args in call beyond arity", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "noop",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                },
                {
                    kind: "fn", id: "fn-2", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-n", name: "noop" },
                        args: [{ kind: "literal", id: "l-2", value: 1 }, { kind: "literal", id: "l-3", value: 2 }],
                    }],
                },
            ],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "arity_mismatch", expected: 0, actual: 2 });
    });

    it("handles enum constructor with unknown enum name", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "enum_constructor", id: "ec-1",
                    enumName: "Ghost", variant: "V", fields: [],
                }],
            }],
        }));
        expect(errors.some(e => e.error === "unknown_enum")).toBe(true);
    });

    it("handles enum constructor with unknown variant", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Color",
                    variants: [{ kind: "variant", id: "v-1", name: "Red", fields: [] }],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Color" }, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Color", variant: "Blue", fields: [],
                    }],
                },
            ],
        }));
        expect(errors.some(e => e.error === "unknown_variant")).toBe(true);
    });

    it("handles enum constructor with unknown field in variant", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Color",
                    variants: [{ kind: "variant", id: "v-1", name: "RGB", fields: [{ kind: "field", id: "f-1", name: "r", type: { kind: "basic", name: "Int" } }] }],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Color" }, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Color", variant: "RGB",
                        fields: [{ kind: "field_init", name: "z", value: { kind: "literal", id: "l-1", value: 1 } }],
                    }],
                },
            ],
        }));
        expect(errors.some(e => e.error === "unknown_field")).toBe(true);
    });

    it("handles record_expr that isn't actually a record (it's an enum)", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Color",
                    variants: [{ kind: "variant", id: "v-1", name: "Red", fields: [] }],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Color",
                        fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1 } }],
                    }],
                },
            ],
        }));
        expect(errors.some(e => e.error === "unknown_record")).toBe(true);
    });

    it("handles enum_constructor name that is a record not enum", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Point", variant: "V", fields: [],
                    }],
                },
            ],
        }));
        expect(errors.some(e => e.error === "unknown_enum")).toBe(true);
    });

    it("handles missing required fields in record_expr", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "record", id: "r-1", name: "Point",
                    fields: [
                        { kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } },
                        { kind: "field", id: "f-2", name: "y", type: { kind: "basic", name: "Float" } },
                    ],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Point" }, contracts: [],
                    body: [{ kind: "record_expr", id: "re-1", name: "Point", fields: [] }],
                },
            ],
        }));
        expect(errors.some(e => e.error === "missing_record_fields")).toBe(true);
    });

    it("handles unknown field in record_expr", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Point" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Point",
                        fields: [
                            { kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1.5 } },
                            { kind: "field_init", name: "z", value: { kind: "literal", id: "l-2", value: 2.5 } },
                        ],
                    }],
                },
            ],
        }));
        expect(errors.some(e => e.error === "unknown_field")).toBe(true);
    });

    it("handles lambda with correct return type", () => {
        const fn_type: TypeExpr = {
            kind: "fn_type",
            params: [{ kind: "basic", name: "Int" }],
            effects: [],
            returnType: { kind: "basic", name: "Int" },
        };
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: fn_type, contracts: [],
                body: [{
                    kind: "lambda", id: "lam-1",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                    body: [{ kind: "ident", id: "i-x", name: "x" }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles const type mismatch", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "const", id: "c-1", name: "PI", type: { kind: "basic", name: "Float" }, value: { kind: "literal", id: "l-1", value: "not a float" } },
            ],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles logical op with non-Bool operands", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "and",
                    left: { kind: "ident", id: "i-x", name: "x" },
                    right: { kind: "literal", id: "l-1", value: true },
                }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles non-numeric subtraction", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "String" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "String" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "String" }, contracts: [],
                body: [{ kind: "binop", id: "e-1", op: "-", left: { kind: "ident", id: "i-a", name: "a" }, right: { kind: "ident", id: "i-b", name: "b" } }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles mixed-type subtraction (Int - Float)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Float" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "binop", id: "e-1", op: "-", left: { kind: "ident", id: "i-a", name: "a" }, right: { kind: "ident", id: "i-b", name: "b" } }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles pre-contract type checking", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" },
                contracts: [{
                    kind: "pre", id: "pre-1",
                    condition: {
                        kind: "binop", id: "e-1", op: ">",
                        left: { kind: "ident", id: "i-x", name: "x" },
                        right: { kind: "literal", id: "l-0", value: 0 },
                    },
                }],
                body: [{ kind: "ident", id: "i-x2", name: "x" }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles constructor pattern with known enum variant", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Option",
                    variants: [
                        { kind: "variant", id: "v-1", name: "Some", fields: [{ kind: "field", id: "f-1", name: "value", type: { kind: "basic", name: "Int" } }] },
                        { kind: "variant", id: "v-2", name: "None", fields: [] },
                    ],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "named", name: "Option" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-x", name: "x" },
                        arms: [
                            {
                                kind: "arm", id: "a-1",
                                pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "v" }] },
                                body: [{ kind: "ident", id: "i-v", name: "v" }],
                            },
                            {
                                kind: "arm", id: "a-2",
                                pattern: { kind: "constructor", name: "None", fields: [] },
                                body: [{ kind: "literal", id: "l-1", value: 0 }],
                            },
                        ],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("handles access on named type that isn't registered", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "named", name: "UnknownRecord" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "access", id: "acc-1", target: { kind: "ident", id: "i-x", name: "x" }, field: "foo" }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles array with mixed types", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "array", element: { kind: "basic", name: "Int" } }, contracts: [],
                body: [{
                    kind: "array", id: "arr-1",
                    elements: [
                        { kind: "literal", id: "l-1", value: 1 },
                        { kind: "literal", id: "l-2", value: "oops" },
                    ],
                }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });
});
