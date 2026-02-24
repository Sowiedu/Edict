import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";

describe("edge cases", () => {
    it("detects duplicate node IDs", () => {
        const result = validate({
            kind: "module",
            id: "dup-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "dup-001", // same as module ID
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "unique-001", value: 1 }],
                },
            ],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            const dupError = result.errors.find((e) => e.error === "duplicate_id");
            expect(dupError).toBeDefined();
            expect(dupError).toMatchObject({
                error: "duplicate_id",
                nodeId: "dup-001",
                firstPath: "$",
                secondPath: "$.definitions[0]",
            });
        }
    });

    it("detects multiple duplicate IDs", () => {
        const result = validate({
            kind: "module",
            id: "x",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "x",
                    name: "a",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        { kind: "literal", id: "x", value: 1 },
                    ],
                },
            ],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            const dupErrors = result.errors.filter((e) => e.error === "duplicate_id");
            expect(dupErrors.length).toBe(2);
        }
    });

    it("accepts empty definitions array", () => {
        const result = validate({
            kind: "module",
            id: "empty-001",
            name: "empty",
            imports: [],
            definitions: [],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts empty imports array", () => {
        const result = validate({
            kind: "module",
            id: "empty-imp-001",
            name: "test",
            imports: [],
            definitions: [],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts function with empty body", () => {
        const result = validate({
            kind: "module",
            id: "empty-body-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-empty-001",
                    name: "noop",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts function with empty contracts", () => {
        const result = validate({
            kind: "module",
            id: "empty-con-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-nocon-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "l-001", value: 0 }],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts empty array expression", () => {
        const result = validate({
            kind: "module",
            id: "empty-arr-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-earr-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "array", element: { kind: "basic", name: "Int" } },
                    contracts: [],
                    body: [{ kind: "array", id: "arr-e-001", elements: [] }],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts empty tuple expression", () => {
        const result = validate({
            kind: "module",
            id: "empty-tup-001",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-etup-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "tuple", elements: [] },
                    contracts: [],
                    body: [{ kind: "tuple_expr", id: "tup-e-001", elements: [] }],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("validates deeply nested expressions", () => {
        // Build a deeply nested binary operation: 1 + (1 + (1 + (1 + ...)))
        let expr: unknown = { kind: "literal", id: "deep-base", value: 1 };
        for (let i = 0; i < 20; i++) {
            expr = {
                kind: "binop",
                id: `deep-${i}`,
                op: "+",
                left: { kind: "literal", id: `deep-lit-${i}`, value: 1 },
                right: expr,
            };
        }

        const result = validate({
            kind: "module",
            id: "deep-mod-001",
            name: "deep",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-deep-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [expr],
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts multiple definitions of different kinds", () => {
        const result = validate({
            kind: "module",
            id: "multi-001",
            name: "multi",
            imports: [],
            definitions: [
                {
                    kind: "record",
                    id: "rec-multi-001",
                    name: "Point",
                    fields: [
                        {
                            kind: "field",
                            id: "f-mx-001",
                            name: "x",
                            type: { kind: "basic", name: "Int" },
                        },
                    ],
                },
                {
                    kind: "enum",
                    id: "enum-multi-001",
                    name: "Color",
                    variants: [
                        { kind: "variant", id: "v-red", name: "Red", fields: [] },
                    ],
                },
                {
                    kind: "fn",
                    id: "fn-multi-001",
                    name: "test",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-multi-001", value: 0 }],
                },
                {
                    kind: "const",
                    id: "const-multi-001",
                    name: "X",
                    type: { kind: "basic", name: "Int" },
                    value: { kind: "literal", id: "lit-multi-002", value: 1 },
                },
                {
                    kind: "type",
                    id: "type-multi-001",
                    name: "Alias",
                    definition: { kind: "named", name: "Point" },
                },
            ],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts all binary operators", () => {
        const ops = ["+", "-", "*", "/", "%", "==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"];
        const body = ops.map((op, i) => ({
            kind: "binop",
            id: `bo-${i}`,
            op,
            left: { kind: "literal", id: `bl-${i}`, value: 1 },
            right: { kind: "literal", id: `br-${i}`, value: 2 },
        }));

        const result = validate({
            kind: "module",
            id: "ops-001",
            name: "ops",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-ops-001",
                name: "test",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body,
            }],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts all unary operators", () => {
        const result = validate({
            kind: "module",
            id: "uops-001",
            name: "uops",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-uops-001",
                name: "test",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    { kind: "unop", id: "uo-not", op: "not", operand: { kind: "literal", id: "ul-1", value: true } },
                    { kind: "unop", id: "uo-neg", op: "-", operand: { kind: "literal", id: "ul-2", value: 5 } },
                ],
            }],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts all basic type names", () => {
        const names = ["Int", "Float", "String", "Bool"];
        const params = names.map((name, i) => ({
            kind: "param",
            id: `p-bt-${i}`,
            name: `p${i}`,
            type: { kind: "basic", name },
        }));

        const result = validate({
            kind: "module",
            id: "bt-001",
            name: "basicTypes",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-bt-001",
                name: "test",
                params,
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "bt-lit-001", value: 0 }],
            }],
        });
        expect(result).toEqual({ ok: true });
    });

    it("accepts all effect combinations", () => {
        // "pure" must be alone; non-pure effects can combine freely
        const pureFn = validate({
            kind: "module",
            id: "eff-all-001",
            name: "effects",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-eff-001",
                name: "pureTest",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "el-001", value: 0 }],
            }],
        });
        expect(pureFn).toEqual({ ok: true });

        const sideEffectsFn = validate({
            kind: "module",
            id: "eff-all-002",
            name: "effects2",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-eff-002",
                name: "sideEffectsTest",
                params: [],
                effects: ["reads", "writes", "io", "fails"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "el-002", value: 0 }],
            }],
        });
        expect(sideEffectsFn).toEqual({ ok: true });
    });

    it("accepts all pattern kinds", () => {
        const result = validate({
            kind: "module",
            id: "pat-001",
            name: "patterns",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-pat-001",
                name: "test",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "match",
                    id: "m-pat-001",
                    target: { kind: "literal", id: "l-pat-001", value: 1 },
                    arms: [
                        {
                            kind: "arm", id: "arm-lp",
                            pattern: { kind: "literal_pattern", value: 1 },
                            body: [{ kind: "literal", id: "l-arm1", value: 10 }],
                        },
                        {
                            kind: "arm", id: "arm-bp",
                            pattern: { kind: "binding", name: "x" },
                            body: [{ kind: "ident", id: "i-arm2", name: "x" }],
                        },
                        {
                            kind: "arm", id: "arm-cp",
                            pattern: {
                                kind: "constructor", name: "Foo",
                                fields: [{ kind: "wildcard" }],
                            },
                            body: [{ kind: "literal", id: "l-arm3", value: 20 }],
                        },
                        {
                            kind: "arm", id: "arm-wp",
                            pattern: { kind: "wildcard" },
                            body: [{ kind: "literal", id: "l-arm4", value: 0 }],
                        },
                    ],
                }],
            }],
        });
        expect(result).toEqual({ ok: true });
    });

    it("collects all errors from a program with multiple issues", () => {
        const result = validate({
            kind: "module",
            id: "multi-err",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-err",
                    name: "test",
                    params: [{ kind: "arg", id: "p-bad", name: "x", type: { kind: "basic", name: "Int" } }],
                    effects: ["async"],
                    returnType: { kind: "basic", name: "Number" },
                    contracts: [],
                    body: [{ kind: "yield", id: "y-bad" }],
                },
            ],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            // Should have at least 3 errors: bad param kind, bad effect, bad return type, bad expr kind
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
        }
    });

    it("rejects if-expr with non-array else branch", () => {
        const result = validate({
            kind: "module",
            id: "na-else-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-na-else-001",
                name: "test",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "if",
                    id: "if-na-001",
                    condition: { kind: "literal", id: "c-na-001", value: true },
                    then: [{ kind: "literal", id: "t-na-001", value: 1 }],
                    else: "not-an-array",
                }],
            }],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(
                (e) => e.error === "invalid_field_type" && "field" in e && e.field === "else",
            );
            expect(err).toBeDefined();
        }
    });

    it("rejects match arm with non-object nested pattern in constructor", () => {
        const result = validate({
            kind: "module",
            id: "np-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-np-001",
                name: "test",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "match",
                    id: "m-np-001",
                    target: { kind: "literal", id: "l-np-001", value: 1 },
                    arms: [{
                        kind: "arm",
                        id: "arm-np-001",
                        pattern: {
                            kind: "constructor",
                            name: "Foo",
                            fields: [42],
                        },
                        body: [{ kind: "literal", id: "l-np-002", value: 0 }],
                    }],
                }],
            }],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(
                (e) => e.error === "invalid_field_type" && "field" in e,
            );
            expect(err).toBeDefined();
        }
    });
});
