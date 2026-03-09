import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { checkMultiModule } from "../../src/multi-module.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import * as fs from "node:fs";
import * as path from "node:path";

const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../../examples");

describe("pipeline — check() on example programs", () => {
    const files = fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".edict.json"));

    for (const file of files) {
        it(`passes check() for ${file}`, async () => {
            const content = fs.readFileSync(path.join(EXAMPLES_DIR, file), "utf-8");
            const ast = JSON.parse(content);

            // Multi-module examples are JSON arrays
            if (Array.isArray(ast)) {
                const result = await checkMultiModule(ast as EdictModule[]);
                if (!result.ok) {
                    console.error(`Errors in ${file}:`, JSON.stringify(result.errors, null, 2));
                }
                expect(result.ok).toBe(true);
                return;
            }

            const result = await check(ast);
            if (!result.ok) {
                // Log errors to make debugging easy
                console.error(`Errors in ${file}:`, JSON.stringify(result.errors, null, 2));
            }
            expect(result.ok).toBe(true);
        });
    }
});

describe("pipeline — check() rejects invalid ASTs", () => {
    it("stops at validation for malformed AST", async () => {
        const result = await check({ kind: "nope" });
        expect(result.ok).toBe(false);
        // Should be a validation error, not a name-resolution error
        expect(result.errors[0]!.error).not.toBe("undefined_reference");
    });

    it("stops at name resolution when there's an undefined reference", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "ident", id: "i-1", name: "nonexistent" }],
            }],
        });
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("undefined_reference");
    });

    it("reaches type checking and reports type mismatch", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [{
                kind: "fn", id: "fn-1", name: "test",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" }, contracts: [],
                body: [{ kind: "literal", id: "l-1", value: "not an int" }],
            }],
        });
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("type_mismatch");
    });
});

describe("pipeline — check() Phase 3 effect checking", () => {
    it("reports effect_in_pure when pure function calls io function", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [
                {
                    kind: "fn", id: "fn-1", name: "pureFunc",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "call", id: "c-1", fn: { kind: "ident", id: "i-1", name: "ioFunc" }, args: [] }],
                },
                {
                    kind: "fn", id: "fn-2", name: "ioFunc",
                    params: [], effects: ["io"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-1", value: 42 }],
                },
            ],
        });
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.error).toBe("effect_in_pure");
    });

    it("type errors short-circuit before effect checking", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [
                {
                    kind: "fn", id: "fn-1", name: "broken",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [
                        { kind: "call", id: "c-1", fn: { kind: "ident", id: "i-1", name: "ioFunc" }, args: [] },
                        { kind: "literal", id: "l-1", value: "not an int" },
                    ],
                },
                {
                    kind: "fn", id: "fn-2", name: "ioFunc",
                    params: [], effects: ["io"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-2", value: 42 }],
                },
            ],
        });
        expect(result.ok).toBe(false);
        expect(result.errors.every(e => e.error === "type_mismatch")).toBe(true);
    });
});

describe("pipeline — check() Phase 4 contract verification", () => {
    it("effect errors short-circuit before contract checking", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [
                {
                    kind: "fn", id: "fn-1", name: "pureFunc",
                    params: [], effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [{
                        kind: "post", id: "post-1",
                        condition: { kind: "literal", id: "l-1", value: false },
                    }],
                    body: [{ kind: "call", id: "c-1", fn: { kind: "ident", id: "i-1", name: "ioFunc" }, args: [] }],
                },
                {
                    kind: "fn", id: "fn-2", name: "ioFunc",
                    params: [], effects: ["io"],
                    returnType: { kind: "basic", name: "Int" }, contracts: [],
                    body: [{ kind: "literal", id: "l-2", value: 42 }],
                },
            ],
        });
        expect(result.ok).toBe(false);
        // Only effect errors, not contract errors
        expect(result.errors.every(e => e.error === "effect_in_pure")).toBe(true);
    });

    it("returns contract_failure through full pipeline", async () => {
        const result = await check({
            kind: "module", id: "mod-1", name: "test",
            imports: [], definitions: [{
                kind: "fn", id: "fn-1", name: "broken",
                params: [{ kind: "param", id: "p-1", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [{
                    kind: "post", id: "post-1",
                    condition: {
                        kind: "binop", id: "b-1", op: ">",
                        left: { kind: "ident", id: "i-1", name: "x" },
                        right: { kind: "literal", id: "l-1", value: 0 },
                    },
                }],
                body: [{ kind: "ident", id: "i-2", name: "x" }],
            }],
        });
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("contract_failure");
    });
});
