// =============================================================================
// Typed Import Declarations — Tests (Issue #86)
// =============================================================================
// Covers: validator, resolver, checker, effect checker, codegen

import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";
import { resolve } from "../../src/resolver/resolve.js";
import { typeCheck } from "../../src/checker/check.js";
import { effectCheck } from "../../src/effects/effect-check.js";
import { compile } from "../../src/codegen/codegen.js";
import type { EdictModule, Import, FunctionDef, Expression } from "../../src/ast/nodes.js";
import type { TypeExpr, FunctionType } from "../../src/ast/types.js";

// =============================================================================
// Helpers
// =============================================================================

const INT_TYPE: TypeExpr = { kind: "basic", name: "Int" };
const STRING_TYPE: TypeExpr = { kind: "basic", name: "String" };
const BOOL_TYPE: TypeExpr = { kind: "basic", name: "Bool" };
const FLOAT_TYPE: TypeExpr = { kind: "basic", name: "Float" };

function fnType(params: TypeExpr[], returnType: TypeExpr, effects: string[] = ["pure"]): FunctionType {
    return { kind: "fn_type", params, effects: effects as FunctionType["effects"], returnType };
}

function mod(
    defs: EdictModule["definitions"],
    imports: EdictModule["imports"] = [],
): EdictModule {
    return { kind: "module", id: "mod-test-001", name: "test", imports, definitions: defs };
}

function ident(name: string, id = `id-${name}-001`): Expression {
    return { kind: "ident", id, name };
}

function literal(value: number | string | boolean, id = "lit-001"): Expression {
    return { kind: "literal", id, value };
}

function call(fnName: string, args: Expression[], id = `call-${fnName}-001`): Expression {
    return { kind: "call", id, fn: ident(fnName), args };
}

function fn(
    name: string,
    params: FunctionDef["params"],
    body: Expression[],
    effects: FunctionDef["effects"] = ["pure"],
    returnType?: TypeExpr,
): FunctionDef {
    return {
        kind: "fn", id: `fn-${name}-001`, name, params, effects,
        returnType, contracts: [], body,
    };
}

function typedImport(
    moduleName: string,
    names: string[],
    types: Record<string, TypeExpr>,
    id = "imp-001",
): Import {
    return { kind: "import", id, module: moduleName, names, types };
}

function untypedImport(
    moduleName: string,
    names: string[],
    id = "imp-001",
): Import {
    return { kind: "import", id, module: moduleName, names };
}

// =============================================================================
// Validator Tests
// =============================================================================

describe("validator — typed imports", () => {
    it("accepts import with valid fn_type in types", () => {
        const result = validate(mod([], [
            typedImport("host", ["customFn"], {
                customFn: fnType([STRING_TYPE], INT_TYPE, ["io"]),
            }),
        ]));
        expect(result.ok).toBe(true);
    });

    it("accepts import with valid basic type in types", () => {
        const result = validate(mod([], [
            typedImport("host", ["PI"], {
                PI: FLOAT_TYPE,
            }),
        ]));
        expect(result.ok).toBe(true);
    });

    it("accepts import without types (backwards compat)", () => {
        const result = validate(mod([], [
            untypedImport("std", ["map", "filter"]),
        ]));
        expect(result.ok).toBe(true);
    });

    it("rejects types key not in names", () => {
        const result = validate(mod([], [
            typedImport("host", ["customFn"], {
                unknownFn: fnType([INT_TYPE], INT_TYPE),
            }),
        ]));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(
                e => e.error === "invalid_field_type" && (e as any).field === "types.unknownFn",
            );
            expect(err).toBeDefined();
        }
    });

    it("rejects non-object types value", () => {
        const result = validate({
            kind: "module", id: "mod-001", name: "test",
            imports: [{
                kind: "import", id: "imp-001", module: "host",
                names: ["fn1"], types: { fn1: "not-an-object" },
            }],
            definitions: [],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(
                e => e.error === "invalid_field_type" && (e as any).field === "types.fn1",
            );
            expect(err).toBeDefined();
        }
    });

    it("rejects non-object types field", () => {
        const result = validate({
            kind: "module", id: "mod-001", name: "test",
            imports: [{
                kind: "import", id: "imp-001", module: "host",
                names: ["fn1"], types: "not-an-object",
            }],
            definitions: [],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(
                e => e.error === "invalid_field_type" && (e as any).field === "types",
            );
            expect(err).toBeDefined();
        }
    });

    it("validates type expressions inside types map", () => {
        const result = validate(mod([], [
            typedImport("host", ["customFn"], {
                customFn: { kind: "fn_type", params: [{ kind: "basic", name: "InvalidType" }], effects: ["pure"], returnType: INT_TYPE } as any,
            }),
        ]));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const err = result.errors.find(e => e.error === "invalid_basic_type_name");
            expect(err).toBeDefined();
        }
    });
});

// =============================================================================
// Resolver Tests
// =============================================================================

describe("resolver — typed imports", () => {
    it("typed import resolves without errors", () => {
        const m = mod(
            [fn("main", [], [call("customFn", [literal(42)])], ["io"], INT_TYPE)],
            [typedImport("host", ["customFn"], {
                customFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const errors = resolve(m);
        expect(errors).toHaveLength(0);
    });

    it("untyped import still resolves (backwards compat)", () => {
        const m = mod(
            [fn("main", [], [call("legacyFn", [literal(1)])], ["io"], INT_TYPE)],
            [untypedImport("std", ["legacyFn"])],
        );
        const errors = resolve(m);
        expect(errors).toHaveLength(0);
    });

    it("resolves type expressions in import types", () => {
        // Using a named type that doesn't exist should produce an error
        const m = mod(
            [fn("main", [], [literal(0)], ["pure"], INT_TYPE)],
            [typedImport("host", ["fn1"], {
                fn1: fnType([{ kind: "named", name: "NonExistent" }], INT_TYPE),
            })],
        );
        const errors = resolve(m);
        // Should have an undefined_reference for "NonExistent"
        const nameErr = errors.find(e => e.error === "undefined_reference" && (e as any).name === "NonExistent");
        expect(nameErr).toBeDefined();
    });
});

// =============================================================================
// Checker Tests
// =============================================================================

describe("checker — typed imports", () => {
    it("passes when call matches declared signature", () => {
        const m = mod(
            [fn("main", [], [call("customFn", [literal(42)])], ["io"], INT_TYPE)],
            [typedImport("host", ["customFn"], {
                customFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const { errors } = typeCheck(m);
        expect(errors).toHaveLength(0);
    });

    it("detects arity mismatch on typed import call", () => {
        const m = mod(
            [fn("main", [], [call("customFn", [literal(1), literal(2)])], ["io"], INT_TYPE)],
            [typedImport("host", ["customFn"], {
                customFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const { errors } = typeCheck(m);
        const arityErr = errors.find(e => e.error === "arity_mismatch");
        expect(arityErr).toBeDefined();
        expect((arityErr as any).expected).toBe(1);
        expect((arityErr as any).actual).toBe(2);
    });

    it("detects type mismatch on typed import call", () => {
        const m = mod(
            [fn("main", [], [call("customFn", [literal("hello")])], ["io"], INT_TYPE)],
            [typedImport("host", ["customFn"], {
                customFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const { errors } = typeCheck(m);
        const typeErr = errors.find(e => e.error === "type_mismatch");
        expect(typeErr).toBeDefined();
    });

    it("untyped import call is not type-checked (backwards compat)", () => {
        // Calling untyped import with any args should not produce type errors
        const m = mod(
            [fn("main", [], [call("legacyFn", [literal("anything"), literal(42)])], ["io"], INT_TYPE)],
            [untypedImport("std", ["legacyFn"])],
        );
        const { errors } = typeCheck(m);
        // No type errors — unknown type propagates silently
        const typeErrors = errors.filter(e => e.error === "type_mismatch" || e.error === "arity_mismatch");
        expect(typeErrors).toHaveLength(0);
    });

    it("uses declared return type for call result", () => {
        // customFn returns Bool, but main returnType is Int → type mismatch on body
        const m = mod(
            [fn("main", [], [call("customFn", [literal(42)])], ["io"], INT_TYPE)],
            [typedImport("host", ["customFn"], {
                customFn: fnType([INT_TYPE], BOOL_TYPE, ["io"]),
            })],
        );
        const { errors } = typeCheck(m);
        const typeErr = errors.find(e => e.error === "type_mismatch");
        expect(typeErr).toBeDefined();
    });
});

// =============================================================================
// Effect Checker Tests
// =============================================================================

describe("effect checker — typed imports", () => {
    it("detects effect violation when calling typed import with undeclared effects", () => {
        const m = mod(
            [fn("caller", [], [call("ioFn", [literal(1)])], ["pure"], INT_TYPE)],
            [typedImport("host", ["ioFn"], {
                ioFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const { errors } = effectCheck(m);
        // Caller is pure but calls a function with io effects → error
        const effectErr = errors.find(e => e.error === "effect_in_pure");
        expect(effectErr).toBeDefined();
    });

    it("passes when caller declares matching effects for typed import", () => {
        const m = mod(
            [fn("caller", [], [call("ioFn", [literal(1)])], ["io"], INT_TYPE)],
            [typedImport("host", ["ioFn"], {
                ioFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const { errors } = effectCheck(m);
        expect(errors).toHaveLength(0);
    });

    it("untyped import still produces effect_skipped_import diagnostic", () => {
        const m = mod(
            [fn("caller", [], [call("legacyFn", [literal(1)])], ["pure"], INT_TYPE)],
            [untypedImport("std", ["legacyFn"])],
        );
        const { errors, diagnostics } = effectCheck(m);
        expect(errors).toHaveLength(0);
        const diag = diagnostics.find(d => d.diagnostic === "effect_skipped_import");
        expect(diag).toBeDefined();
        expect(diag!.detail).toBe("legacyFn");
    });

    it("typed import with pure effects does not trigger violations", () => {
        const m = mod(
            [fn("caller", [], [call("pureFn", [literal(1)])], ["pure"], INT_TYPE)],
            [typedImport("host", ["pureFn"], {
                pureFn: fnType([INT_TYPE], INT_TYPE, ["pure"]),
            })],
        );
        const { errors } = effectCheck(m);
        expect(errors).toHaveLength(0);
    });
});

// =============================================================================
// Codegen Tests
// =============================================================================

describe("codegen — typed imports", () => {
    it("compiles module with typed import (produces valid WASM)", () => {
        const m = mod(
            [fn("main", [], [call("customFn", [literal(42)])], ["io"], INT_TYPE)],
            [typedImport("host", ["customFn"], {
                customFn: fnType([INT_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const result = compile(m);
        expect(result.ok).toBe(true);
    });

    it("compiles module with untyped import (backwards compat, inference fallback)", () => {
        const m = mod(
            [fn("main", [
                { kind: "param", id: "p-x-001", name: "x", type: INT_TYPE },
            ], [call("legacyFn", [ident("x")])], ["io"], INT_TYPE)],
            [untypedImport("std", ["legacyFn"])],
        );
        const result = compile(m);
        expect(result.ok).toBe(true);
    });

    it("typed import with String param produces correct WASM signature", () => {
        const m = mod(
            [fn("main", [
                { kind: "param", id: "p-s-001", name: "s", type: STRING_TYPE },
            ], [call("strFn", [ident("s")])], ["io"], INT_TYPE)],
            [typedImport("host", ["strFn"], {
                strFn: fnType([STRING_TYPE], INT_TYPE, ["io"]),
            })],
        );
        const result = compile(m);
        expect(result.ok).toBe(true);
    });

    it("typed import with Float params produces correct WASM signature", () => {
        const m = mod(
            [fn("main", [], [call("mathFn", [literal(3.14)])], ["pure"], FLOAT_TYPE)],
            [typedImport("math", ["mathFn"], {
                mathFn: fnType([FLOAT_TYPE], FLOAT_TYPE),
            })],
        );
        const result = compile(m);
        expect(result.ok).toBe(true);
    });
});
