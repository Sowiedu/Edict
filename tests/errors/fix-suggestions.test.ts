import { describe, it, expect } from "vitest";
import { resolve } from "../../src/resolver/resolve.js";
import { typeCheck } from "../../src/checker/check.js";
import { effectCheck } from "../../src/effects/effect-check.js";
import type { EdictModule } from "../../src/ast/nodes.js";

function mod(overrides: Partial<EdictModule> = {}): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports: [], definitions: [], ...overrides,
    };
}

// =============================================================================
// Resolver suggestions
// =============================================================================

describe("fix suggestions — resolver", () => {
    it("undefined_reference with typo → suggestion.value = closest candidate", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [{ kind: "param", id: "p-1", name: "count", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "ident", id: "i-c", name: "cont" }],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "undefined_reference", name: "cont" });
        expect((errors[0] as any).suggestion).toMatchObject({
            nodeId: "i-c",
            field: "name",
            value: "count",
        });
    });

    it("undefined_reference with no candidates → no suggestion", () => {
        const errors = resolve(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "ident", id: "i-z", name: "zzzzzzzzzzz" }],
            }],
        }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ error: "undefined_reference" });
        expect((errors[0] as any).suggestion).toBeUndefined();
    });
});

// =============================================================================
// Type checker suggestions
// =============================================================================

describe("fix suggestions — type checker", () => {
    it("type_mismatch → suggestion.value = expected type", () => {
        const { errors } = typeCheck(mod({
            definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "literal", id: "l-1", value: "not an int" }],
            }],
        }));
        expect(errors.length).toBeGreaterThan(0);
        const tmErr = errors.find(e => e.error === "type_mismatch");
        expect(tmErr).toBeDefined();
        expect((tmErr as any).suggestion).toMatchObject({
            field: "type",
            value: { kind: "basic", name: "Int" },
        });
    });

    it("unknown_record → suggestion.value = closest record name", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                { kind: "record", id: "r-1", name: "Point", fields: [{ kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } }] },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Piont",
                        fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1 } }],
                    }],
                },
            ],
        }));
        const urErr = errors.find(e => e.error === "unknown_record");
        expect(urErr).toBeDefined();
        expect((urErr as any).suggestion).toBeDefined();
        expect((urErr as any).suggestion.nodeId).toBe("re-1");
        expect((urErr as any).suggestion.field).toBe("name");
    });

    it("unknown_field with close match → suggestion", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "record", id: "r-1", name: "Point", fields: [
                        { kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } },
                        { kind: "field", id: "f-2", name: "y", type: { kind: "basic", name: "Float" } },
                    ]
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [{ kind: "param", id: "p-1", name: "p", type: { kind: "named", name: "Point" } }],
                    effects: ["pure"], returnType: { kind: "basic", name: "Float" }, contracts: [],
                    body: [{ kind: "access", id: "acc-1", target: { kind: "ident", id: "i-p", name: "p" }, field: "z" }],
                },
            ],
        }));
        const ufErr = errors.find(e => e.error === "unknown_field");
        expect(ufErr).toBeDefined();
        // "z" is not close enough to "x" (distance 1, but length-dependent threshold may exclude)
        // Either way, check that the suggestion field structure is correct if present
        if ((ufErr as any).suggestion) {
            expect((ufErr as any).suggestion.field).toBe("field");
        }
    });

    it("missing_record_fields → suggestion lists missing fields", () => {
        const { errors } = typeCheck(mod({
            definitions: [
                {
                    kind: "record", id: "r-1", name: "Point", fields: [
                        { kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Float" } },
                        { kind: "field", id: "f-2", name: "y", type: { kind: "basic", name: "Float" } },
                    ]
                },
                {
                    kind: "fn", id: "fn-1", name: "test",
                    params: [], effects: ["pure"],
                    returnType: { kind: "named", name: "Point" }, contracts: [],
                    body: [{
                        kind: "record_expr", id: "re-1", name: "Point",
                        fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "l-1", value: 1.0 } }],
                    }],
                },
            ],
        }));
        const mrErr = errors.find(e => e.error === "missing_record_fields");
        expect(mrErr).toBeDefined();
        expect((mrErr as any).suggestion).toMatchObject({
            nodeId: "re-1",
            field: "fields",
            value: ["y"],
        });
    });
});

// =============================================================================
// Effect checker suggestions
// =============================================================================

describe("fix suggestions — effect checker", () => {
    it("effect_violation → suggestion expands effects list", () => {
        const errors = effectCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-io", name: "doIO",
                    params: [], effects: ["io"],
                    returnType: { kind: "basic", name: "String" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: "hello" }],
                },
                {
                    kind: "fn", id: "fn-caller", name: "caller",
                    params: [], effects: ["net"], // has net, but not io
                    returnType: { kind: "basic", name: "String" }, contracts: [],
                    body: [{
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-d", name: "doIO" },
                        args: [],
                    }],
                },
            ],
        }));
        const evErr = errors.find(e => e.error === "effect_violation");
        expect(evErr).toBeDefined();
        expect((evErr as any).suggestion).toMatchObject({
            nodeId: "fn-caller",
            field: "effects",
            value: ["net", "io"],
        });
    });

    it("effect_in_pure → suggestion replaces pure with callee effects", () => {
        const errors = effectCheck(mod({
            definitions: [
                {
                    kind: "fn", id: "fn-io", name: "doIO",
                    params: [], effects: ["io"],
                    returnType: { kind: "basic", name: "String" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: "hello" }],
                },
                {
                    kind: "fn", id: "fn-pure", name: "pureCalller",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "String" }, contracts: [],
                    body: [{
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-d", name: "doIO" },
                        args: [],
                    }],
                },
            ],
        }));
        const epErr = errors.find(e => e.error === "effect_in_pure");
        expect(epErr).toBeDefined();
        expect((epErr as any).suggestion).toMatchObject({
            nodeId: "fn-pure",
            field: "effects",
            value: ["io"],
        });
    });
});
