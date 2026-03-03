#!/usr/bin/env node
// =============================================================================
// Edict MCP Server — Agent interface to the Edict compiler pipeline
// =============================================================================
// Usage: tsx src/mcp/server.ts   (or: npm run mcp)
// Transport: stdio (standard for local MCP servers)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
    handleSchema,
    handleExamples,
    handleValidate,
    handleCheck,
    handleCompile,
    handleRun,
} from "./handlers.js";

// =============================================================================
// Server setup
// =============================================================================

const server = new McpServer({
    name: "edict",
    version: "0.1.0",
});

// =============================================================================
// Tools
// =============================================================================

// edict_schema — Return the JSON Schema for EdictModule
server.tool(
    "edict_schema",
    "Get the JSON Schema defining valid Edict AST programs. Agents should read this to understand the AST format before writing programs.",
    {},
    async () => {
        const result = handleSchema();
        return {
            content: [{ type: "text", text: JSON.stringify(result.schema) }],
        };
    },
);

// edict_examples — Return all example programs
server.tool(
    "edict_examples",
    "Get 10 example Edict programs as JSON ASTs, covering all language features. Use these as reference when writing new programs.",
    {},
    async () => {
        const result = handleExamples();
        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2),
            }],
        };
    },
);

// edict_validate — Structural validation only
server.tool(
    "edict_validate",
    "Validate an Edict AST structurally (Phase 1 only). Checks node kinds, required fields, duplicate IDs. Does NOT check types, effects, or contracts. Use edict_check for full validation.",
    { ast: z.record(z.unknown()).describe("The Edict AST to validate (JSON object with kind: 'module')") },
    async ({ ast }) => {
        const result = handleValidate(ast);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    },
);

// edict_check — Full pipeline (validate → resolve → typeCheck → effectCheck → contractVerify)
server.tool(
    "edict_check",
    "Run the full Edict compiler pipeline: validate → name resolve → type check → effect check → contract verify. Returns structured errors if any phase fails.",
    { ast: z.record(z.unknown()).describe("The Edict AST to check (JSON object with kind: 'module')") },
    async ({ ast }) => {
        const result = await handleCheck(ast);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    },
);

// edict_compile — Full check + compile to WASM
server.tool(
    "edict_compile",
    "Check and compile an Edict AST to WASM. Runs the full check pipeline first. Returns base64-encoded WASM binary on success, or structured errors on failure.",
    { ast: z.record(z.unknown()).describe("The Edict AST to compile (JSON object with kind: 'module')") },
    async ({ ast }) => {
        const result = await handleCompile(ast);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    },
);

// edict_run — Execute WASM binary
server.tool(
    "edict_run",
    "Execute a compiled Edict WASM binary. Pass the base64-encoded WASM string from edict_compile. Returns captured output and exit code.",
    { wasm: z.string().describe("Base64-encoded WASM binary from edict_compile") },
    async ({ wasm }) => {
        try {
            const result = await handleRun(wasm);
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        } catch (e) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
                        exitCode: 1,
                    }),
                }],
                isError: true,
            };
        }
    },
);

// =============================================================================
// Resources
// =============================================================================

server.resource(
    "schema",
    "edict://schema",
    { description: "The full JSON Schema defining valid Edict AST programs", mimeType: "application/json" },
    async () => {
        const result = handleSchema();
        return {
            contents: [{
                uri: "edict://schema",
                mimeType: "application/json",
                text: JSON.stringify(result.schema, null, 2),
            }],
        };
    },
);

server.resource(
    "examples",
    "edict://examples",
    { description: "10 example Edict programs as JSON ASTs", mimeType: "application/json" },
    async () => {
        const result = handleExamples();
        return {
            contents: [{
                uri: "edict://examples",
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
            }],
        };
    },
);

// =============================================================================
// Start
// =============================================================================

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((e) => {
    console.error("Edict MCP server failed to start:", e);
    process.exit(1);
});
