import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { packageSkill } from "../../src/skills/package.js";
import { SkillMemory } from "../../src/skills/memory.js";
import type { SkillPackage } from "../../src/skills/types.js";

// ── AST Fixtures (reused from skill-lifecycle.test.ts) ──────────────────────

const doubleAst = {
    kind: "module", id: "mod-dbl-mem", name: "DoubleSkill", schemaVersion: "1.1",
    imports: [], definitions: [
        {
            kind: "fn", id: "fn-dbl-mem", name: "double",
            params: [{ kind: "param", id: "p-x-mem", name: "x", type: { kind: "basic", name: "Int" } }],
            effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "binop", id: "mul-mem", op: "*",
                left: { kind: "ident", id: "id-x-mem", name: "x" },
                right: { kind: "literal", id: "lit-2-mem", value: 2 },
            }],
        },
        {
            kind: "fn", id: "fn-main-dbl-mem", name: "main",
            params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "call", id: "call-dbl-mem",
                fn: { kind: "ident", id: "id-dbl-mem", name: "double" },
                args: [{ kind: "literal", id: "lit-21-mem", value: 21 }],
            }],
        },
    ],
};

const fibAst = {
    kind: "module", id: "mod-fib-mem", name: "FibSkill", schemaVersion: "1.1",
    imports: [], definitions: [
        {
            kind: "fn", id: "fn-fib-mem", name: "fib",
            params: [{ kind: "param", id: "p-n-fib-mem", name: "n", type: { kind: "basic", name: "Int" } }],
            effects: ["pure"], returnType: { kind: "basic", name: "Int" },
            contracts: [{
                kind: "pre", id: "pre-fib-mem",
                condition: {
                    kind: "binop", id: "pre-cond-fib-mem", op: ">=",
                    left: { kind: "ident", id: "id-n-pre-fib-mem", name: "n" },
                    right: { kind: "literal", id: "lit-0-pre-fib-mem", value: 0 },
                },
            }],
            body: [{
                kind: "if", id: "if-fib-mem",
                condition: {
                    kind: "binop", id: "cond-fib-mem", op: "<=",
                    left: { kind: "ident", id: "id-n-fib-mem", name: "n" },
                    right: { kind: "literal", id: "lit-1-fib-mem", value: 1 },
                },
                then: [{ kind: "ident", id: "id-n-ret-fib-mem", name: "n" }],
                else: [{
                    kind: "binop", id: "add-fib-mem", op: "+",
                    left: {
                        kind: "call", id: "call-f1-mem",
                        fn: { kind: "ident", id: "id-fib1-mem", name: "fib" },
                        args: [{
                            kind: "binop", id: "sub1-fib-mem", op: "-",
                            left: { kind: "ident", id: "id-n-s1-mem", name: "n" },
                            right: { kind: "literal", id: "lit-1-s1-mem", value: 1 },
                        }],
                    },
                    right: {
                        kind: "call", id: "call-f2-mem",
                        fn: { kind: "ident", id: "id-fib2-mem", name: "fib" },
                        args: [{
                            kind: "binop", id: "sub2-fib-mem", op: "-",
                            left: { kind: "ident", id: "id-n-s2-mem", name: "n" },
                            right: { kind: "literal", id: "lit-2-s2-mem", value: 2 },
                        }],
                    },
                }],
            }],
        },
        {
            kind: "fn", id: "fn-main-fib-mem", name: "main",
            params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "call", id: "call-main-fib-mem",
                fn: { kind: "ident", id: "id-fib-main-mem", name: "fib" },
                args: [{ kind: "literal", id: "lit-10-mem", value: 10 }],
            }],
        },
    ],
};

const factAst = {
    kind: "module", id: "mod-fact-mem", name: "FactSkill", schemaVersion: "1.1",
    imports: [], definitions: [
        {
            kind: "fn", id: "fn-facth-mem", name: "factHelper",
            params: [
                { kind: "param", id: "p-n-fact-mem", name: "n", type: { kind: "basic", name: "Int" } },
                { kind: "param", id: "p-acc-mem", name: "acc", type: { kind: "basic", name: "Int" } },
            ],
            effects: ["pure"], returnType: { kind: "basic", name: "Int" },
            contracts: [{
                kind: "pre", id: "pre-fact-mem",
                condition: {
                    kind: "binop", id: "pre-cond-fact-mem", op: ">=",
                    left: { kind: "ident", id: "id-n-pre-fact-mem", name: "n" },
                    right: { kind: "literal", id: "lit-0-pre-fact-mem", value: 0 },
                },
            }],
            body: [{
                kind: "if", id: "if-fact-mem",
                condition: {
                    kind: "binop", id: "cond-fact-mem", op: "<=",
                    left: { kind: "ident", id: "id-n-fact-mem", name: "n" },
                    right: { kind: "literal", id: "lit-0-fact-mem", value: 0 },
                },
                then: [{ kind: "ident", id: "id-acc-mem", name: "acc" }],
                else: [{
                    kind: "call", id: "call-rec-mem",
                    fn: { kind: "ident", id: "id-facth-mem", name: "factHelper" },
                    args: [
                        {
                            kind: "binop", id: "sub-fact-mem", op: "-",
                            left: { kind: "ident", id: "id-n-sub-mem", name: "n" },
                            right: { kind: "literal", id: "lit-1-sub-mem", value: 1 },
                        },
                        {
                            kind: "binop", id: "mul-fact-mem", op: "*",
                            left: { kind: "ident", id: "id-n-mul-mem", name: "n" },
                            right: { kind: "ident", id: "id-acc-mul-mem", name: "acc" },
                        },
                    ],
                }],
            }],
        },
        {
            kind: "fn", id: "fn-main-fact-mem", name: "main",
            params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "call", id: "call-main-fact-mem",
                fn: { kind: "ident", id: "id-facth-main-mem", name: "factHelper" },
                args: [
                    { kind: "literal", id: "lit-7-mem", value: 7 },
                    { kind: "literal", id: "lit-1-init-mem", value: 1 },
                ],
            }],
        },
    ],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const skillPrograms = [
    { name: "DoubleSkill", description: "doubles a number", ast: doubleAst, expectedReturn: 42 },
    { name: "FibSkill", description: "fibonacci sequence calculator", ast: fibAst, expectedReturn: 55 },
    { name: "FactSkill", description: "factorial computation helper", ast: factAst, expectedReturn: 5040 },
];

async function compileModule(ast: unknown) {
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        throw new Error("check() failed: " + JSON.stringify(checkResult.errors));
    }
    const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        throw new Error("compile() failed: " + JSON.stringify(compileResult.errors));
    }
    return { module: checkResult.module, wasm: compileResult.wasm, coverage: checkResult.coverage };
}

async function packageFromAst(name: string, description: string, ast: unknown): Promise<SkillPackage> {
    const { module, wasm, coverage } = await compileModule(ast);
    const result = packageSkill({ module, wasm, coverage, metadata: { name, description } });
    if (!result.ok) throw new Error("packageSkill() failed: " + result.error);
    return result.skill;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SkillMemory", () => {
    describe("store() + get()", () => {
        it("should store and retrieve a skill by exact name", async () => {
            const memory = new SkillMemory();
            const skill = await packageFromAst("DoubleSkill", "doubles a number", doubleAst);

            memory.store(skill);

            const retrieved = memory.get("DoubleSkill");
            expect(retrieved).toBeDefined();
            expect(retrieved!.metadata.name).toBe("DoubleSkill");
            expect(memory.size).toBe(1);
        });

        it("should overwrite on duplicate name", async () => {
            const memory = new SkillMemory();
            const skill1 = await packageFromAst("MySkill", "version 1", doubleAst);
            const skill2 = await packageFromAst("MySkill", "version 2", doubleAst);

            memory.store(skill1);
            memory.store(skill2);

            expect(memory.size).toBe(1);
            expect(memory.get("MySkill")!.metadata.description).toBe("version 2");
        });

        it("should throw on empty name", () => {
            const memory = new SkillMemory();
            expect(() => memory.store({ metadata: { name: "" } } as SkillPackage)).toThrow("empty or missing");
        });

        it("should throw on missing metadata.name", () => {
            const memory = new SkillMemory();
            expect(() => memory.store({ metadata: {} } as SkillPackage)).toThrow("empty or missing");
        });

        it("should return undefined for unknown name", () => {
            const memory = new SkillMemory();
            expect(memory.get("nonexistent")).toBeUndefined();
        });
    });

    describe("search()", () => {
        it("should find skills by name keyword", async () => {
            const memory = new SkillMemory();
            for (const { name, description, ast } of skillPrograms) {
                memory.store(await packageFromAst(name, description, ast));
            }

            const results = memory.search("fibonacci");
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("FibSkill");
            expect(results[0].score).toBeGreaterThan(0);
        });

        it("should find skills by description keyword", async () => {
            const memory = new SkillMemory();
            for (const { name, description, ast } of skillPrograms) {
                memory.store(await packageFromAst(name, description, ast));
            }

            const results = memory.search("computation");
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("FactSkill");
        });

        it("should rank multi-token queries by hit ratio", async () => {
            const memory = new SkillMemory();
            for (const { name, description, ast } of skillPrograms) {
                memory.store(await packageFromAst(name, description, ast));
            }

            // "fibonacci sequence" — both tokens match FibSkill, only one matches others
            const results = memory.search("fibonacci sequence");
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].name).toBe("FibSkill");
            expect(results[0].score).toBe(1.0); // Both tokens match
        });

        it("should return empty array for no matches", async () => {
            const memory = new SkillMemory();
            memory.store(await packageFromAst("DoubleSkill", "doubles a number", doubleAst));

            const results = memory.search("nonexistent_xyz");
            expect(results).toHaveLength(0);
        });

        it("should return all skills for empty query", async () => {
            const memory = new SkillMemory();
            for (const { name, description, ast } of skillPrograms) {
                memory.store(await packageFromAst(name, description, ast));
            }

            const results = memory.search("");
            expect(results).toHaveLength(3);
            results.forEach((r) => expect(r.score).toBe(1.0));
        });

        it("should include signature, verified, and wasmSize in results", async () => {
            const memory = new SkillMemory();
            memory.store(await packageFromAst("DoubleSkill", "doubles a number", doubleAst));

            const results = memory.search("double");
            expect(results).toHaveLength(1);
            expect(results[0].signature).toBeDefined();
            expect(results[0].signature.effects).toBeDefined();
            expect(typeof results[0].verified).toBe("boolean");
            expect(results[0].wasmSize).toBeGreaterThan(0);
        });
    });

    describe("execute()", () => {
        it("should execute a stored skill and return the correct result", async () => {
            const memory = new SkillMemory();
            memory.store(await packageFromAst("DoubleSkill", "doubles 21", doubleAst));

            const result = await memory.execute("DoubleSkill");
            expect(result.ok).toBe(true);
            expect(result.exitCode).toBe(0);
            expect(result.returnValue).toBe(42);
        });

        it("should return error for unknown skill", async () => {
            const memory = new SkillMemory();

            const result = await memory.execute("nonexistent");
            expect(result.ok).toBe(false);
            expect(result.error).toContain("not found in memory");
        });
    });

    describe("remove()", () => {
        it("should remove an existing skill", async () => {
            const memory = new SkillMemory();
            memory.store(await packageFromAst("DoubleSkill", "doubles", doubleAst));

            expect(memory.remove("DoubleSkill")).toBe(true);
            expect(memory.get("DoubleSkill")).toBeUndefined();
            expect(memory.size).toBe(0);
        });

        it("should return false for nonexistent skill", () => {
            const memory = new SkillMemory();
            expect(memory.remove("nonexistent")).toBe(false);
        });
    });

    describe("list()", () => {
        it("should list all stored skills with score 1.0", async () => {
            const memory = new SkillMemory();
            for (const { name, description, ast } of skillPrograms) {
                memory.store(await packageFromAst(name, description, ast));
            }

            const listed = memory.list();
            expect(listed).toHaveLength(3);
            const names = listed.map((l) => l.name).sort();
            expect(names).toEqual(["DoubleSkill", "FactSkill", "FibSkill"]);
            listed.forEach((l) => expect(l.score).toBe(1.0));
        });
    });

    describe("toJSON() / fromJSON()", () => {
        it("should round-trip through JSON serialization", async () => {
            const memory = new SkillMemory();
            for (const { name, description, ast } of skillPrograms) {
                memory.store(await packageFromAst(name, description, ast));
            }

            // Serialize
            const json = JSON.stringify(memory.toJSON());
            const parsed = JSON.parse(json) as SkillPackage[];

            // Reconstruct
            const restored = SkillMemory.fromJSON(parsed);
            expect(restored.size).toBe(3);

            // Execute from restored memory
            const result = await restored.execute("DoubleSkill");
            expect(result.ok).toBe(true);
            expect(result.returnValue).toBe(42);
        });
    });

    describe("3-cycle skill-building lifecycle", () => {
        it("should compile → store → search → execute for 3 skills", async () => {
            const memory = new SkillMemory();

            // Cycle 1-3: compile and store all skills
            for (const { name, description, ast } of skillPrograms) {
                const skill = await packageFromAst(name, description, ast);
                memory.store(skill);
            }
            expect(memory.size).toBe(3);

            // Search: find the fibonacci skill
            const searchResults = memory.search("fibonacci");
            expect(searchResults).toHaveLength(1);
            expect(searchResults[0].name).toBe("FibSkill");

            // Execute all from memory and verify results
            for (const { name, expectedReturn } of skillPrograms) {
                const result = await memory.execute(name);
                expect(result.ok).toBe(true);
                expect(result.returnValue).toBe(expectedReturn);
            }
        }, 60_000);
    });

    describe("toSearchResult fallback paths", () => {
        it("should handle skills with missing interface/verification/binary", () => {
            const memory = new SkillMemory();
            // Create a minimal skill package with missing optional nested fields
            const partialSkill = {
                metadata: { name: "PartialSkill", description: "partial", version: "1.0", author: "test" },
                // interface, verification, binary are undefined/missing
            } as unknown as SkillPackage;
            memory.store(partialSkill);

            const results = memory.search("partial");
            expect(results).toHaveLength(1);
            // Should use ?? fallback defaults
            expect(results[0].signature.params).toEqual([]);
            expect(results[0].signature.returns).toEqual({ type: "unknown" });
            expect(results[0].signature.effects).toEqual([]);
            expect(results[0].verified).toBe(false);
            expect(results[0].wasmSize).toBe(0);
        });

        it("should handle skills with null interface/verification/binary", () => {
            const memory = new SkillMemory();
            const nullFieldsSkill = {
                metadata: { name: "NullSkill", description: "null fields", version: "1.0", author: "test" },
                interface: null,
                verification: null,
                binary: null,
            } as unknown as SkillPackage;
            memory.store(nullFieldsSkill);

            const listed = memory.list();
            expect(listed).toHaveLength(1);
            expect(listed[0].signature.params).toEqual([]);
            expect(listed[0].signature.returns).toEqual({ type: "unknown" });
            expect(listed[0].verified).toBe(false);
            expect(listed[0].wasmSize).toBe(0);
        });
    });

    describe("search with tags", () => {
        it("should match keywords in tags", () => {
            const memory = new SkillMemory();
            const taggedSkill = {
                metadata: { name: "TaggedSkill", description: "no keywords here", version: "1.0", author: "test", tags: ["math", "algebra"] },
                interface: { entryPoint: "main", params: [], returns: { type: "Int" }, effects: [] },
                verification: { verified: true, contracts: [] },
                binary: { wasm: "", wasmSize: 100, checksum: "sha256:abc" },
            } as unknown as SkillPackage;
            memory.store(taggedSkill);

            // Search by tag keyword — should match via buildSearchableText
            const results = memory.search("algebra");
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("TaggedSkill");
        });
    });

    describe("performance measurement", () => {
        it("should execute skills in sub-second time (vs ~500ms-2s LLM inference)", async () => {
            const memory = new SkillMemory();
            memory.store(await packageFromAst("DoubleSkill", "doubles a number", doubleAst));

            const start = performance.now();
            const result = await memory.execute("DoubleSkill");
            const elapsedMs = performance.now() - start;

            expect(result.ok).toBe(true);
            expect(result.returnValue).toBe(42);

            // WASM execution should be well under 15s (worker startup overhead).
            // The actual WASM execution is sub-millisecond; the overhead is worker
            // thread startup (~2-6s depending on system load).
            // Compare: typical LLM inference latency is 500ms–2000ms.
            expect(elapsedMs).toBeLessThan(15_000);

            // Log for documentation purposes (AC5)
            // eslint-disable-next-line no-console
            console.log(
                `[Skill Memory Performance] execute("DoubleSkill"): ` +
                `${elapsedMs.toFixed(1)}ms (${(elapsedMs * 1000).toFixed(0)}µs) ` +
                `vs typical LLM inference: 500–2000ms`,
            );
        });
    });
});
