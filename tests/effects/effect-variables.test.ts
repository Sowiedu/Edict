import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";
import { effectCheck } from "../../src/effects/effect-check.js";
import type { EdictModule, FunctionDef, ConcreteEffect } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkModule(defs: EdictModule["definitions"]): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports: [],
        definitions: defs,
    };
}

function mkFnWithCallbackType(
    fnName: string,
    callbackEffects: unknown[],
    fnEffects: ConcreteEffect[] = ["pure"],
): EdictModule {
    return mkModule([
        {
            kind: "fn",
            id: `fn-${fnName}`,
            name: fnName,
            params: [
                {
                    kind: "param",
                    id: "p1",
                    name: "f",
                    type: {
                        kind: "fn_type",
                        params: [{ kind: "basic", name: "Int" }],
                        effects: callbackEffects as any,
                        returnType: { kind: "basic", name: "Int" },
                    },
                },
            ],
            effects: fnEffects,
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "literal", id: "l1", value: 42 }],
        },
    ]);
}

// ---------------------------------------------------------------------------
// Valid programs — effect variables in fn_type
// ---------------------------------------------------------------------------

describe("effect variables — validation", () => {
    it("fn_type with a single effect variable passes validation", () => {
        const mod = mkFnWithCallbackType("map", [
            { kind: "effect_var", name: "E" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(true);
    });

    it("fn_type with mixed concrete + effect variable passes", () => {
        const mod = mkFnWithCallbackType("run", [
            "io",
            { kind: "effect_var", name: "F" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(true);
    });

    it("fn_type with multiple effect variables passes", () => {
        const mod = mkFnWithCallbackType("compose", [
            { kind: "effect_var", name: "E" },
            { kind: "effect_var", name: "F" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(true);
    });

    it("fn definition with concrete effects still passes", () => {
        const mod = mkModule([
            {
                kind: "fn",
                id: "fn-greet",
                name: "greet",
                params: [],
                effects: ["io"] as ConcreteEffect[],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "l1", value: 1 }],
            },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Invalid programs — effect variable validation errors
// ---------------------------------------------------------------------------

describe("effect variables — validation errors", () => {
    it("rejects effect variable with invalid name (lowercase)", () => {
        const mod = mkFnWithCallbackType("bad", [
            { kind: "effect_var", name: "foo" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
            const nameError = result.errors.find(
                (e: any) => e.error === "invalid_field_type" && e.field === "name",
            );
            expect(nameError).toBeDefined();
        }
    });

    it("rejects effect variable with multi-character name", () => {
        const mod = mkFnWithCallbackType("bad", [
            { kind: "effect_var", name: "EF" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(false);
    });

    it("rejects effect variable with empty name", () => {
        const mod = mkFnWithCallbackType("bad", [
            { kind: "effect_var", name: "" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(false);
    });

    it("pure + effect variable in fn_type → conflicting_effects", () => {
        const mod = mkFnWithCallbackType("bad", [
            "pure",
            { kind: "effect_var", name: "E" },
        ]);
        const result = validate(mod);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const conflict = result.errors.find(
                (e: any) => e.error === "conflicting_effects",
            );
            expect(conflict).toBeDefined();
        }
    });
});

// ---------------------------------------------------------------------------
// Effect checker — doesn't crash with effect variables in fn_type
// ---------------------------------------------------------------------------

describe("effect variables — effect checker compatibility", () => {
    it("effect checker succeeds on module with fn_type effect variables", () => {
        // Pure function that takes a callback with effect variable — no calls in body
        const mod = mkFnWithCallbackType("transform", [
            { kind: "effect_var", name: "E" },
        ], ["pure"]);
        // Run through validation first
        const valResult = validate(mod);
        expect(valResult.ok).toBe(true);
        // Effect check should not crash
        const { errors } = effectCheck(mod as EdictModule);
        expect(errors).toEqual([]);
    });

    it("effect checker handles fn with callback call — skips unknown callee", () => {
        const mod: EdictModule = {
            kind: "module",
            id: "mod-test",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-apply",
                    name: "apply",
                    params: [
                        {
                            kind: "param",
                            id: "p1",
                            name: "f",
                            type: {
                                kind: "fn_type",
                                params: [{ kind: "basic", name: "Int" }],
                                effects: [{ kind: "effect_var", name: "E" }],
                                returnType: { kind: "basic", name: "Int" },
                            },
                        },
                    ],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-f",
                            fn: { kind: "ident", id: "id-f", name: "f" },
                            args: [{ kind: "literal", id: "l1", value: 1 }],
                        },
                    ],
                },
            ],
        };
        const { errors, diagnostics } = effectCheck(mod);
        // f is a parameter, not a defined function — effect checker skips it
        expect(errors).toEqual([]);
        expect(diagnostics.length).toBeGreaterThanOrEqual(1);
        expect(diagnostics[0]).toMatchObject({
            diagnostic: "effect_skipped_unknown_callee",
            detail: "f",
        });
    });
});
