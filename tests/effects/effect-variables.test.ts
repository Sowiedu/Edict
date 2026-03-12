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

// ---------------------------------------------------------------------------
// Effect polymorphism — inference and propagation
// ---------------------------------------------------------------------------

import { typeCheck } from "../../src/checker/check.js";

describe("effect polymorphism — inference and propagation", () => {
    /**
     * Helper: build a module with a HOF that takes a callback with effect variable E,
     * a caller that calls the HOF with a lambda, and optionally a built-in that
     * the lambda calls.
     */
    function mkHofModule(opts: {
        hofName: string;
        hofEffects: ConcreteEffect[];
        callerName: string;
        callerEffects: ConcreteEffect[];
        lambdaBody: any[];
        /** Extra definitions (e.g., effectful functions the lambda calls) */
        extraDefs?: any[];
    }): EdictModule {
        return mkModule([
            // The HOF: takes a callback f: (Int) -[E]-> Int
            {
                kind: "fn",
                id: `fn-${opts.hofName}`,
                name: opts.hofName,
                params: [
                    {
                        kind: "param",
                        id: `p-${opts.hofName}-f`,
                        name: "f",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: [{ kind: "effect_var", name: "E" }],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                ],
                effects: opts.hofEffects,
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    // HOF body: calls f (callback)
                    {
                        kind: "call",
                        id: `call-f-in-${opts.hofName}`,
                        fn: { kind: "ident", id: `id-f-in-${opts.hofName}`, name: "f" },
                        args: [{ kind: "literal", id: `l-${opts.hofName}`, value: 1 }],
                    },
                ],
            },
            // The caller: calls hofName(lambda(...) { ...lambdaBody })
            {
                kind: "fn",
                id: `fn-${opts.callerName}`,
                name: opts.callerName,
                params: [],
                effects: opts.callerEffects,
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    {
                        kind: "call",
                        id: `call-${opts.hofName}-in-${opts.callerName}`,
                        fn: { kind: "ident", id: `id-${opts.hofName}-in-${opts.callerName}`, name: opts.hofName },
                        args: [
                            {
                                kind: "lambda",
                                id: `lam-in-${opts.callerName}`,
                                params: [{ kind: "param", id: `lam-p-x`, name: "x" }],
                                body: opts.lambdaBody,
                            },
                        ],
                    },
                ],
            },
            ...(opts.extraDefs ?? []),
        ]);
    }

    it("HOF with pure lambda — no effects propagated", () => {
        const mod = mkHofModule({
            hofName: "apply",
            hofEffects: ["pure"],
            callerName: "main",
            callerEffects: ["pure"],
            lambdaBody: [
                // Pure lambda: just returns x
                { kind: "ident", id: "id-x-1", name: "x" },
            ],
        });

        const { errors: typeErrors, typeInfo } = typeCheck(mod);
        expect(typeErrors).toEqual([]);

        // No resolved effects for the call site (lambda is pure)
        expect(typeInfo.resolvedCallSiteEffects.size).toBe(0);

        const { errors } = effectCheck(mod, typeInfo);
        expect(errors).toEqual([]);
    });

    it("HOF with IO lambda — io propagated to call site", () => {
        const mod = mkHofModule({
            hofName: "apply",
            hofEffects: ["pure"],
            callerName: "main",
            callerEffects: ["io"],
            lambdaBody: [
                // Lambda calls print (builtin with io effect) then returns x
                {
                    kind: "let",
                    id: "let-discard",
                    name: "_",
                    value: {
                        kind: "call",
                        id: "call-print",
                        fn: { kind: "ident", id: "id-print", name: "print" },
                        args: [{ kind: "literal", id: "l-str", value: "hello" }],
                    },
                },
                { kind: "ident", id: "id-x-ret", name: "x" },
            ],
        });

        const { errors: typeErrors, typeInfo } = typeCheck(mod);
        expect(typeErrors).toEqual([]);

        // Effect variable E was resolved to [io] at the call site
        const callSiteId = "call-apply-in-main";
        const resolved = typeInfo.resolvedCallSiteEffects.get(callSiteId);
        expect(resolved).toBeDefined();
        expect(resolved).toContain("io");

        // Caller has [io] — should pass
        const { errors } = effectCheck(mod, typeInfo);
        expect(errors).toEqual([]);
    });

    it("pure caller + HOF with IO lambda → effect_in_pure", () => {
        const mod = mkHofModule({
            hofName: "apply",
            hofEffects: ["pure"],
            callerName: "main",
            callerEffects: ["pure"],
            lambdaBody: [
                {
                    kind: "let",
                    id: "let-discard",
                    name: "_",
                    value: {
                        kind: "call",
                        id: "call-print",
                        fn: { kind: "ident", id: "id-print", name: "print" },
                        args: [{ kind: "literal", id: "l-str", value: "hello" }],
                    },
                },
                { kind: "ident", id: "id-x-ret", name: "x" },
            ],
        });

        const { errors: typeErrors, typeInfo } = typeCheck(mod);
        expect(typeErrors).toEqual([]);

        // Effect variable E resolved to [io]
        expect(typeInfo.resolvedCallSiteEffects.get("call-apply-in-main")).toContain("io");

        // Caller is pure but call site introduces io → effect error
        const { errors } = effectCheck(mod, typeInfo);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        const effError = errors.find(
            (e: any) => (e.error === "effect_in_pure" || e.error === "effect_violation")
                && e.functionName === "main",
        );
        expect(effError).toBeDefined();
    });

    it("caller with [reads] + HOF resolving to [io] → effect_violation", () => {
        const mod = mkHofModule({
            hofName: "apply",
            hofEffects: ["pure"],
            callerName: "main",
            callerEffects: ["reads"],
            lambdaBody: [
                {
                    kind: "let",
                    id: "let-discard",
                    name: "_",
                    value: {
                        kind: "call",
                        id: "call-print",
                        fn: { kind: "ident", id: "id-print", name: "print" },
                        args: [{ kind: "literal", id: "l-str", value: "hello" }],
                    },
                },
                { kind: "ident", id: "id-x-ret", name: "x" },
            ],
        });

        const { errors: typeErrors, typeInfo } = typeCheck(mod);
        expect(typeErrors).toEqual([]);

        const { errors } = effectCheck(mod, typeInfo);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        const violation = errors.find(
            (e: any) => e.error === "effect_violation" && e.functionName === "main",
        );
        expect(violation).toBeDefined();
        expect((violation as any).missingEffects).toContain("io");
    });

    it("HOF with no lambda arg — no extra effects", () => {
        // Caller passes an ident (not a lambda) — effect variable not unified
        const mod: EdictModule = mkModule([
            {
                kind: "fn",
                id: "fn-apply",
                name: "apply",
                params: [
                    {
                        kind: "param",
                        id: "p-f",
                        name: "f",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: [{ kind: "effect_var", name: "E" }],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                ],
                effects: ["pure"],
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
            {
                kind: "fn",
                id: "fn-identity",
                name: "identity",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "ident", id: "id-x", name: "x" }],
            },
            {
                kind: "fn",
                id: "fn-main",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    {
                        kind: "call",
                        id: "call-apply",
                        fn: { kind: "ident", id: "id-apply", name: "apply" },
                        args: [{ kind: "ident", id: "id-identity", name: "identity" }],
                    },
                ],
            },
        ]);

        const { errors: typeErrors, typeInfo } = typeCheck(mod);
        expect(typeErrors).toEqual([]);

        // No resolved effects (arg is ident, not lambda)
        expect(typeInfo.resolvedCallSiteEffects.size).toBe(0);

        const { errors } = effectCheck(mod, typeInfo);
        expect(errors).toEqual([]);
    });

    it("multiple effect variables resolved independently", () => {
        // HOF takes two callbacks with different effect variables
        const mod: EdictModule = mkModule([
            {
                kind: "fn",
                id: "fn-compose",
                name: "compose",
                params: [
                    {
                        kind: "param",
                        id: "p-f",
                        name: "f",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: [{ kind: "effect_var", name: "E" }],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                    {
                        kind: "param",
                        id: "p-g",
                        name: "g",
                        type: {
                            kind: "fn_type",
                            params: [{ kind: "basic", name: "Int" }],
                            effects: [{ kind: "effect_var", name: "F" }],
                            returnType: { kind: "basic", name: "Int" },
                        },
                    },
                ],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "l-compose", value: 42 }],
            },
            {
                kind: "fn",
                id: "fn-main",
                name: "main",
                params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    {
                        kind: "call",
                        id: "call-compose",
                        fn: { kind: "ident", id: "id-compose", name: "compose" },
                        args: [
                            // f: pure lambda
                            {
                                kind: "lambda",
                                id: "lam-f",
                                params: [{ kind: "param", id: "lam-f-x", name: "x" }],
                                body: [{ kind: "ident", id: "id-f-x", name: "x" }],
                            },
                            // g: io lambda (calls print)
                            {
                                kind: "lambda",
                                id: "lam-g",
                                params: [{ kind: "param", id: "lam-g-x", name: "x" }],
                                body: [
                                    {
                                        kind: "let",
                                        id: "let-discard-g",
                                        name: "_",
                                        value: {
                                            kind: "call",
                                            id: "call-print-g",
                                            fn: { kind: "ident", id: "id-print-g", name: "print" },
                                            args: [{ kind: "literal", id: "l-str-g", value: "hi" }],
                                        },
                                    },
                                    { kind: "ident", id: "id-g-x-ret", name: "x" },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);

        const { errors: typeErrors, typeInfo } = typeCheck(mod);
        expect(typeErrors).toEqual([]);

        // Only E→pure (nothing), F→io should be resolved
        const resolved = typeInfo.resolvedCallSiteEffects.get("call-compose");
        expect(resolved).toBeDefined();
        expect(resolved).toContain("io");

        // Caller has [io] — should pass
        const { errors } = effectCheck(mod, typeInfo);
        expect(errors).toEqual([]);
    });
});
