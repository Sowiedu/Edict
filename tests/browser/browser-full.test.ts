// =============================================================================
// Browser-Full Bundle Tests — verify full browser pipeline (compile + run)
// =============================================================================
// Tests the browser-full entry point which adds codegen (binaryen) and
// browser WASM execution to the lightweight browser bundle.

import { describe, it, expect } from "vitest";
import {
    // Re-exported from browser.ts
    validate,
    checkBrowser,
    // New in browser-full
    compile,
    compileBrowser,
    compileBrowserFull,
    runBrowserDirect,
    isZ3Initialized,
    BrowserHostAdapter,
} from "../../src/browser-full.js";
import type {
    CompileBrowserResult,
    CompileBrowserFullResult,
} from "../../src/browser-full.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** fn main() -> Int { 2 + 3 } */
const addProgram = {
    kind: "module",
    id: "mod-add",
    name: "add_test",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main-001",
        name: "main",
        params: [],
        effects: [],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{
            kind: "binop",
            id: "binop-001",
            op: "+",
            left: { kind: "literal", id: "lit-001", value: 2 },
            right: { kind: "literal", id: "lit-002", value: 3 },
        }],
    }],
};

/** fn main() -> Int { print("hello"); 0 } */
const printProgram = {
    kind: "module",
    id: "mod-print",
    name: "print_test",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main-001",
        name: "main",
        params: [],
        effects: ["io"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [
            {
                kind: "call",
                id: "call-001",
                fn: { kind: "ident", id: "ident-001", name: "print" },
                args: [{ kind: "literal", id: "lit-001", value: "hello" }],
            },
            { kind: "literal", id: "lit-002", value: 0 },
        ],
    }],
};

/** Invalid module: unknown function */
const invalidModule = {
    kind: "module",
    id: "mod-bad",
    name: "bad",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main-001",
        name: "main",
        params: [],
        effects: [],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{
            kind: "call",
            id: "call-bad",
            fn: { kind: "ident", id: "ident-bad", name: "nonexistent_function" },
            args: [],
        }],
    }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("browser-full", () => {
    describe("exports", () => {
        it("re-exports lightweight browser APIs", () => {
            expect(typeof validate).toBe("function");
            expect(typeof checkBrowser).toBe("function");
        });

        it("exports compile function", () => {
            expect(typeof compile).toBe("function");
        });

        it("exports convenience wrappers", () => {
            expect(typeof compileBrowser).toBe("function");
            expect(typeof compileBrowserFull).toBe("function");
        });

        it("exports browser runner", () => {
            expect(typeof runBrowserDirect).toBe("function");
        });

        it("exports BrowserHostAdapter", () => {
            expect(typeof BrowserHostAdapter).toBe("function");
        });

        it("exports Z3 status check", () => {
            expect(typeof isZ3Initialized).toBe("function");
        });
    });

    describe("compileBrowser (no Z3)", () => {
        it("compiles a valid module to WASM", () => {
            const result: CompileBrowserResult = compileBrowser(addProgram);
            expect(result.ok).toBe(true);
            expect(result.wasm).toBeInstanceOf(Uint8Array);
            expect(result.wasm!.length).toBeGreaterThan(0);
            expect(result.errors).toEqual([]);
        });

        it("returns errors for invalid module", () => {
            const result: CompileBrowserResult = compileBrowser(invalidModule);
            expect(result.ok).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.wasm).toBeUndefined();
        });

        it("returns errors for non-object input", () => {
            const result: CompileBrowserResult = compileBrowser("not a module");
            expect(result.ok).toBe(false);
        });

        it("returns typeInfo on success", () => {
            const result: CompileBrowserResult = compileBrowser(addProgram);
            expect(result.ok).toBe(true);
            expect(result.typeInfo).toBeDefined();
        });
    });

    describe("compileBrowserFull (async, with optional Z3)", () => {
        it("compiles a valid module to WASM", async () => {
            const result: CompileBrowserFullResult = await compileBrowserFull(addProgram);
            expect(result.ok).toBe(true);
            expect(result.wasm).toBeInstanceOf(Uint8Array);
            expect(result.wasm!.length).toBeGreaterThan(0);
            expect(result.errors).toEqual([]);
        });

        it("returns errors for invalid module", async () => {
            const result: CompileBrowserFullResult = await compileBrowserFull(invalidModule);
            expect(result.ok).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe("runBrowserDirect", () => {
        it("executes compiled WASM and returns result", async () => {
            const compileResult = compileBrowser(addProgram);
            expect(compileResult.ok).toBe(true);

            const runResult = await runBrowserDirect(compileResult.wasm!);
            expect(runResult.exitCode).toBe(0);
            expect(runResult.returnValue).toBe(5); // 2 + 3
        });

        it("captures print output", async () => {
            const compileResult = compileBrowser(printProgram);
            expect(compileResult.ok).toBe(true);

            const runResult = await runBrowserDirect(compileResult.wasm!);
            expect(runResult.exitCode).toBe(0);
            expect(runResult.output).toContain("hello");
        });

        it("returns error for invalid WASM", async () => {
            const result = await runBrowserDirect(new Uint8Array([0, 1, 2, 3]));
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain("WASM instantiation error");
        });

        it("returns error for missing entry function", async () => {
            const compileResult = compileBrowser(addProgram);
            expect(compileResult.ok).toBe(true);

            const result = await runBrowserDirect(compileResult.wasm!, "nonexistent");
            expect(result.exitCode).toBe(1);
        });
    });

    describe("end-to-end: compile → run", () => {
        it("compiles and runs arithmetic", async () => {
            const compiled = compileBrowser(addProgram);
            expect(compiled.ok).toBe(true);

            const run = await runBrowserDirect(compiled.wasm!);
            expect(run.exitCode).toBe(0);
            expect(run.returnValue).toBe(5);
        });

        it("compiles and runs print", async () => {
            const compiled = compileBrowser(printProgram);
            expect(compiled.ok).toBe(true);

            const run = await runBrowserDirect(compiled.wasm!);
            expect(run.exitCode).toBe(0);
            expect(run.output).toContain("hello");
            expect(run.returnValue).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Z3 Integration — contract verification in browser-full pipeline
    // -----------------------------------------------------------------------

    describe("Z3 contract verification", () => {
        it("initializes Z3 successfully", async () => {
            const { initEdictBrowser } = await import("../../src/browser-full.js");
            const result = await initEdictBrowser();
            expect(result.ok).toBe(true);
        });

        it("isZ3Initialized returns true after init", async () => {
            // Z3 was initialized in the previous test (lazy singleton)
            expect(isZ3Initialized()).toBe(true);
        });

        it("compileBrowserFull proves a valid postcondition", async () => {
            /** fn absolute(x: Int) -> Int { post: result >= 0; if x < 0 then -x else x } */
            const contractProgram = {
                kind: "module",
                id: "mod-contract",
                name: "contract_test",
                imports: [],
                definitions: [{
                    kind: "fn",
                    id: "fn-absolute",
                    name: "absolute",
                    params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [{
                        kind: "post",
                        id: "post-nonneg",
                        condition: {
                            kind: "binop", id: "cond-gte", op: ">=",
                            left: { kind: "ident", id: "id-result", name: "result" },
                            right: { kind: "literal", id: "lit-0", value: 0 },
                        },
                    }],
                    body: [{
                        kind: "if",
                        id: "if-neg",
                        condition: {
                            kind: "binop", id: "cmp-lt", op: "<",
                            left: { kind: "ident", id: "id-x-cmp", name: "x" },
                            right: { kind: "literal", id: "lit-0-cmp", value: 0 },
                        },
                        then: [{
                            kind: "unop", id: "neg-x", op: "-",
                            operand: { kind: "ident", id: "id-x-neg", name: "x" },
                        }],
                        else: [{ kind: "ident", id: "id-x-ret", name: "x" }],
                    }],
                }, {
                    kind: "fn",
                    id: "fn-main",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call",
                        id: "call-abs",
                        fn: { kind: "ident", id: "id-absolute", name: "absolute" },
                        args: [{ kind: "literal", id: "lit-neg-7", value: -7 }],
                    }],
                }],
            };

            const result = await compileBrowserFull(contractProgram);
            expect(result.ok).toBe(true);
            expect(result.wasm).toBeInstanceOf(Uint8Array);
            expect(result.errors).toEqual([]);
            // Z3 should have verified the contract — coverage should be present
            expect(result.coverage).toBeDefined();
        });

        it("compileBrowserFull detects a contract violation", async () => {
            /** fn bad(x: Int) -> Int { post: result > 0; x } — fails when x <= 0 */
            const failingProgram = {
                kind: "module",
                id: "mod-fail",
                name: "fail_test",
                imports: [],
                definitions: [{
                    kind: "fn",
                    id: "fn-bad",
                    name: "main",
                    params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [{
                        kind: "post",
                        id: "post-positive",
                        condition: {
                            kind: "binop", id: "cond-gt", op: ">",
                            left: { kind: "ident", id: "id-result", name: "result" },
                            right: { kind: "literal", id: "lit-0", value: 0 },
                        },
                    }],
                    body: [{ kind: "ident", id: "id-x-ret", name: "x" }],
                }],
            };

            const result = await compileBrowserFull(failingProgram);
            // Contract verification should fail — postcondition can't be proven
            expect(result.ok).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some(e => e.error === "contract_failure")).toBe(true);
        });
    });
});
