// =============================================================================
// Browser Bundle Tests — verify the browser entry point works correctly
// =============================================================================
// Imports from the browser entry point and validates that all exported
// pipeline functions work without any Node.js APIs.

import { describe, it, expect } from "vitest";
import {
    validate,
    resolve,
    typeCheck,
    effectCheck,
    complexityCheck,
    checkBrowser,
    lint,
    applyPatches,
    expandCompact,
    isCompactAst,
    migrateToLatest,
    buildErrorCatalog,
    explainError,
    compose,
    BUILTIN_FUNCTIONS,
    CURRENT_SCHEMA_VERSION,
} from "../../src/browser.js";
import type { CheckBrowserResult } from "../../src/browser.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid module: fn main() -> Int { 42 } */
const validModule = {
    kind: "module",
    id: "mod-001",
    name: "test",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main-001",
        name: "main",
        params: [],
        effects: ["io"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{ kind: "literal", id: "lit-001", value: 42 }],
    }],
};

/** Invalid module: missing required fields */
const invalidModule = {
    kind: "module",
    name: "test",
    definitions: [{ kind: "function", id: "fn-001", name: "main" }],
};

/** Module with a type error: returns String where Int expected */
const typeErrorModule = {
    kind: "module",
    id: "mod-002",
    name: "test",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main-002",
        name: "main",
        params: [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{ kind: "literal", id: "lit-002", value: "hello" }],
    }],
};

/** Module with an effect violation: pure fn calls print (io) */
const effectErrorModule = {
    kind: "module",
    id: "mod-003",
    name: "test",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main-003",
        name: "main",
        params: [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "String" },
        contracts: [],
        body: [{
            kind: "call",
            id: "call-001",
            fn: { kind: "ident", id: "id-print-001", name: "print" },
            args: [{ kind: "literal", id: "lit-003", value: "hello" }],
        }],
    }],
};

// ---------------------------------------------------------------------------
// Phase 1 — Validation
// ---------------------------------------------------------------------------

describe("browser: validate", () => {
    it("accepts a valid module", () => {
        const result = validate(validModule);
        expect(result.ok).toBe(true);
    });

    it("rejects an invalid module with structured errors", () => {
        const result = validate(invalidModule);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]!.error).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Phase 2a — Name Resolution
// ---------------------------------------------------------------------------

describe("browser: resolve", () => {
    it("resolves a valid module with no errors", () => {
        const errors = resolve(validModule as never);
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Phase 2b — Type Checking
// ---------------------------------------------------------------------------

describe("browser: typeCheck", () => {
    it("type checks a valid module", () => {
        const { errors, typeInfo } = typeCheck(validModule as never);
        expect(errors).toHaveLength(0);
        expect(typeInfo).toBeDefined();
    });

    it("reports type errors for mismatched return type", () => {
        // Resolve first (typeCheck expects resolved AST)
        resolve(typeErrorModule as never);
        const { errors } = typeCheck(typeErrorModule as never);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]!.error).toBe("type_mismatch");
    });
});

// ---------------------------------------------------------------------------
// Phase 2c — Complexity Checking
// ---------------------------------------------------------------------------

describe("browser: complexityCheck", () => {
    it("passes a module with no constraints", () => {
        const errors = complexityCheck(validModule as never);
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Phase 3 — Effect Checking
// ---------------------------------------------------------------------------

describe("browser: effectCheck", () => {
    it("effect checks a valid module", () => {
        const result = effectCheck(validModule as never);
        expect(result.errors).toHaveLength(0);
    });

    it("detects effect violation in pure function", () => {
        resolve(effectErrorModule as never);
        const result = effectCheck(effectErrorModule as never);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// checkBrowser — Full browser-safe pipeline
// ---------------------------------------------------------------------------

describe("browser: checkBrowser", () => {
    it("checks a valid module end-to-end", () => {
        const result: CheckBrowserResult = checkBrowser(validModule);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.module).toBeDefined();
        expect(result.typeInfo).toBeDefined();
    });

    it("returns validation errors for invalid AST", () => {
        const result = checkBrowser(invalidModule);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("returns type errors for type mismatch", () => {
        const result = checkBrowser(typeErrorModule);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    it("returns effect errors for effect violation", () => {
        const result = checkBrowser(effectErrorModule);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.error === "effect_in_pure" || e.error === "effect_violation")).toBe(true);
    });

    it("is synchronous (no Promise returned)", () => {
        const result = checkBrowser(validModule);
        // checkBrowser returns CheckBrowserResult directly, not a Promise
        expect(result).not.toBeInstanceOf(Promise);
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

describe("browser: lint", () => {
    it("produces warnings for known lint patterns", () => {
        // Module with unused variable
        const moduleWithUnused = {
            kind: "module",
            id: "mod-lint",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-main-lint",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [
                    { kind: "let", id: "let-unused", name: "unused", type: { kind: "basic", name: "Int" }, value: { kind: "literal", id: "lit-unused", value: 42 } },
                    { kind: "literal", id: "lit-ret", value: 0 },
                ],
            }],
        };
        const warnings = lint(moduleWithUnused as never);
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some(w => w.warning === "unused_variable")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Patch Engine
// ---------------------------------------------------------------------------

describe("browser: applyPatches", () => {
    it("applies a replace patch", () => {
        const ast = JSON.parse(JSON.stringify(validModule));
        const result = applyPatches(ast, [
            { nodeId: "fn-main-001", op: "replace", field: "name", value: "renamed" },
        ]);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const patched = result.ast as typeof validModule;
            expect(patched.definitions[0]!.name).toBe("renamed");
        }
    });
});

// ---------------------------------------------------------------------------
// Compact AST
// ---------------------------------------------------------------------------

describe("browser: compact AST", () => {
    it("detects non-compact AST", () => {
        expect(isCompactAst(validModule)).toBe(false);
    });

    it("expands a compact AST", () => {
        const compact = { k: "module", i: "mod-c", n: "test", im: [], d: [] };
        const expanded = expandCompact(compact);
        expect(expanded.kind).toBe("module");
    });
});

// ---------------------------------------------------------------------------
// Error Catalog & Explain
// ---------------------------------------------------------------------------

describe("browser: error catalog", () => {
    it("builds the error catalog", () => {
        const catalog = buildErrorCatalog();
        expect(catalog.count).toBeGreaterThan(0);
        expect(catalog.errors.length).toBe(catalog.count);
    });
});

describe("browser: explainError", () => {
    it("explains a known error type", () => {
        const result = explainError({ error: "type_mismatch" });
        expect(result.found).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

describe("browser: compose", () => {
    it("composes fragments into a module", () => {
        const fragment = {
            kind: "fragment",
            id: "frag-001",
            provides: ["add"],
            requires: [],
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-add-001",
                name: "add",
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "binop",
                    id: "bin-add",
                    op: "+",
                    left: { kind: "ident", id: "id-a", name: "a" },
                    right: { kind: "ident", id: "id-b", name: "b" },
                }],
            }],
        };
        const result = compose([fragment as never], "composed");
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe("browser: migration", () => {
    it("exports CURRENT_SCHEMA_VERSION", () => {
        expect(CURRENT_SCHEMA_VERSION).toBeDefined();
        expect(typeof CURRENT_SCHEMA_VERSION).toBe("string");
    });

    it("migrates a v1.0 module to latest", () => {
        const oldModule = {
            kind: "module",
            id: "mod-old",
            name: "test",
            schemaVersion: "1.0",
            imports: [],
            definitions: [],
        };
        const result = migrateToLatest(oldModule);
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Builtins
// ---------------------------------------------------------------------------

describe("browser: builtins", () => {
    it("exports BUILTIN_FUNCTIONS map", () => {
        expect(BUILTIN_FUNCTIONS.size).toBeGreaterThan(0);
        expect(BUILTIN_FUNCTIONS.has("print")).toBe(true);
    });
});
