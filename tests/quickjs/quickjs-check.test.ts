// =============================================================================
// QuickJS Self-Hosting PoC Tests — check pipeline inside QuickJS-WASM
// =============================================================================
// Verifies that the Edict check pipeline (phases 1–3) runs correctly inside
// a QuickJS-WASM interpreter. Tests 3 example programs plus error handling.
//
// Prerequisites: dist/edict-quickjs-check.js must exist (run build first).
// The bundle is built by: tsx scripts/build-quickjs-bundle.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { EdictQuickJS } from "../../src/quickjs/edict-quickjs.js";

// ---------------------------------------------------------------------------
// Setup — create a shared EdictQuickJS instance (expensive to init)
// ---------------------------------------------------------------------------

const BUNDLE_PATH = resolve("dist/edict-quickjs-check.js");
let edict: EdictQuickJS;

// Skip all tests if the QuickJS bundle hasn't been built
const bundleExists = existsSync(BUNDLE_PATH);

describe.skipIf(!bundleExists)("QuickJS self-hosting PoC", () => {
    beforeAll(async () => {
        edict = await EdictQuickJS.create();
    }, 30_000); // QuickJS init + bundle load can take a few seconds

    afterAll(() => {
        edict?.dispose();
    });

    // ── Criterion: PoC validates + type-checks at least 3 example programs ──

    it("checks fibonacci.edict.json (recursive fn with contracts)", () => {
        const ast = loadExample("fibonacci.edict.json");
        const result = edict.check(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.module).toBeDefined();
        expect(result.module.kind).toBe("module");
        expect(result.typeInfo).toBeDefined();
    });

    it("checks hello.edict.json (basic IO)", () => {
        const ast = loadExample("hello.edict.json");
        const result = edict.check(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.module).toBeDefined();
    });

    it("checks arithmetic.edict.json (binops and let bindings)", () => {
        const ast = loadExample("arithmetic.edict.json");
        const result = edict.check(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.module).toBeDefined();
    });

    // ── Error handling ──────────────────────────────────────────────────

    it("returns structured errors for invalid AST", () => {
        const invalidAst = {
            kind: "module",
            name: "test",
            definitions: [{ kind: "function", id: "fn-001", name: "main" }],
        };
        const result = edict.check(invalidAst);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("returns type error for mismatched return type", () => {
        const ast = {
            kind: "module",
            id: "mod-err",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-main-err",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-err", value: "hello" }],
            }],
        };
        const result = edict.check(ast);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.error === "type_mismatch")).toBe(true);
    });

    // ── Disposal ────────────────────────────────────────────────────────

    it("throws after dispose", async () => {
        const temp = await EdictQuickJS.create();
        temp.dispose();
        expect(() => temp.check({ kind: "module" })).toThrow("disposed");
    }, 30_000);
});

// ===========================================================================
// Error path tests (issue #190)
// ===========================================================================

describe("QuickJS error paths", () => {
    // ── Bundle load failure (lines 130-135) ─────────────────────────────
    it("throws on invalid bundleSource", async () => {
        await expect(
            EdictQuickJS.create({ bundleSource: "invalid javascript {{{" }),
        ).rejects.toThrow("Failed to load compiler bundle");
    }, 30_000);

    // ── Runtime error during check() (lines 155-167) ────────────────────
    it("returns quickjs_runtime_error when Edict global is missing", async () => {
        // Load a valid-JS bundle that does NOT define globalThis.Edict
        const instance = await EdictQuickJS.create({
            bundleSource: "var x = 1;",
        });
        try {
            const result = instance.check({ kind: "module", name: "test", definitions: [] });
            expect(result.ok).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect((result.errors[0] as { error: string }).error).toBe("quickjs_runtime_error");
        } finally {
            instance.dispose();
        }
    }, 30_000);

    // ── Polyfill failure (lines 118-124) ────────────────────────────────
    it("throws on polyfill failure with tiny memory limit", async () => {
        // Memory limit large enough for QuickJS context creation but too small
        // for polyfill evaluation. The exact behavior depends on QuickJS internals,
        // so we accept any error during creation with a tiny memory limit.
        await expect(
            EdictQuickJS.create({ memoryLimit: 1024, bundleSource: "var x = 1;" }),
        ).rejects.toThrow();
    }, 30_000);

    // ── Dispose idempotency ─────────────────────────────────────────────
    it("dispose() is idempotent (no double-free)", async () => {
        const instance = await EdictQuickJS.create({ bundleSource: "var x = 1;" });
        instance.dispose();
        // Second dispose does nothing
        expect(() => instance.dispose()).not.toThrow();
    }, 30_000);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadExample(filename: string): unknown {
    const path = resolve("examples", filename);
    return JSON.parse(readFileSync(path, "utf-8"));
}
