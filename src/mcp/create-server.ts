import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
    handleSchema,
    handleExamples,
    handleValidate,
    handleCheck,
    handleCompile,
    handleRun,
    handleVersion,
} from "./handlers.js";

// =============================================================================
// Server setup
// =============================================================================

export function createEdictServer(): McpServer {
    const server = new McpServer({
        name: "edict-compiler",
        version: "0.1.0",
    });

    // =============================================================================
    // Tools
    // =============================================================================

    // edict_schema — Return the JSON Schema for EdictModule
    server.tool("edict_schema", {}, async () => {
        const result = handleSchema();
        return {
            content: [{ type: "text", text: JSON.stringify(result.schema) }],
        };
    });

    // edict_version — Return capability info
    server.tool("edict_version", {}, async () => {
        const result = handleVersion();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    });

    // edict_examples — Return all example programs
    server.tool("edict_examples", {}, async () => {
        const result = handleExamples();
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    });

    // edict_validate — Validate an AST against the JSON schema
    server.tool(
        "edict_validate",
        "Validate an Edict AST against the compiler's JSON schema without typing or compiling. Use this as a first pass.",
        {
            ast: z.any().describe("The Edict JSON AST to validate"),
        },
        async ({ ast }) => {
            const result = handleValidate(ast);
            if (result.ok) {
                return { content: [{ type: "text", text: "AST is schema-valid." }] };
            } else {
                return {
                    content: [
                        { type: "text", text: JSON.stringify({ errors: result.errors }, null, 2) },
                    ],
                    isError: true,
                };
            }
        },
    );

    // edict_check — Type check, effect check, and verify contracts
    server.tool(
        "edict_check",
        "Run the full semantic checker (name resolution, type checking, effect checking, contract verification) on an AST.",
        {
            ast: z.any().describe("The Edict JSON AST to check"),
        },
        async ({ ast }) => {
            const result = await handleCheck(ast);
            if (result.ok) {
                return { content: [{ type: "text", text: "AST passed all semantic checks." }] };
            } else {
                return {
                    content: [
                        { type: "text", text: JSON.stringify({ errors: result.errors }, null, 2) },
                    ],
                    isError: true,
                };
            }
        },
    );

    // edict_compile — Compile a checked AST to a base64 encoded WASM module
    server.tool(
        "edict_compile",
        "Compile a semantically valid Edict AST into a WebAssembly module. Returns the WASM binary encoded as a base64 string.",
        {
            ast: z.any().describe("The Edict JSON AST to compile"),
        },
        async ({ ast }) => {
            const result = await handleCompile(ast);
            if (result.ok && result.wasm) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    message: "Compilation successful.",
                                    wasm: result.wasm,
                                    binarySize: result.wasm.length, // rough estimate
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            } else {
                return {
                    content: [
                        { type: "text", text: JSON.stringify({ errors: result.errors }, null, 2) },
                    ],
                    isError: true,
                };
            }
        },
    );

    // edict_run — Run a base64 encoded WASM module and return its output
    server.tool(
        "edict_run",
        "Execute a compiled WebAssembly module (provided as base64) using the Edict runtime host. Returns standard output and exit code.",
        {
            wasmBase64: z.string().describe("The base64 encoded WebAssembly module to execute"),
        },
        async ({ wasmBase64 }) => {
            try {
                const result = await handleRun(wasmBase64);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (err: any) {
                return {
                    content: [{ type: "text", text: String(err) }],
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
        {
            description: "The full JSON Schema defining valid Edict AST programs",
            mimeType: "application/json",
        },
        async () => {
            const result = handleSchema();
            return {
                contents: [
                    {
                        uri: "edict://schema",
                        mimeType: "application/json",
                        text: JSON.stringify(result.schema, null, 2),
                    },
                ],
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
                contents: [
                    {
                        uri: "edict://examples",
                        mimeType: "application/json",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        },
    );

    return server;
}
