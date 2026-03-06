import { describe, it, expect } from "vitest";
import { typeCheck } from "../../src/checker/check.js";
import { TypeEnv } from "../../src/checker/type-env.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import type { TypeExpr } from "../../src/ast/types.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

describe("type checker — final coverage targets", () => {
    it("handles refined type through arithmetic (resolveForCheck L730-734)", () => {
        const refined: TypeExpr = {
            kind: "refined", id: "ref-1",
            base: { kind: "basic", name: "Int" }, variable: "v",
            predicate: { kind: "literal", id: "l-p", value: true },
        };
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: refined },
                    { kind: "param", id: "p-b", name: "b", type: refined },
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

    it("handles match with boolean literal pattern (L739)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Bool" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [
                        { kind: "arm", id: "a-1", pattern: { kind: "literal_pattern", value: true }, body: [{ kind: "literal", id: "l-1", value: 1 }] },
                        { kind: "arm", id: "a-2", pattern: { kind: "literal_pattern", value: false }, body: [{ kind: "literal", id: "l-2", value: 0 }] },
                    ],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles match with string literal pattern (L740)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "String" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [
                        { kind: "arm", id: "a-1", pattern: { kind: "literal_pattern", value: "hello" }, body: [{ kind: "literal", id: "l-1", value: 1 }] },
                        { kind: "arm", id: "a-2", pattern: { kind: "wildcard" }, body: [{ kind: "literal", id: "l-2", value: 0 }] },
                    ],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles match with float literal pattern (L741-742)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Float" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [
                        { kind: "arm", id: "a-1", pattern: { kind: "literal_pattern", value: 3.14 }, body: [{ kind: "literal", id: "l-1", value: 1 }] },
                        { kind: "arm", id: "a-2", pattern: { kind: "wildcard" }, body: [{ kind: "literal", id: "l-2", value: 0 }] },
                    ],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles constructor pattern with unknown target type (L466)", () => {
        const { errors } = typeCheck(mod({
            imports: [{ kind: "import", id: "imp-1", module: "ext", names: ["someVal"] }],
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [],
                effects: ["pure"], returnType: { kind: "named", name: "unknown" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-sv", name: "someVal" },
                    arms: [{
                        kind: "arm", id: "a-1",
                        pattern: { kind: "constructor", name: "Foo", fields: [{ kind: "binding", name: "v" }] },
                        body: [{ kind: "ident", id: "i-v", name: "v" }],
                    }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles constructor pattern on non-named target (L475)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [{
                        kind: "arm", id: "a-1",
                        pattern: { kind: "constructor", name: "Foo", fields: [{ kind: "binding", name: "v" }] },
                        body: [{ kind: "ident", id: "i-v", name: "v" }],
                    }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("handles constructor pattern on named non-enum type (L484)", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "named", name: "Point" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-x", name: "x" },
                        arms: [{
                            kind: "arm", id: "a-1",
                            pattern: { kind: "constructor", name: "Foo", fields: [{ kind: "binding", name: "v" }] },
                            body: [{ kind: "ident", id: "i-v", name: "v" }],
                        }],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("handles constructor pattern with unknown variant name (L492)", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Color",
                    variants: [{ kind: "variant", id: "v-1", name: "Red", fields: [] }],
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "named", name: "Color" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-x", name: "x" },
                        arms: [{
                            kind: "arm", id: "a-1",
                            pattern: { kind: "constructor", name: "Blue", fields: [{ kind: "binding", name: "v" }] },
                            body: [{ kind: "ident", id: "i-v", name: "v" }],
                        }],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("handles + with non-numeric, non-string operands (L295)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Bool" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Bool" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("handles comparison with mismatched types (L279)", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "String" } },
                ],
                effects: ["pure"], returnType: { kind: "basic", name: "Bool" }, contracts: [],
                body: [{
                    kind: "binop", id: "e-1", op: "==",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                }],
            }],
        }));
        expect(errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("unknown_record error includes candidate record names", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] },
                { kind: "record", id: "r-2", name: "Vec3", fields: [] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Ghost", fields: [],
                    }],
                },
            ],
        }));
        const err = errors.find(e => e.error === "unknown_record");
        expect(err).toBeDefined();
        if (err && err.error === "unknown_record") {
            expect(err.candidates).toContain("Point");
            expect(err.candidates).toContain("Vec3");
        }
    });

    it("unknown_enum error includes candidate enum names", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "enum", id: "e-1", name: "Color", variants: [{ kind: "variant", id: "v-1", name: "Red", fields: [] }] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Ghost", variant: "V", fields: [],
                    }],
                },
            ],
        }));
        const err = errors.find(e => e.error === "unknown_enum");
        expect(err).toBeDefined();
        if (err && err.error === "unknown_enum") {
            expect(err.candidates).toContain("Color");
        }
    });
});

describe("TypeEnv.allTypeDefNames", () => {
    it("collects names from parent chain", () => {
        const parent = new TypeEnv();
        parent.registerTypeDef("Point", { kind: "record", id: "r-1", name: "Point", fields: [] });
        parent.registerTypeDef("Color", { kind: "enum", id: "e-1", name: "Color", variants: [] });

        const child = parent.child();
        child.registerTypeDef("Vec3", { kind: "record", id: "r-2", name: "Vec3", fields: [] });

        const recordNames = child.allTypeDefNames("record");
        expect(recordNames).toContain("Point");
        expect(recordNames).toContain("Vec3");
        expect(recordNames).not.toContain("Color");

        const enumNames = child.allTypeDefNames("enum");
        expect(enumNames).toContain("Color");
        expect(enumNames).not.toContain("Point");
    });
});
