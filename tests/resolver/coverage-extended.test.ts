import { describe, it, expect } from "vitest";
import { resolve } from "../../src/resolver/resolve.js";
import type { EdictModule, Definition } from "../../src/ast/nodes.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

describe("resolver — final coverage targets", () => {
    it("resolves constructor pattern with unknown variant (enum exists but variant doesn't — L452 + L465-468)", () => {
        // This exercises findVariantInScope iterating through an enum's variants
        // without finding a match, AND collectAllVariantNames collecting variant
        // names for error suggestions.
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Color",
                    variants: [
                        { kind: "variant", id: "v-1", name: "Red", fields: [] },
                        { kind: "variant", id: "v-2", name: "Green", fields: [] },
                    ],
                } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "named", name: "Color" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-x", name: "x" },
                        arms: [{
                            kind: "arm", id: "a-1",
                            pattern: { kind: "constructor", name: "Blue", fields: [] },
                            body: [{ kind: "literal", id: "l-1", value: 0 }],
                        }],
                    }],
                } as Definition,
            ],
        }));
        // "Blue" is not a variant of Color → undefined_reference
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "undefined_reference",
            name: "Blue",
        });
    });

    it("resolves constructor pattern with sub-patterns when variant is unknown (L452 coverage)", () => {
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Shape",
                    variants: [
                        { kind: "variant", id: "v-1", name: "Circle", fields: [{ kind: "field", id: "f-1", name: "radius", type: { kind: "basic", name: "Float" } }] },
                    ],
                } as Definition,
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "s", type: { kind: "named", name: "Shape" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-s", name: "s" },
                        arms: [{
                            kind: "arm", id: "a-1",
                            pattern: {
                                kind: "constructor", name: "Square",
                                fields: [{ kind: "binding", name: "side" }],
                            },
                            body: [{ kind: "ident", id: "i-side", name: "side" }],
                        }],
                    }],
                } as Definition,
            ],
        }));
        expect(errors.some(e => e.error === "undefined_reference")).toBe(true);
    });

    it("resolves constructor pattern where no enums exist at all", () => {
        // findVariantInScope iterates scope but finds no enums → returns false
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-x", name: "x" },
                        arms: [{
                            kind: "arm", id: "a-1",
                            pattern: { kind: "constructor", name: "Foo", fields: [] },
                            body: [{ kind: "literal", id: "l-1", value: 0 }],
                        }],
                    }],
                } as Definition,
            ],
        }));
        expect(errors.some(e => e.error === "undefined_reference")).toBe(true);
    });

    it("resolves lambda expression body", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "lambda", id: "lam-1",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                    body: [{ kind: "ident", id: "i-x", name: "x" }],
                }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves let expression body and continuation", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "let", id: "let-1", name: "y",
                    type: { kind: "basic", name: "Int" },
                    value: { kind: "literal", id: "l-1", value: 42 },
                    body: [{ kind: "ident", id: "i-y", name: "y" }],
                }],
            } as Definition],
        }));
        expect(errors).toEqual([]);
    });
});
