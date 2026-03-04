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
    handlePatch,
    handleErrorCatalog,
} from "./handlers.js";
import {
    promptWriteProgram,
    promptFixError,
    promptAddContracts,
    promptReviewAst,
} from "./prompts.js";

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
    server.tool(
        "edict_schema",
        "Return the JSON Schema defining valid Edict AST programs. Use format 'minimal' for reduced token cost (strips descriptions).",
        {
            format: z.enum(["full", "minimal"]).optional().default("full").describe("Schema format: 'full' (default, with descriptions) or 'minimal' (stripped for token efficiency)"),
        },
        async ({ format }) => {
            const result = handleSchema(format);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ schema: result.schema, format: result.format, tokenEstimate: result.tokenEstimate }),
                    },
                ],
            };
        },
    );

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
        "Execute a compiled WebAssembly module (provided as base64) using the Edict runtime host. Returns standard output, exit code, and any sandbox limit errors. Supports optional execution limits (timeout, memory).",
        {
            wasmBase64: z.string().describe("The base64 encoded WebAssembly module to execute"),
            limits: z.object({
                timeoutMs: z.number().optional().describe("Max execution time in milliseconds (default: 5000, min: 100)"),
                maxMemoryMb: z.number().optional().describe("Max WASM memory in MB (compile-time limit, default: 1)"),
            }).optional().describe("Optional execution sandbox limits"),
        },
        async ({ wasmBase64, limits }) => {
            try {
                const result = await handleRun(wasmBase64, limits);
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

    // edict_patch — Apply targeted AST patches by nodeId and re-check
    server.tool(
        "edict_patch",
        "Apply surgical patches to an Edict AST by nodeId, then run the full check pipeline. Use this to fix errors without resubmitting the entire AST. Each patch specifies a nodeId, an operation (replace/delete/insert), and the relevant field/value.",
        {
            ast: z.any().describe("The base Edict JSON AST to patch"),
            patches: z.array(z.object({
                nodeId: z.string().describe("ID of the target AST node"),
                op: z.enum(["replace", "delete", "insert"]).describe("Operation: replace a field, delete a node, or insert into an array"),
                field: z.string().optional().describe("Field name (required for replace/insert)"),
                value: z.any().optional().describe("New value (required for replace/insert)"),
                index: z.number().optional().describe("Array index for insert (defaults to end)"),
            })).describe("Array of patches to apply"),
            returnAst: z.boolean().optional().default(false).describe("Include the patched AST in the response (costs tokens, off by default)"),
        },
        async ({ ast, patches, returnAst }) => {
            const result = await handlePatch(ast, patches, returnAst);
            if (result.ok) {
                const response: Record<string, unknown> = { ok: true };
                if (result.patchedAst) response.patchedAst = result.patchedAst;
                return {
                    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
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

    // edict_errors — Return machine-readable catalog of all error types
    server.tool("edict_errors", {}, async () => {
        const result = handleErrorCatalog();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    });

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
            const result = handleSchema("full");
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
        "schema-minimal",
        "edict://schema/minimal",
        {
            description: "Token-optimized JSON Schema (descriptions stripped) for minimal context window usage",
            mimeType: "application/json",
        },
        async () => {
            const result = handleSchema("minimal");
            return {
                contents: [
                    {
                        uri: "edict://schema/minimal",
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

    server.resource(
        "errors",
        "edict://errors",
        {
            description: "Machine-readable catalog of all structured error types with fields, pipeline stages, and example cause/fix ASTs",
            mimeType: "application/json",
        },
        async () => {
            const result = handleErrorCatalog();
            return {
                contents: [
                    {
                        uri: "edict://errors",
                        mimeType: "application/json",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        },
    );

    // =============================================================================
    // Prompts
    // =============================================================================

    server.prompt(
        "write_program",
        "System prompt for writing a new Edict program from a task description. Includes minimal schema, example, and builtin list.",
        { task: z.string().describe("Description of what the program should do") },
        async ({ task }) => {
            const result = promptWriteProgram(task);
            return result;
        },
    );

    server.prompt(
        "fix_error",
        "Prompt for fixing a structured Edict compiler error. Includes error taxonomy and fix strategy.",
        { error: z.string().describe("The structured error JSON from the compiler") },
        async ({ error }) => {
            const result = promptFixError(error);
            return result;
        },
    );

    server.prompt(
        "add_contracts",
        "Prompt for adding pre/postcondition contracts to existing Edict functions for Z3 formal verification.",
        { ast: z.string().describe("The Edict JSON AST to add contracts to") },
        async ({ ast }) => {
            const result = promptAddContracts(ast);
            return result;
        },
    );

    server.prompt(
        "review_ast",
        "Prompt for reviewing an Edict AST for quality issues (unused variables, missing effects, dead code, etc.).",
        { ast: z.string().describe("The Edict JSON AST to review") },
        async ({ ast }) => {
            const result = promptReviewAst(ast);
            return result;
        },
    );

    return server;
}
