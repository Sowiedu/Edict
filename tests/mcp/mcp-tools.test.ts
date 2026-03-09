// =============================================================================
// MCP Tool/Resource Wrapper Tests
// =============================================================================
// Tests declarative MCP tool and resource wrappers for coverage.
// The underlying handler logic is tested in handlers.test.ts — these tests
// exercise the thin wrapper layer (schema definition, error paths, etc.).

import { describe, it, expect } from "vitest";
import { lintTool } from "../../src/mcp/tools/lint.js";
import { runTool } from "../../src/mcp/tools/run.js";
import { schemaPatchResource } from "../../src/mcp/resources/schema-patch.js";
import { ALL_TOOLS } from "../../src/mcp/tools/index.js";
import { ALL_RESOURCES } from "../../src/mcp/resources/index.js";

// =============================================================================
// Tool wrappers
// =============================================================================

describe("MCP tool wrappers", () => {
    describe("lintTool", () => {
        it("returns warnings for a valid AST", async () => {
            const ast = {
                kind: "module", id: "mod-001", name: "test", imports: [],
                definitions: [{
                    kind: "fn", id: "fn-001", name: "helper", params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
            };
            const result = await lintTool.handler({ ast });
            expect(result.isError).toBeUndefined();
            const parsed = JSON.parse((result.content[0] as any).text);
            expect(parsed).toHaveProperty("warnings");
            expect(parsed).toHaveProperty("count");
        });

        it("returns errors for an invalid AST", async () => {
            const result = await lintTool.handler({ ast: { invalid: true } });
            expect(result.isError).toBe(true);
            const parsed = JSON.parse((result.content[0] as any).text);
            expect(parsed).toHaveProperty("errors");
        });
    });

    describe("runTool", () => {
        it("returns error for invalid WASM bytes", async () => {
            // An empty string decodes to 0 bytes which is not valid WASM —
            // WebAssembly.compile throws, caught by the handler's catch block.
            const result = await runTool.handler({ wasmBase64: "" });
            // The handler wraps the error string in content
            expect(result.content).toHaveLength(1);
            expect((result.content[0] as any).text).toBeDefined();
        });
    });
});

// =============================================================================
// Resource wrappers
// =============================================================================

describe("MCP resource wrappers", () => {
    describe("schemaPatchResource", () => {
        it("returns patch schema JSON", async () => {
            const result = await schemaPatchResource.handler(new URL("edict://schema/patch"), {});
            expect(result).toHaveProperty("contents");
            expect(result.contents).toHaveLength(1);
            expect(result.contents[0].uri).toBe("edict://schema/patch");
            expect(result.contents[0].mimeType).toBe("application/json");
            const parsed = JSON.parse(result.contents[0].text);
            expect(parsed).toBeDefined();
        });
    });
});

// =============================================================================
// Barrel exports
// =============================================================================

describe("MCP barrel exports", () => {
    it("ALL_TOOLS exports the expected number of tools", () => {
        expect(ALL_TOOLS.length).toBe(15);
        const names = ALL_TOOLS.map(t => t.name);
        expect(names).toContain("edict_lint");
        expect(names).toContain("edict_run");
        expect(names).toContain("edict_compile");
        expect(names).toContain("edict_compose");
        expect(names).toContain("edict_generate_tests");
    });

    it("ALL_RESOURCES exports the expected number of resources", () => {
        expect(ALL_RESOURCES.length).toBe(5);
        const uris = ALL_RESOURCES.map(r => r.uri);
        expect(uris).toContain("edict://schema/patch");
    });
});
