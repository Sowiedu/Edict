import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import {
    arbModule,
    arbExpression,
    resetIdCounter,
} from "./arbitraries.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// =============================================================================
// Fuzz tests for compile() — programs that pass check() must compile
// =============================================================================
// Property: if check(ast).ok === true, then compile(module) must not throw
// and must return a CompileResult.

// Load all example programs that don't use imports (can't resolve cross-module)
const examplesDir = join(import.meta.dirname, "../../examples");
const exampleFiles = readdirSync(examplesDir)
    .filter((f) => f.endsWith(".edict.json"))
    .filter((f) => f !== "modules.edict.json");

const exampleASTs: { name: string; ast: unknown }[] = exampleFiles.map((f) => ({
    name: f,
    ast: JSON.parse(readFileSync(join(examplesDir, f), "utf-8")),
}));

describe("fuzz — compile()", () => {
    beforeEach(() => resetIdCounter());

    // =========================================================================
    // Property 1: All example programs that pass check() compile without crash
    // =========================================================================
    it("compiles all valid example programs without throwing", async () => {
        for (const { name, ast } of exampleASTs) {
            const checkResult = await check(ast);
            if (checkResult.ok && checkResult.module) {
                const compileResult = compile(checkResult.module);
                expect(compileResult).toBeDefined();
                expect(typeof compileResult.ok).toBe("boolean");
                if (!compileResult.ok) {
                    expect(Array.isArray(compileResult.errors)).toBe(true);
                }
            }
        }
    }, 60_000);

    // =========================================================================
    // Property 2: Valid programs with varied literal values compile
    // =========================================================================
    it("compiles programs with random integer literals without throwing", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(
                    fc.integer({ min: -1_000_000, max: 1_000_000 }),
                    fc.integer({ min: 0, max: 0 }),
                    fc.integer({ min: 2_147_483_647, max: 2_147_483_647 }),
                    fc.integer({ min: -2_147_483_648, max: -2_147_483_648 }),
                ),
                async (value) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-compile-mod",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-compile-fn",
                                name: "main",
                                params: [],
                                effects: ["pure"],
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [
                                    { kind: "literal", id: "fuzz-compile-lit", value },
                                ],
                            },
                        ],
                    };

                    const checkResult = await check(ast);
                    if (checkResult.ok && checkResult.module) {
                        const compileResult = compile(checkResult.module);
                        expect(compileResult).toBeDefined();
                        expect(typeof compileResult.ok).toBe("boolean");
                    }
                },
            ),
            { numRuns: 200 },
        );
    }, 60_000);

    // =========================================================================
    // Property 3: Valid programs with varied string literals compile
    // =========================================================================
    it("compiles programs with random string literals without throwing", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 0, maxLength: 500 }),
                async (value) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-compile-mod",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-compile-fn",
                                name: "main",
                                params: [],
                                effects: ["io"],
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [
                                    {
                                        kind: "call",
                                        id: "fuzz-compile-call",
                                        fn: { kind: "ident", id: "fuzz-compile-ident", name: "print" },
                                        args: [
                                            { kind: "literal", id: "fuzz-compile-lit", value },
                                        ],
                                    },
                                    { kind: "literal", id: "fuzz-compile-ret", value: 0 },
                                ],
                            },
                        ],
                    };

                    const checkResult = await check(ast);
                    if (checkResult.ok && checkResult.module) {
                        const compileResult = compile(checkResult.module);
                        expect(compileResult).toBeDefined();
                        expect(typeof compileResult.ok).toBe("boolean");
                    }
                },
            ),
            { numRuns: 200 },
        );
    }, 60_000);

    // =========================================================================
    // Property 4: Randomly generated modules that pass check() must compile
    // =========================================================================
    it("compiles randomly generated modules that pass check()", async () => {
        await fc.assert(
            fc.asyncProperty(
                arbModule({ maxFunctions: 2, maxBodyDepth: 2 }),
                async (module) => {
                    const checkResult = await check(module);
                    if (checkResult.ok && checkResult.module) {
                        const compileResult = compile(checkResult.module);
                        expect(compileResult).toBeDefined();
                        expect(typeof compileResult.ok).toBe("boolean");
                        // If compile fails with errors, that's acceptable
                        // (some valid-typed programs may hit codegen limitations)
                        // Crashes are NOT acceptable.
                    }
                    // Programs that fail check are fine — they just won't reach compile
                },
            ),
            { numRuns: 200 },
        );
    }, 60_000);

    // =========================================================================
    // Property 5: Programs with varied expression structures compile
    // =========================================================================
    it("compiles programs with varied expression structures", async () => {
        await fc.assert(
            fc.asyncProperty(
                arbExpression(2),
                async (expr) => {
                    const ast = {
                        kind: "module",
                        id: "fuzz-expr-compile-mod",
                        name: "test",
                        imports: [],
                        definitions: [
                            {
                                kind: "fn",
                                id: "fuzz-expr-compile-fn",
                                name: "main",
                                params: [],
                                effects: ["io"],
                                returnType: { kind: "basic", name: "Int" },
                                contracts: [],
                                body: [
                                    expr,
                                    { kind: "literal", id: "fuzz-expr-compile-ret", value: 0 },
                                ],
                            },
                        ],
                    };

                    const checkResult = await check(ast);
                    if (checkResult.ok && checkResult.module) {
                        const compileResult = compile(checkResult.module);
                        expect(compileResult).toBeDefined();
                        expect(typeof compileResult.ok).toBe("boolean");
                    }
                },
            ),
            { numRuns: 200 },
        );
    }, 60_000);
});
