import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { packageSkill } from "../../src/skills/package.js";
import { invokeSkill } from "../../src/skills/invoke.js";
import type { SkillPackage } from "../../src/skills/types.js";

// ── Three progressively complex ASTs ────────────────────────────────────────

const doubleAst = {
    kind: "module", id: "mod-dbl-lc", name: "DoubleSkill", schemaVersion: "1.1",
    imports: [], definitions: [
        {
            kind: "fn", id: "fn-dbl-lc", name: "double",
            params: [{ kind: "param", id: "p-x-lc", name: "x", type: { kind: "basic", name: "Int" } }],
            effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "binop", id: "mul-lc", op: "*",
                left: { kind: "ident", id: "id-x-lc", name: "x" },
                right: { kind: "literal", id: "lit-2-lc", value: 2 },
            }],
        },
        {
            kind: "fn", id: "fn-main-dbl-lc", name: "main",
            params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "call", id: "call-dbl-lc",
                fn: { kind: "ident", id: "id-dbl-lc", name: "double" },
                args: [{ kind: "literal", id: "lit-21-lc", value: 21 }],
            }],
        },
    ],
};

const fibAst = {
    kind: "module", id: "mod-fib-lc", name: "FibSkill", schemaVersion: "1.1",
    imports: [], definitions: [
        {
            kind: "fn", id: "fn-fib-lc", name: "fib",
            params: [{ kind: "param", id: "p-n-lc", name: "n", type: { kind: "basic", name: "Int" } }],
            effects: ["pure"], returnType: { kind: "basic", name: "Int" },
            contracts: [{
                kind: "pre", id: "pre-fib-lc",
                condition: {
                    kind: "binop", id: "pre-cond-lc", op: ">=",
                    left: { kind: "ident", id: "id-n-pre-lc", name: "n" },
                    right: { kind: "literal", id: "lit-0-pre-lc", value: 0 },
                },
            }],
            body: [{
                kind: "if", id: "if-fib-lc",
                condition: {
                    kind: "binop", id: "cond-fib-lc", op: "<=",
                    left: { kind: "ident", id: "id-n-fib-lc", name: "n" },
                    right: { kind: "literal", id: "lit-1-fib-lc", value: 1 },
                },
                then: [{ kind: "ident", id: "id-n-ret-lc", name: "n" }],
                else: [{
                    kind: "binop", id: "add-fib-lc", op: "+",
                    left: {
                        kind: "call", id: "call-f1-lc",
                        fn: { kind: "ident", id: "id-fib1-lc", name: "fib" },
                        args: [{
                            kind: "binop", id: "sub1-lc", op: "-",
                            left: { kind: "ident", id: "id-n-s1-lc", name: "n" },
                            right: { kind: "literal", id: "lit-1-s1-lc", value: 1 },
                        }],
                    },
                    right: {
                        kind: "call", id: "call-f2-lc",
                        fn: { kind: "ident", id: "id-fib2-lc", name: "fib" },
                        args: [{
                            kind: "binop", id: "sub2-lc", op: "-",
                            left: { kind: "ident", id: "id-n-s2-lc", name: "n" },
                            right: { kind: "literal", id: "lit-2-s2-lc", value: 2 },
                        }],
                    },
                }],
            }],
        },
        {
            kind: "fn", id: "fn-main-fib-lc", name: "main",
            params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "call", id: "call-main-fib-lc",
                fn: { kind: "ident", id: "id-fib-main-lc", name: "fib" },
                args: [{ kind: "literal", id: "lit-10-lc", value: 10 }],
            }],
        },
    ],
};

const factorialAst = {
    kind: "module", id: "mod-fact-lc", name: "FactSkill", schemaVersion: "1.1",
    imports: [], definitions: [
        {
            kind: "fn", id: "fn-facth-lc", name: "factHelper",
            params: [
                { kind: "param", id: "p-n-fact-lc", name: "n", type: { kind: "basic", name: "Int" } },
                { kind: "param", id: "p-acc-lc", name: "acc", type: { kind: "basic", name: "Int" } },
            ],
            effects: ["pure"], returnType: { kind: "basic", name: "Int" },
            contracts: [{
                kind: "pre", id: "pre-fact-lc",
                condition: {
                    kind: "binop", id: "pre-cond-fact-lc", op: ">=",
                    left: { kind: "ident", id: "id-n-pre-fact-lc", name: "n" },
                    right: { kind: "literal", id: "lit-0-pre-fact-lc", value: 0 },
                },
            }],
            body: [{
                kind: "if", id: "if-fact-lc",
                condition: {
                    kind: "binop", id: "cond-fact-lc", op: "<=",
                    left: { kind: "ident", id: "id-n-fact-lc", name: "n" },
                    right: { kind: "literal", id: "lit-0-fact-lc", value: 0 },
                },
                then: [{ kind: "ident", id: "id-acc-lc", name: "acc" }],
                else: [{
                    kind: "call", id: "call-rec-lc",
                    fn: { kind: "ident", id: "id-facth-lc", name: "factHelper" },
                    args: [
                        {
                            kind: "binop", id: "sub-fact-lc", op: "-",
                            left: { kind: "ident", id: "id-n-sub-lc", name: "n" },
                            right: { kind: "literal", id: "lit-1-sub-lc", value: 1 },
                        },
                        {
                            kind: "binop", id: "mul-fact-lc", op: "*",
                            left: { kind: "ident", id: "id-n-mul-lc", name: "n" },
                            right: { kind: "ident", id: "id-acc-mul-lc", name: "acc" },
                        },
                    ],
                }],
            }],
        },
        {
            kind: "fn", id: "fn-main-fact-lc", name: "main",
            params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [],
            body: [{
                kind: "call", id: "call-main-fact-lc",
                fn: { kind: "ident", id: "id-facth-main-lc", name: "factHelper" },
                args: [
                    { kind: "literal", id: "lit-7-lc", value: 7 },
                    { kind: "literal", id: "lit-1-init-lc", value: 1 },
                ],
            }],
        },
    ],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Skill Lifecycle — crystallized intelligence pattern", () => {
    const skillPrograms = [
        { name: "double", ast: doubleAst, expectedReturn: 42 },
        { name: "fibonacci", ast: fibAst, expectedReturn: 55 },
        { name: "factorial", ast: factorialAst, expectedReturn: 5040 },
    ];

    describe("compile → package → store → invoke lifecycle", () => {
        for (const { name, ast, expectedReturn } of skillPrograms) {
            it(`should crystallize and invoke "${name}" (expected: ${expectedReturn})`, async () => {
                // Compile
                const { module, wasm, coverage } = await compileModule(ast);

                // Package
                const pkgResult = packageSkill({
                    module, wasm, coverage,
                    metadata: { name, description: `Test skill: ${name}` },
                });
                expect(pkgResult.ok).toBe(true);
                if (!pkgResult.ok) return;

                const skill = pkgResult.skill;

                // Verify package structure
                expect(skill.uasf).toBe("1.0");
                expect(skill.metadata.name).toBe(name);
                expect(skill.binary.wasmSize).toBeGreaterThan(0);
                expect(skill.binary.checksum).toMatch(/^sha256:/);
                expect(skill.verification.verified).toBe(true);
                expect(skill.interface.entryPoint).toBe("main");

                // JSON round-trip (simulates storage in agent memory)
                const serialized = JSON.stringify(skill);
                const deserialized = JSON.parse(serialized) as SkillPackage;

                // Invoke from deserialized package
                const invokeResult = await invokeSkill(deserialized);
                expect(invokeResult.ok).toBe(true);
                expect(invokeResult.exitCode).toBe(0);
                expect(invokeResult.returnValue).toBe(expectedReturn);
            });
        }
    });

    describe("skill library accumulation", () => {
        it("should build a library of 3 skills and invoke all from stored packages", async () => {
            const library: Map<string, SkillPackage> = new Map();

            // Phase 1: Compile and store all skills
            for (const { name, ast } of skillPrograms) {
                const { module, wasm, coverage } = await compileModule(ast);
                const pkgResult = packageSkill({
                    module, wasm, coverage,
                    metadata: { name },
                });
                expect(pkgResult.ok).toBe(true);
                if (!pkgResult.ok) continue;
                library.set(name, pkgResult.skill);
            }

            expect(library.size).toBe(3);

            // Phase 2: Invoke all from library with JSON round-trip
            for (const { name, expectedReturn } of skillPrograms) {
                const stored = library.get(name);
                expect(stored).toBeDefined();

                const deserialized = JSON.parse(JSON.stringify(stored)) as SkillPackage;
                const result = await invokeSkill(deserialized);
                expect(result.ok).toBe(true);
                expect(result.returnValue).toBe(expectedReturn);
            }
        }, 60_000);
    });
});
