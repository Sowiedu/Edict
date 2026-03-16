import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { packageSkill } from "../../src/skills/package.js";
import { invokeSkill } from "../../src/skills/invoke.js";
import type { EdictModule } from "../../src/ast/nodes.js";

// A simple program: main() returns 3 + 4 = 7
const addAst = {
    kind: "module",
    id: "mod1",
    name: "AddSkill",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn_main",
            name: "main",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [
                {
                    kind: "binop",
                    id: "add1",
                    op: "+",
                    left: { kind: "literal", id: "lit3", value: 3 },
                    right: { kind: "literal", id: "lit4", value: 4 },
                },
            ],
        },
    ],
};

// A module without a main function
const noMainAst = {
    kind: "module",
    id: "mod2",
    name: "NoMain",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn_helper",
            name: "helper",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "literal", id: "lit1", value: 42 }],
        },
    ],
};

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

describe("Skill Package — standalone library", () => {
    describe("packageSkill()", () => {
        it("should produce a valid skill package with all UASF fields", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);

            const result = packageSkill({
                module,
                wasm,
                coverage,
                metadata: {
                    name: "AddSkill",
                    version: "2.0.0",
                    description: "Adds 3 + 4",
                    author: "TestAgent",
                },
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const skill = result.skill;
            expect(skill.uasf).toBe("1.0");
            expect(skill.metadata.name).toBe("AddSkill");
            expect(skill.metadata.version).toBe("2.0.0");
            expect(skill.metadata.description).toBe("Adds 3 + 4");
            expect(skill.metadata.author).toBe("TestAgent");
            expect(skill.metadata.createdAt).toBeDefined();

            expect(skill.binary.wasm).toBeDefined();
            expect(typeof skill.binary.wasm).toBe("string");
            expect(skill.binary.wasmSize).toBeGreaterThan(0);
            expect(skill.binary.checksum).toMatch(/^sha256:/);

            expect(skill.interface.entryPoint).toBe("main");
            expect(skill.interface.params).toHaveLength(0);
            expect(skill.interface.returns.type).toBe("Int");
            expect(skill.interface.effects).toContain("pure");

            expect(skill.capabilities.required).toEqual([]);
        });

        it("should return error when no main function exists", async () => {
            const { module, wasm, coverage } = await compileModule(noMainAst);

            const result = packageSkill({ module, wasm, coverage });

            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error).toContain("main");
        });

        it("should use module name as default skill name", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);

            const result = packageSkill({ module, wasm, coverage });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.skill.metadata.name).toBe("AddSkill");
        });
    });

    describe("invokeSkill()", () => {
        it("should execute a packaged skill and return the result", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);
            const pkgResult = packageSkill({ module, wasm, coverage });
            expect(pkgResult.ok).toBe(true);
            if (!pkgResult.ok) return;

            const invokeResult = await invokeSkill(pkgResult.skill);

            expect(invokeResult.ok).toBe(true);
            expect(invokeResult.exitCode).toBe(0);
            expect(invokeResult.returnValue).toBe(7);
        });

        it("should reject a skill with tampered checksum", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);
            const pkgResult = packageSkill({ module, wasm, coverage });
            expect(pkgResult.ok).toBe(true);
            if (!pkgResult.ok) return;

            // Tamper with checksum
            const tampered = { ...pkgResult.skill, binary: { ...pkgResult.skill.binary, checksum: "sha256:badf00d" } };

            const invokeResult = await invokeSkill(tampered);

            expect(invokeResult.ok).toBe(false);
            expect(invokeResult.error).toContain("Checksum mismatch");
        });

        it("should reject a skill with missing binary", async () => {
            const invokeResult = await invokeSkill({ binary: {} } as any);

            expect(invokeResult.ok).toBe(false);
            expect(invokeResult.error).toContain("Invalid skill package format");
        });
    });

    describe("round-trip: package → invoke", () => {
        it("should round-trip a compiled program through package and invoke", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);

            // Package
            const pkgResult = packageSkill({
                module,
                wasm,
                coverage,
                metadata: { name: "RoundTripTest" },
            });
            expect(pkgResult.ok).toBe(true);
            if (!pkgResult.ok) return;

            // Serialize to JSON and back (simulates storage in agent memory)
            const serialized = JSON.stringify(pkgResult.skill);
            const deserialized = JSON.parse(serialized);

            // Invoke from deserialized package
            const invokeResult = await invokeSkill(deserialized);

            expect(invokeResult.ok).toBe(true);
            expect(invokeResult.exitCode).toBe(0);
            expect(invokeResult.returnValue).toBe(7);
        });
    });

    describe("typeToString()", () => {
        // Import the function to test directly
        it("should convert all TypeExpr kinds to strings", async () => {
            const { typeToString } = await import("../../src/skills/package.js");

            expect(typeToString({ kind: "basic", name: "Int" })).toBe("Int");
            expect(typeToString({ kind: "array", element: { kind: "basic", name: "Int" } })).toBe("Array<Int>");
            expect(typeToString({ kind: "option", inner: { kind: "basic", name: "String" } })).toBe("Option<String>");
            expect(typeToString({
                kind: "result",
                ok: { kind: "basic", name: "String" },
                err: { kind: "basic", name: "String" },
            })).toBe("Result<String, String>");
            expect(typeToString({ kind: "unit_type", base: "Temperature", unit: "celsius" })).toBe("Temperature<celsius>");
            expect(typeToString({
                kind: "refined",
                variable: "x",
                base: { kind: "basic", name: "Int" },
                predicate: { kind: "literal", id: "lit", value: true },
            })).toBe("{ x: Int | ... }");
            expect(typeToString({
                kind: "confidence",
                base: { kind: "basic", name: "Float" },
                confidence: 0.95,
            })).toBe("Confidence<Float, 0.95>");
            expect(typeToString({
                kind: "provenance",
                base: { kind: "basic", name: "String" },
                sources: ["api", "cache"],
            })).toBe('Provenance<String, ["api", "cache"]>');
            expect(typeToString({
                kind: "capability",
                permissions: ["io", "net"],
            })).toBe('Capability<"io", "net">');
            expect(typeToString({
                kind: "fn_type",
                params: [{ kind: "basic", name: "Int" }],
                returnType: { kind: "basic", name: "Bool" },
                effects: [],
            })).toBe("(Int) -> Bool");
            expect(typeToString({ kind: "named", name: "MyRecord" })).toBe("MyRecord");
            expect(typeToString({
                kind: "tuple",
                elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }],
            })).toBe("(Int, String)");
            // Unknown kind → default "unknown"
            expect(typeToString({ kind: "something_else" } as any)).toBe("unknown");
        });
    });

    describe("metadata fallback paths", () => {
        it("should fall back to 'unknown_skill' when metadata.name and module.name are both empty", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);
            // Override module name to empty string, pass no metadata name
            const emptyNameModule = { ...module, name: "" } as EdictModule;

            const result = packageSkill({ module: emptyNameModule, wasm, coverage, metadata: { name: "" } });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.skill.metadata.name).toBe("unknown_skill");
        });

        it("should fall back to module.name when metadata.name is undefined", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);

            const result = packageSkill({ module, wasm, coverage, metadata: {} });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.skill.metadata.name).toBe("AddSkill");
        });

        it("should use default version/description/author when not provided", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);

            const result = packageSkill({ module, wasm, coverage });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.skill.metadata.version).toBe("1.0.0");
            expect(result.skill.metadata.description).toBe("");
            expect(result.skill.metadata.author).toBe("unknown");
        });

        it("should handle param without explicit type annotation", async () => {
            const { module, wasm, coverage } = await compileModule(addAst);
            // Mutate the module to simulate a param without type
            const mutatedModule = JSON.parse(JSON.stringify(module)) as EdictModule;
            const mainFn = mutatedModule.definitions.find(d => d.kind === "fn" && d.name === "main");
            if (mainFn && mainFn.kind === "fn") {
                // Add a fake param without type to exercise the `"unknown"` fallback
                mainFn.params = [{ kind: "param", id: "p-no-type", name: "x" } as any];
            }

            const result = packageSkill({ module: mutatedModule, wasm, coverage });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.skill.interface.params[0].type).toBe("unknown");
        });
    });
});
