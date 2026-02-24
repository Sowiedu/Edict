import { describe, it, expect } from "vitest";
import { resolve } from "../../src/resolver/resolve.js";
import type { EdictModule } from "../../src/ast/nodes.js";

/**
 * Helper to create a minimal valid module.
 */
function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports: [],
        definitions: [],
        ...overrides,
    };
}

describe("name resolution — valid programs", () => {
    it("resolves param references in function body", () => {
        const errors = resolve(mod({
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

    it("resolves cross-function calls", () => {
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "helper",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 42 }],
                },
                {
                    kind: "fn", id: "fn-2", name: "main",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-h", name: "helper" },
                        args: [],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves let bindings in subsequent expressions", () => {
        const errors = resolve(mod({
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

    it("resolves match arm bindings", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "n", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-n", name: "n" },
                    arms: [{
                        kind: "arm", id: "a-1",
                        pattern: { kind: "binding", name: "x" },
                        body: [{ kind: "ident", id: "i-x", name: "x" }],
                    }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves lambda param", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: [], returnType: { kind: "basic", name: "Int" } },
                contracts: [],
                body: [{
                    kind: "lambda", id: "lam-1",
                    params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                    body: [{ kind: "ident", id: "i-x", name: "x" }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves shadowed names (inner scope wins)", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [
                    { kind: "let", id: "let-1", name: "x", value: { kind: "literal", id: "l-1", value: 99 } },
                    { kind: "ident", id: "i-x", name: "x" },
                ],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves imported name used in call", () => {
        const errors = resolve(mod({
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
        expect(errors).toEqual([]);
    });

    it("resolves recursive self-reference", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "fib",
                params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-f", name: "fib" },
                    args: [{ kind: "literal", id: "l-1", value: 1 }],
                }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves const reference", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "const", id: "c-1", name: "PI", type: { kind: "basic", name: "Float" }, value: { kind: "literal", id: "l-pi", value: 3.14 } },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{ kind: "ident", id: "i-pi", name: "PI" }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves record and enum names in types", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "p", type: { kind: "named", name: "Point" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 0.0 }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves result in post-contract", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "abs",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" },
                contracts: [{
                    kind: "post", id: "post-1",
                    condition: {
                        kind: "binop", id: "e-1", op: ">=",
                        left: { kind: "ident", id: "i-r", name: "result" },
                        right: { kind: "literal", id: "l-0", value: 0 },
                    },
                }],
                body: [{ kind: "ident", id: "i-x", name: "x" }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves refinement type variable in predicate", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{
                    kind: "param", id: "p-1", name: "age",
                    type: {
                        kind: "refined", id: "ref-1",
                        base: { kind: "basic", name: "Int" },
                        variable: "v",
                        predicate: {
                            kind: "binop", id: "e-1", op: ">",
                            left: { kind: "ident", id: "i-v", name: "v" },
                            right: { kind: "literal", id: "l-0", value: 0 },
                        },
                    },
                }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "ident", id: "i-a", name: "age" }],
            }],
        }));
        expect(errors).toEqual([]);
    });

    it("resolves ConstructorPattern variant name", () => {
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "enum", id: "e-1", name: "Shape",
                    variants: [
                        { kind: "variant", id: "v-1", name: "Circle", fields: [{ kind: "field", id: "f-1", name: "r", type: { kind: "basic", name: "Float" } }] },
                        { kind: "variant", id: "v-2", name: "Square", fields: [{ kind: "field", id: "f-2", name: "s", type: { kind: "basic", name: "Float" } }] },
                    ],
                },
                {
                    kind: "fn", id: "fn-1", name: "area",
                    params: [{ kind: "param", id: "p-1", name: "shape", type: { kind: "named", name: "Shape" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{
                        kind: "match", id: "m-1",
                        target: { kind: "ident", id: "i-s", name: "shape" },
                        arms: [
                            {
                                kind: "arm", id: "a-1",
                                pattern: { kind: "constructor", name: "Circle", fields: [{ kind: "binding", name: "r" }] },
                                body: [{ kind: "ident", id: "i-r", name: "r" }],
                            },
                            {
                                kind: "arm", id: "a-2",
                                pattern: { kind: "wildcard" },
                                body: [{ kind: "literal", id: "l-0", value: 0.0 }],
                            },
                        ],
                    }],
                },
            ],
        }));
        expect(errors).toEqual([]);
    });
});

describe("name resolution — invalid programs", () => {
    it("reports undefined variable with Levenshtein candidates", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "count", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "ident", id: "i-c", name: "cont" }],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "undefined_reference",
            nodeId: "i-c",
            name: "cont",
        });
        // Should suggest "count" as a candidate
        expect((errors[0] as any).candidates).toContain("count");
    });

    it("reports duplicate function names", () => {
        const errors = resolve(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 1 }],
                },
                {
                    kind: "fn", id: "fn-2", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-2", value: 2 }],
                },
            ],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "duplicate_definition",
            name: "test",
        });
    });

    it("reports let-before-declare (forward reference)", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [
                    { kind: "ident", id: "i-x", name: "x" },
                    { kind: "let", id: "let-1", name: "x", value: { kind: "literal", id: "l-1", value: 5 } },
                ],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "undefined_reference",
            name: "x",
        });
    });

    it("reports out-of-scope let (from parent block)", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [
                    {
                        kind: "block", id: "b-1",
                        body: [
                            { kind: "let", id: "let-1", name: "inner", value: { kind: "literal", id: "l-1", value: 5 } },
                            { kind: "ident", id: "i-inner", name: "inner" },
                        ],
                    },
                    { kind: "ident", id: "i-oops", name: "inner" },
                ],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            error: "undefined_reference",
            name: "inner",
        });
    });

    it("reports undefined name in contract", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" },
                contracts: [{
                    kind: "pre", id: "pre-1",
                    condition: {
                        kind: "binop", id: "e-1", op: ">",
                        left: { kind: "ident", id: "i-y", name: "y" },
                        right: { kind: "literal", id: "l-0", value: 0 },
                    },
                }],
                body: [{ kind: "ident", id: "i-x", name: "x" }],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "undefined_reference", name: "y" });
    });

    it("reports duplicate record definition", () => {
        const errors = resolve(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [] },
                { kind: "record", id: "r-2", name: "Point", fields: [] },
            ],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "duplicate_definition", name: "Point" });
    });

    it("reports unknown ConstructorPattern name", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [{
                        kind: "arm", id: "a-1",
                        pattern: { kind: "constructor", name: "NonExistent", fields: [] },
                        body: [{ kind: "literal", id: "l-1", value: 0 }],
                    }],
                }],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "undefined_reference", name: "NonExistent" });
    });

    it("reports undefined reference with typo (Levenshtein)", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "calculate",
                params: [{ kind: "param", id: "p-1", name: "value", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "ident", id: "i-v", name: "valeu" }],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "undefined_reference", name: "valeu" });
        expect((errors[0] as any).candidates).toContain("value");
    });
});

describe("levenshtein", () => {
    // Quick sanity tests for the utility
    it("finds close matches", async () => {
        const { levenshteinDistance, findCandidates } = await import("../../src/resolver/levenshtein.js");
        expect(levenshteinDistance("kitten", "sitting")).toBe(3);
        expect(levenshteinDistance("", "abc")).toBe(3);
        expect(levenshteinDistance("abc", "abc")).toBe(0);

        const candidates = findCandidates("cont", ["count", "config", "contrast", "apple"]);
        expect(candidates).toContain("count");
        expect(candidates).not.toContain("apple");
    });
});
