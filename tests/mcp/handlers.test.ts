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
    handleRun,
    handleVersion,
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
    it("returns 15 example programs", () => {
        const result = handleExamples();
        expect(result.count).toBe(15);
        expect(result.examples).toHaveLength(15);
    });

    it("each example has a name and a valid AST object", () => {
        const result = handleExamples();
        for (const ex of result.examples) {
            expect(typeof ex.name).toBe("string");
            expect(ex.name.length).toBeGreaterThan(0);
            expect(typeof ex.ast).toBe("object");

            const ast = ex.ast as Record<string, unknown>;
            expect(ast["kind"]).toBe("module");
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
        const examples = handleExamples();
        for (const ex of examples.examples) {
            const compiled = await handleCompile(ex.ast);
            expect(compiled.ok, `example ${ex.name} should compile`).toBe(true);
        }
    });

    it("all examples pass validation", async () => {
        const examples = handleExamples();
        for (const ex of examples.examples) {
            const result = await handleCheck(ex.ast);
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
