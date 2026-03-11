// =============================================================================
// MCP Handler Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    handleSchema,
    handleExamples,
    handleValidate,
    handleCheck,
    handleCompile,
    handleCompileMulti,
    handleCheckMulti,
    handleRun,
    handleVersion,
    handleLint,
    handleExport,
    handleImportSkill,
    handleDebug,
    handleReplay,
    handlePatch,
    handleExplain,
} from "../../src/mcp/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");

// =============================================================================
// edict_schema
// =============================================================================

describe("handleSchema", () => {
    it("returns a valid JSON Schema object", () => {
        const result = handleSchema();
        expect(result.schema).toBeDefined();
        expect(typeof result.schema).toBe("object");
    });

    it("schema contains module kind and required properties", () => {
        const result = handleSchema();
        const schema = result.schema as Record<string, unknown>;
        const str = JSON.stringify(schema);
        // Should reference "module" (the kind value) and key properties
        expect(str).toContain("module");
        expect(str).toContain("definitions");
        expect(str).toContain("imports");
    });

    it("schema matches the file on disk", () => {
        const result = handleSchema();
        const raw = readFileSync(
            resolve(projectRoot, "schema", "edict.schema.json"),
            "utf-8",
        );
        expect(result.schema).toEqual(JSON.parse(raw));
    });
});

// =============================================================================
// edict_examples
// =============================================================================

describe("handleExamples", () => {
    it("returns example programs with consistent count", () => {
        const result = handleExamples();
        expect(result.count).toBeGreaterThanOrEqual(10);
        expect(result.examples).toHaveLength(result.count);
    });

    it("each example has a name and a valid AST object", () => {
        const result = handleExamples();
        for (const ex of result.examples) {
            expect(typeof ex.name).toBe("string");
            expect(ex.name.length).toBeGreaterThan(0);

            if (ex.isMultiModule) {
                // Multi-module examples are JSON arrays of modules
                expect(Array.isArray(ex.ast)).toBe(true);
                for (const mod of ex.ast as Record<string, unknown>[]) {
                    expect(mod["kind"]).toBe("module");
                }
            } else {
                expect(typeof ex.ast).toBe("object");
                const ast = ex.ast as Record<string, unknown>;
                expect(ast["kind"]).toBe("module");
            }
        }
    });

    it("includes the hello example", () => {
        const result = handleExamples();
        const hello = result.examples.find((e) => e.name === "hello");
        expect(hello).toBeDefined();
    });
});

// =============================================================================
// edict_validate
// =============================================================================

describe("handleValidate", () => {
    it("valid AST → ok: true", () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const result = handleValidate(hello);
        expect(result.ok).toBe(true);
        expect(result.errors).toBeUndefined();
    });

    it("invalid AST (missing kind) → ok: false with errors", () => {
        const result = handleValidate({ id: "x", name: "test" });
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("non-object input → ok: false", () => {
        const result = handleValidate("not an object");
        expect(result.ok).toBe(false);
    });
});

// =============================================================================
// edict_check
// =============================================================================

describe("handleCheck", () => {
    it("valid program passes all checks", async () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const result = await handleCheck(hello);
        expect(result.ok).toBe(true);
    });

    it("program with type error → errors include type_mismatch", async () => {
        // A function returning String but declared as Int
        const badAst = {
            kind: "module",
            id: "mod-bad-001",
            name: "bad",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-bad-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: [],
                    contracts: [],
                    body: [
                        {
                            kind: "literal",
                            id: "lit-str-001",
                            value: "not an int",
                        },
                    ],
                },
            ],
        };
        const result = await handleCheck(badAst);
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.error === "type_mismatch")).toBe(true);
    });
});

// =============================================================================
// edict_compile
// =============================================================================

describe("handleCompile", () => {
    it("valid program → base64 WASM", async () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const result = await handleCompile(hello);
        expect(result.ok).toBe(true);
        expect(result.wasm).toBeDefined();
        expect(typeof result.wasm).toBe("string");

        // Verify it's valid base64 — decode should produce WASM magic bytes
        const bytes = Buffer.from(result.wasm!, "base64");
        expect(bytes.length).toBeGreaterThan(0);
        // WASM magic: \0asm
        expect(bytes[0]).toBe(0x00);
        expect(bytes[1]).toBe(0x61); // 'a'
        expect(bytes[2]).toBe(0x73); // 's'
        expect(bytes[3]).toBe(0x6d); // 'm'
    });

    it("invalid program → errors", async () => {
        const result = await handleCompile({ kind: "module", id: "x", name: "bad", imports: [], definitions: [] });
        // Empty module might still compile (no functions = valid). Test with truly invalid:
        const bad = await handleCompile({ not: "an ast" });
        expect(bad.ok).toBe(false);
        expect(bad.errors).toBeDefined();
    });
});

// =============================================================================
// edict_run
// =============================================================================

describe("handleRun", () => {
    it("runs hello world WASM → captures output", async () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const compiled = await handleCompile(hello);
        expect(compiled.ok).toBe(true);

        const result = await handleRun(compiled.wasm!);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("Hello, World!");
    });

    it("invalid base64 → error result", async () => {
        const result = await handleRun("not-valid-wasm-base64===");
        expect(result.exitCode).toBe(1);
        expect(result.output.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// End-to-end roundtrip
// =============================================================================

describe("end-to-end roundtrip", () => {
    it("schema → compile hello → run → output", async () => {
        // Step 1: Schema is available
        const schema = handleSchema();
        expect(schema.schema).toBeDefined();

        // Step 2: Examples are available
        const examples = handleExamples();
        expect(examples.count).toBeGreaterThan(0);

        // Step 3: Compile an example
        const hello = examples.examples.find((e) => e.name === "hello");
        expect(hello).toBeDefined();

        const compiled = await handleCompile(hello!.ast);
        expect(compiled.ok).toBe(true);
        expect(compiled.wasm).toBeDefined();

        // Step 4: Run it
        const result = await handleRun(compiled.wasm!);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("Hello, World!");
        expect(result.returnValue).toBe(0);
    });

    it("all examples compile successfully", async () => {
        // Examples with host-dispatched constructs (tool_call) can't emit WASM
        const COMPILE_SKIP = new Set(["tool-calls"]);
        const examples = handleExamples();
        for (const ex of examples.examples) {
            if (COMPILE_SKIP.has(ex.name)) continue;
            const compiled = ex.isMultiModule
                ? await handleCompileMulti(ex.ast as unknown[])
                : await handleCompile(ex.ast);
            expect(compiled.ok, `example ${ex.name} should compile`).toBe(true);
        }
    });

    it("all examples pass validation", async () => {
        const examples = handleExamples();
        for (const ex of examples.examples) {
            const result = ex.isMultiModule
                ? await handleCheckMulti(ex.ast as unknown[])
                : await handleCheck(ex.ast);
            expect(result.ok, `example ${ex.name} should pass check`).toBe(true);
        }
    });

    it("edict_version returns valid capability info", () => {
        const result = handleVersion();
        expect(result.version).toBeDefined();
        expect(result.schemaVersion).toBeDefined();
        expect(result.builtins.length).toBeGreaterThan(0);
        expect(result.features.contracts).toBeDefined();
    });
});

// =============================================================================
// handleSchema — format variants
// =============================================================================

describe("handleSchema — format variants", () => {
    it("returns minimal schema with reduced token estimate", () => {
        const full = handleSchema("full");
        const minimal = handleSchema("minimal");
        expect(minimal.format).toBe("minimal");
        expect(minimal.tokenEstimate).toBeLessThan(full.tokenEstimate);
    });

    it("returns compact schema reference", () => {
        const compact = handleSchema("compact");
        expect(compact.format).toBe("compact");
        expect(compact.schema).toBeDefined();
    });
});

// =============================================================================
// handleLint
// =============================================================================

describe("handleLint", () => {
    it("valid program with no warnings → ok: true, empty warnings", () => {
        const ast = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const result = handleLint(ast);
        expect(result.ok).toBe(true);
        expect(result.warnings).toBeDefined();
    });

    it("invalid AST → ok: false", () => {
        const result = handleLint({ not: "an ast" });
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
    });
});

// =============================================================================
// handleExport
// =============================================================================

describe("handleExport", () => {
    it("valid program → exports UASF skill package", async () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const result = await handleExport(hello, { name: "hello", version: "1.0.0" });
        expect(result.ok).toBe(true);
        expect(result.skill).toBeDefined();
        const skill = result.skill as Record<string, any>;
        expect(skill.uasf).toBe("1.0");
        expect(skill.metadata.name).toBe("hello");
        expect(skill.binary.wasm).toBeDefined();
    });

    it("invalid AST → errors", async () => {
        const result = await handleExport({ not: "an ast" }, {});
        expect(result.ok).toBe(false);
    });
});

// =============================================================================
// handleImportSkill
// =============================================================================

describe("handleImportSkill", () => {
    it("invalid format → error", async () => {
        const result = await handleImportSkill(null);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("Invalid skill package format");
    });

    it("checksum mismatch → error", async () => {
        const result = await handleImportSkill({
            binary: { wasm: "AAAA", checksum: "sha256:wrong" },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("Checksum mismatch");
    });
});

// =============================================================================
// handleDebug
// =============================================================================

describe("handleDebug", () => {
    it("valid program → returns debug info", async () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const result = await handleDebug(hello);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.stepsExecuted).toBeDefined();
    });

    it("invalid AST → errors", async () => {
        const result = await handleDebug({ not: "an ast" });
        expect(result.ok).toBe(false);
    });
});

// =============================================================================
// handleReplay
// =============================================================================

describe("handleReplay", () => {
    it("record + replay round-trip produces same output", async () => {
        const hello = JSON.parse(
            readFileSync(
                resolve(projectRoot, "examples", "hello.edict.json"),
                "utf-8",
            ),
        );
        const compiled = await handleCompile(hello);
        expect(compiled.ok).toBe(true);

        // Record
        const runResult = await handleRun(compiled.wasm!, undefined, undefined, true);
        expect(runResult.exitCode).toBe(0);
        expect(runResult.replayToken).toBeDefined();

        // Replay
        const replayResult = await handleReplay(compiled.wasm!, runResult.replayToken!);
        expect(replayResult.exitCode).toBe(0);
        expect(replayResult.output).toBe(runResult.output);
    });
});

// =============================================================================
// handlePatch
// =============================================================================

describe("handlePatch", () => {
    it("valid patch with returnAst → includes patchedAst", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-main-001", name: "main",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 42 }],
            }],
        };
        const result = await handlePatch(
            ast,
            [{ nodeId: "lit-001", op: "replace", field: "value", value: 99 }],
            true,
        );
        expect(result.ok).toBe(true);
        expect(result.patchedAst).toBeDefined();
    });

    it("invalid patch target → errors", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-main-001", name: "main",
                params: [], effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 42 }],
            }],
        };
        const result = await handlePatch(
            ast,
            [{ nodeId: "nonexistent", op: "replace", field: "value", value: 99 }],
            false,
        );
        expect(result.ok).toBe(false);
    });
});

// =============================================================================
// handleExplain
// =============================================================================

describe("handleExplain", () => {
    it("known error type → found: true with repair strategy", () => {
        const result = handleExplain({ error: "type_mismatch" });
        expect(result.found).toBe(true);
        if (result.found) {
            expect(result.pipelineStage).toBeDefined();
            expect(result.repairStrategy.length).toBeGreaterThan(0);
        }
    });

    it("unknown error type → found: false", () => {
        const result = handleExplain({ error: "totally_unknown_error" });
        expect(result.found).toBe(false);
    });

    it("no discriminator → found: false", () => {
        const result = handleExplain({ foo: "bar" });
        expect(result.found).toBe(false);
    });
});
