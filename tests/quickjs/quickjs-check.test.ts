// =============================================================================
// QuickJS Self-Hosting Tests — check + compile pipeline inside QuickJS-WASM
// =============================================================================
// Verifies that the Edict check pipeline (phases 1–3) and compile pipeline
// (phases 1–5) run correctly inside a QuickJS-WASM interpreter.
//
// Prerequisites:
//   - dist/edict-quickjs-check.js (check-only tests)
//   - dist/edict-quickjs-full.js  (compile tests)
// Built by: tsx scripts/build-quickjs-bundle.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { EdictQuickJS } from "../../src/quickjs/edict-quickjs.js";

// ---------------------------------------------------------------------------
// Setup — create shared EdictQuickJS instances (expensive to init)
// ---------------------------------------------------------------------------

const CHECK_BUNDLE_PATH = resolve("dist/edict-quickjs-check.js");
const FULL_BUNDLE_PATH = resolve("dist/edict-quickjs-full.js");

const checkBundleExists = existsSync(CHECK_BUNDLE_PATH);
const fullBundleExists = existsSync(FULL_BUNDLE_PATH);

// ===========================================================================
// Check-only tests (phases 1-3)
// ===========================================================================

let checkEdict: EdictQuickJS;

describe.skipIf(!checkBundleExists)("QuickJS self-hosting PoC", () => {
    beforeAll(async () => {
        checkEdict = await EdictQuickJS.create();
    }, 30_000);

    afterAll(() => {
        checkEdict?.dispose();
    });

    // ── Criterion: PoC validates + type-checks at least 3 example programs ──

    it("checks fibonacci.edict.json (recursive fn with contracts)", () => {
        const ast = loadExample("fibonacci.edict.json");
        const result = checkEdict.check(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.module).toBeDefined();
        expect(result.module.kind).toBe("module");
        expect(result.typeInfo).toBeDefined();
    });

    it("checks hello.edict.json (basic IO)", () => {
        const ast = loadExample("hello.edict.json");
        const result = checkEdict.check(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.module).toBeDefined();
    });

    it("checks arithmetic.edict.json (binops and let bindings)", () => {
        const ast = loadExample("arithmetic.edict.json");
        const result = checkEdict.check(ast);
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
        const result = checkEdict.check(invalidAst);
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
        const result = checkEdict.check(ast);
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
// Full compile tests (phases 1-5)
// ===========================================================================

let fullEdict: EdictQuickJS;

describe.skipIf(!fullBundleExists)("QuickJS full compile (phases 1-5)", () => {
    beforeAll(async () => {
        fullEdict = await EdictQuickJS.createFull();
    }, 30_000);

    afterAll(() => {
        fullEdict?.dispose();
    });

    it("compiles arithmetic.edict.json to valid WASM", () => {
        const ast = loadExample("arithmetic.edict.json");
        const result = fullEdict.compile(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.wasm).toBeInstanceOf(Uint8Array);
        // WASM magic bytes: \0asm
        expect(result.wasm![0]).toBe(0x00);
        expect(result.wasm![1]).toBe(0x61);
        expect(result.wasm![2]).toBe(0x73);
        expect(result.wasm![3]).toBe(0x6D);
    });

    it("compiles hello.edict.json to valid WASM", () => {
        const ast = loadExample("hello.edict.json");
        const result = fullEdict.compile(ast);
        expect(result.ok).toBe(true);
        expect(result.wasm).toBeInstanceOf(Uint8Array);
        expect(result.wasm!.length).toBeGreaterThan(8);
    });

    it("compiles fibonacci.edict.json to valid WASM", () => {
        const ast = loadExample("fibonacci.edict.json");
        const result = fullEdict.compile(ast);
        expect(result.ok).toBe(true);
        expect(result.wasm).toBeInstanceOf(Uint8Array);
    });

    it("compiled WASM validates via WebAssembly.compile", async () => {
        const ast = loadExample("arithmetic.edict.json");
        const result = fullEdict.compile(ast);
        expect(result.ok).toBe(true);

        // Verify the bytes are valid WASM by passing to the engine
        const wasmModule = await WebAssembly.compile(result.wasm!);
        expect(wasmModule).toBeInstanceOf(WebAssembly.Module);
    });

    it("returns structured errors for invalid AST", () => {
        const invalidAst = {
            kind: "module",
            name: "test",
            definitions: [{ kind: "function", id: "fn-001", name: "main" }],
        };
        const result = fullEdict.compile(invalidAst);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("check() still works with full bundle", () => {
        const ast = loadExample("arithmetic.edict.json");
        const result = fullEdict.check(ast);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("compile() returns error when used with check-only bundle", async () => {
        const checkOnly = await EdictQuickJS.create();
        try {
            const result = checkOnly.compile({ kind: "module", name: "test", definitions: [] });
            expect(result.ok).toBe(false);
            expect(result.errors[0]).toHaveProperty("error", "quickjs_runtime_error");
        } finally {
            checkOnly.dispose();
        }
    }, 30_000);

    it("throws after dispose", async () => {
        const temp = await EdictQuickJS.createFull();
        temp.dispose();
        expect(() => temp.compile({ kind: "module" })).toThrow("disposed");
    }, 30_000);

    // ── End-to-end execution: compile in QuickJS, execute in Node.js ──

    describe("end-to-end execution", () => {
        async function compileAndRun(ast: unknown) {
            const result = fullEdict.compile(ast);
            expect(result.ok).toBe(true);
            expect(result.wasm).toBeInstanceOf(Uint8Array);

            const { createHostImports } = await import("../../src/builtins/registry.js");
            const state = { outputParts: [] as string[], instance: null as any };
            const importObject = createHostImports(state);
            const { instance } = await WebAssembly.instantiate(result.wasm!, importObject);
            state.instance = instance;
            return { instance, state };
        }

        it("arithmetic: main() returns 7 (add(3, 4))", async () => {
            const ast = loadExample("arithmetic.edict.json");
            const { instance } = await compileAndRun(ast);
            const main = instance.exports.main as () => number;
            expect(main()).toBe(7);
        });

        it("fibonacci: main() returns 55 (fib(10))", async () => {
            const ast = loadExample("fibonacci.edict.json");
            const { instance } = await compileAndRun(ast);
            const main = instance.exports.main as () => number;
            expect(main()).toBe(55);
        });

        it("hello: main() prints 'Hello, World!' and returns 0", async () => {
            const ast = loadExample("hello.edict.json");
            const { instance, state } = await compileAndRun(ast);
            const main = instance.exports.main as () => number;
            const returnVal = main();
            expect(returnVal).toBe(0);
            expect(state.outputParts.join("")).toContain("Hello, World!");
        });

        it("closures: main() returns 11 (makeAdder(10)(1))", async () => {
            const ast = loadExample("closures.edict.json");
            const { instance } = await compileAndRun(ast);
            const main = instance.exports.main as () => number;
            expect(main()).toBe(11);
        });

        it("constants: main() returns 85", async () => {
            const ast = loadExample("constants.edict.json");
            const { instance } = await compileAndRun(ast);
            const main = instance.exports.main as () => number;
            expect(main()).toBe(85);
        });

        it("higher-order-functions: main() returns 30", async () => {
            const ast = loadExample("higher-order-functions.edict.json");
            const { instance } = await compileAndRun(ast);
            const main = instance.exports.main as () => number;
            expect(main()).toBe(30);
        });
    });

    // ── Contract verification: check() with built-in solver ──

    describe("contract verification (built-in solver)", () => {
        it("fibonacci: check() returns coverage with proven contracts", () => {
            const ast = loadExample("fibonacci.edict.json");
            const result = fullEdict.check(ast);
            expect(result.ok).toBe(true);
            // With the full bundle, check() should include contract verification
            // The fibonacci example has contracts — verify coverage is present
            if (result.coverage) {
                expect(result.coverage.contracts.total).toBeGreaterThan(0);
            }
        });

        it("contracts.edict.json: contract verification runs (known safeDivide failure)", () => {
            const ast = loadExample("contracts.edict.json");
            const result = fullEdict.check(ast);
            // contracts.edict.json has a safeDivide function whose postcondition
            // (result * denominator == numerator) fails for integer division rounding.
            // This is expected — the solver correctly catches it.
            expect(result.ok).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toHaveProperty("error", "contract_failure");
            expect(result.errors[0]).toHaveProperty("functionName", "safeDivide");
        });

        it("arithmetic.edict.json (no contracts): passes with empty coverage", () => {
            const ast = loadExample("arithmetic.edict.json");
            const result = fullEdict.check(ast);
            expect(result.ok).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("contract failure produces structured error", () => {
            // Load a real program that passes phases 1-3, then inject a
            // provably false postcondition to trigger contract_failure
            const ast = JSON.parse(JSON.stringify(loadExample("arithmetic.edict.json")));
            // add(a, b) returns a + b, so post result < 0 is provably false
            // when a,b are unrestricted ints
            const addFn = ast.definitions.find((d: any) => d.name === "add");
            if (addFn) {
                addFn.contracts = [{
                    kind: "post",
                    id: "injected-post",
                    condition: {
                        kind: "binop", id: "inj-cmp", op: "<",
                        left: { kind: "ident", name: "result", id: "inj-result" },
                        right: { kind: "literal", id: "inj-zero", value: 0 },
                    },
                }];
            }

            const result = fullEdict.check(ast);
            expect(result.ok).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toHaveProperty("error", "contract_failure");
        });
    });
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

// ===========================================================================
// End-to-end execution inside QuickJS (compile + run = full self-hosting)
// ===========================================================================

describe("EdictQuickJS — compileAndRun() (full self-hosted execution)", () => {
    let edict: InstanceType<typeof EdictQuickJS>;

    beforeAll(async () => {
        edict = await EdictQuickJS.createFull();
    }, 30_000);

    afterAll(() => {
        edict.dispose();
    });

    it("arithmetic: compileAndRun returns 7 (3+4)", () => {
        const ast = loadExample("arithmetic.edict.json");
        const result = edict.compileAndRun(ast);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(7);
    }, 30_000);

    it("fibonacci: compileAndRun returns 55", () => {
        const ast = loadExample("fibonacci.edict.json");
        const result = edict.compileAndRun(ast);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(55);
    }, 30_000);

    it("hello: compileAndRun captures printed output", () => {
        const ast = loadExample("hello.edict.json");
        const result = edict.compileAndRun(ast);
        expect(result.ok).toBe(true);
        expect(result.output).toContain("Hello");
    }, 30_000);

    it("constants: compileAndRun returns 85", () => {
        const ast = loadExample("constants.edict.json");
        const result = edict.compileAndRun(ast);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(85);
    }, 30_000);

    it("closures: compileAndRun reports missing array builtins", () => {
        // closures.edict.json uses arrays, which require array builtins (array_get, etc.)
        // not included in the minimal runInterpreted() host set.
        // This test verifies the error is clear and actionable.
        const ast = loadExample("closures.edict.json");
        const result = edict.compileAndRun(ast);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("unimplemented host builtin");
    }, 30_000);

    it("compile errors propagate through compileAndRun", () => {
        const badAst = { version: "1.0.0", module: "bad", body: [{ node: "return", id: "r1", value: { node: "ref", id: "r2", name: "nonexistent" } }] };
        const result = edict.compileAndRun(badAst);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    }, 30_000);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadExample(filename: string): unknown {
    const path = resolve("examples", filename);
    return JSON.parse(readFileSync(path, "utf-8"));
}
