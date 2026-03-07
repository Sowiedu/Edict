// =============================================================================
// MCP Integration Tests
// =============================================================================
// Tests all MCP tools, resources, and prompts end-to-end via the MCP protocol.
// Connects to an in-process HTTP server using the MCP SDK client.
// Resolves issue #49.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import crypto from "node:crypto";
import { Server } from "node:http";
import { createEdictServer } from "../../src/mcp/create-server.js";

// =============================================================================
// Shared server setup — single server, multiple test cases
// =============================================================================

let expressServer: Server;
let port = 0;
let client: Client;
const transports: Record<string, StreamableHTTPServerTransport> = {};

beforeAll(async () => {
    const app = createMcpExpressApp();
    app.use(express.json({ limit: "50mb" }));

    app.post("/mcp", async (req, res) => {
        let transport: StreamableHTTPServerTransport;
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && transports[sessionId]) {
            transport = transports[sessionId];
        } else if (req.body && req.body.method === "initialize") {
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => crypto.randomUUID(),
                onsessioninitialized: (sid) => {
                    transports[sid] = transport;
                },
            });

            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                    delete transports[sid];
                }
            };

            const server = createEdictServer();
            await server.connect(transport);
        } else {
            res.status(400).json({
                jsonrpc: "2.0",
                error: { code: -32000, message: "No valid session ID provided" },
                id: null,
            });
            return;
        }

        await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }
        await transports[sessionId].handleRequest(req, res);
    });

    app.delete("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }
        await transports[sessionId].handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
        expressServer = app.listen(0, () => {
            port = (expressServer.address() as any).port;
            resolve();
        });
    });

    // Connect MCP client
    const url = new URL(`http://localhost:${port}/mcp`);
    const clientTransport = new StreamableHTTPClientTransport(url);
    client = new Client(
        { name: "integration-test-client", version: "1.0.0" },
        { capabilities: {} },
    );
    await client.connect(clientTransport);
});

afterAll(async () => {
    await client.close();
    if (expressServer) {
        expressServer.close();
    }
});

// =============================================================================
// Helper: call a tool and parse the JSON text response
// =============================================================================

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.content).toBeDefined();
    const first = (result.content as any[])[0];
    expect(first.type).toBe("text");
    return { parsed: JSON.parse(first.text), raw: result };
}

// A minimal valid Edict module for testing
const HELLO_MODULE = {
    kind: "module",
    id: "mod-integ-001",
    name: "integration_test",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn-main-001",
            name: "main",
            params: [],
            returnType: { kind: "basic", name: "Int" },
            effects: ["io"],
            contracts: [],
            body: [
                {
                    kind: "call",
                    id: "call-print-001",
                    fn: { kind: "ident", id: "ident-print-001", name: "print" },
                    args: [
                        { kind: "literal", id: "lit-msg-001", value: "integration test" },
                    ],
                },
                { kind: "literal", id: "lit-ret-001", value: 42 },
            ],
        },
    ],
};

// =============================================================================
// Tools
// =============================================================================

describe("MCP integration — tools", () => {
    // Pre-compiled WASM for HELLO_MODULE — populated by edict_compile test,
    // reused by edict_run tests to avoid redundant compile+run cycles.
    let helloWasm: string;
    // ─── edict_version ───────────────────────────────────────────────────────
    it("edict_version returns capability info", async () => {
        const { parsed } = await callTool("edict_version");
        expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(parsed.schemaVersion).toBeDefined();
        expect(parsed.builtins.length).toBeGreaterThan(0);
        expect(parsed.features).toBeDefined();
        expect(parsed.features.contracts).toBeDefined();
    });

    // ─── edict_schema ────────────────────────────────────────────────────────
    it("edict_schema returns full JSON Schema", async () => {
        const { parsed } = await callTool("edict_schema", { format: "full" });
        expect(parsed.schema).toBeDefined();
        expect(parsed.format).toBe("full");
        expect(parsed.tokenEstimate).toBeGreaterThan(0);
    });

    it("edict_schema returns minimal JSON Schema", async () => {
        const { parsed: full } = await callTool("edict_schema", { format: "full" });
        const { parsed: minimal } = await callTool("edict_schema", { format: "minimal" });
        expect(minimal.format).toBe("minimal");
        // Minimal should be smaller (fewer tokens)
        expect(minimal.tokenEstimate).toBeLessThan(full.tokenEstimate);
    });

    // ─── edict_examples ──────────────────────────────────────────────────────
    it("edict_examples returns example programs", async () => {
        const { parsed } = await callTool("edict_examples");
        expect(parsed.count).toBeGreaterThan(0);
        expect(parsed.examples).toBeInstanceOf(Array);
        expect(parsed.examples.length).toBe(parsed.count);
        // Each example has name and ast
        for (const ex of parsed.examples) {
            expect(ex.name).toBeDefined();
            expect(ex.ast).toBeDefined();
            expect(ex.ast.kind).toBe("module");
        }
    });

    // ─── edict_validate ──────────────────────────────────────────────────────
    it("edict_validate accepts valid AST", async () => {
        const result = await client.callTool({
            name: "edict_validate",
            arguments: { ast: HELLO_MODULE },
        });
        const text = (result.content as any[])[0].text;
        expect(text).toContain("schema-valid");
        expect(result.isError).toBeFalsy();
    });

    it("edict_validate rejects invalid AST", async () => {
        const result = await client.callTool({
            name: "edict_validate",
            arguments: { ast: { kind: "module" } },
        });
        expect(result.isError).toBe(true);
        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.errors).toBeDefined();
        expect(data.errors.length).toBeGreaterThan(0);
    });

    // ─── edict_check ─────────────────────────────────────────────────────────
    it("edict_check passes valid program", async () => {
        const result = await client.callTool({
            name: "edict_check",
            arguments: { ast: HELLO_MODULE },
        });
        const text = (result.content as any[])[0].text;
        expect(text).toContain("passed all semantic checks");
        expect(result.isError).toBeFalsy();
    });

    it("edict_check catches type errors", async () => {
        const badModule = {
            ...HELLO_MODULE,
            id: "mod-bad-001",
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-bad-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["io"],
                    contracts: [],
                    body: [
                        // Return a String when Int is expected
                        { kind: "literal", id: "lit-bad-001", value: "not an int" },
                    ],
                },
            ],
        };

        const result = await client.callTool({
            name: "edict_check",
            arguments: { ast: badModule },
        });
        expect(result.isError).toBe(true);
        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.errors.some((e: any) => e.error === "type_mismatch")).toBe(true);
    });

    // ─── edict_compile ───────────────────────────────────────────────────────
    it("edict_compile produces WASM for valid program", async () => {
        const { parsed } = await callTool("edict_compile", { ast: HELLO_MODULE });
        expect(parsed.wasm).toBeDefined();
        expect(parsed.wasm.length).toBeGreaterThan(0);
        expect(parsed.message).toContain("successful");
        // Cache for reuse by edict_run tests
        helloWasm = parsed.wasm;
    });

    it("edict_compile returns errors for invalid program", async () => {
        const result = await client.callTool({
            name: "edict_compile",
            arguments: { ast: { not: "an ast" } },
        });
        expect(result.isError).toBe(true);
        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.errors).toBeDefined();
    });

    // ─── edict_run ───────────────────────────────────────────────────────────
    it("edict_run executes compiled WASM", async () => {
        // Reuse pre-compiled WASM from edict_compile test
        expect(helloWasm).toBeDefined();

        const { parsed: run } = await callTool("edict_run", { wasmBase64: helloWasm });
        expect(run.exitCode).toBe(0);
        expect(run.output).toContain("integration test");
        expect(run.returnValue).toBe(42);
    });

    it("edict_run rejects invalid WASM", async () => {
        const result = await client.callTool({
            name: "edict_run",
            arguments: { wasmBase64: "bm90IHdhc20=" }, // "not wasm" in base64
        });
        // Invalid WASM should produce an error — either via isError flag,
        // non-zero exit code, or an error/failure string in the response
        const text = (result.content as any[])[0].text;
        const hasError = result.isError === true;
        let hasNonZeroExit = false;
        let hasErrorContent = false;
        try {
            const parsed = JSON.parse(text);
            hasNonZeroExit = parsed.exitCode !== 0;
            hasErrorContent = !!parsed.error;
        } catch {
            // Non-JSON response (raw error string) — also indicates failure
            hasErrorContent = true;
        }
        expect(hasError || hasNonZeroExit || hasErrorContent).toBe(true);
    });

    it("edict_run respects sandbox limits", async () => {
        // Reuse pre-compiled WASM from edict_compile test
        expect(helloWasm).toBeDefined();

        // Run with custom limits
        const { parsed: run } = await callTool("edict_run", {
            wasmBase64: helloWasm,
            limits: { timeoutMs: 15_000 },
        });
        expect(run.exitCode).toBe(0);
    });

    // ─── edict_patch ─────────────────────────────────────────────────────────
    it("edict_patch applies fix and re-checks", async () => {
        // Start with a program that has a type error
        const buggyModule = {
            ...HELLO_MODULE,
            id: "mod-patch-001",
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-patch-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["io"],
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-print-patch-001",
                            fn: { kind: "ident", id: "ident-print-patch-001", name: "print" },
                            args: [
                                { kind: "literal", id: "lit-msg-patch-001", value: "hello" },
                            ],
                        },
                        // Bug: returns string instead of Int
                        { kind: "literal", id: "lit-ret-patch-001", value: "oops" },
                    ],
                },
            ],
        };

        // Patch: replace the return value
        const result = await client.callTool({
            name: "edict_patch",
            arguments: {
                ast: buggyModule,
                patches: [
                    {
                        nodeId: "lit-ret-patch-001",
                        op: "replace",
                        field: "value",
                        value: 0,
                    },
                ],
                returnAst: true,
            },
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.ok).toBe(true);
        expect(data.patchedAst).toBeDefined();
    });

    it("edict_patch returns errors for invalid patches", async () => {
        const result = await client.callTool({
            name: "edict_patch",
            arguments: {
                ast: HELLO_MODULE,
                patches: [
                    {
                        nodeId: "nonexistent-node",
                        op: "replace",
                        field: "value",
                        value: 999,
                    },
                ],
            },
        });

        expect(result.isError).toBe(true);
        const data = JSON.parse((result.content as any[])[0].text);
        expect(data.errors).toBeDefined();
    });

    // ─── edict_errors ────────────────────────────────────────────────────────
    it("edict_errors returns error catalog", async () => {
        const { parsed } = await callTool("edict_errors");
        expect(parsed.errors).toBeDefined();
        expect(parsed.errors.length).toBeGreaterThan(0);
        expect(parsed.count).toBe(parsed.errors.length);
        // Each error type should have structured fields
        for (const errType of parsed.errors) {
            expect(errType.type).toBeDefined();
            expect(errType.pipeline_stage).toBeDefined();
            expect(errType.fields).toBeDefined();
        }
    });
});

// =============================================================================
// Resources
// =============================================================================

describe("MCP integration — resources", () => {
    it("edict://schema returns full JSON Schema", async () => {
        const result = await client.readResource({ uri: "edict://schema" });
        expect(result.contents).toBeDefined();
        expect(result.contents.length).toBe(1);
        expect(result.contents[0].mimeType).toBe("application/json");
        const schema = JSON.parse(result.contents[0].text as string);
        expect(schema).toBeDefined();
        // Should contain definition for EdictModule
        expect(schema.definitions || schema.$defs || schema.properties).toBeDefined();
    });

    it("edict://schema/minimal returns stripped schema", async () => {
        const full = await client.readResource({ uri: "edict://schema" });
        const minimal = await client.readResource({ uri: "edict://schema/minimal" });

        const fullText = full.contents[0].text as string;
        const minimalText = minimal.contents[0].text as string;
        // Minimal should be smaller
        expect(minimalText.length).toBeLessThan(fullText.length);
    });

    it("edict://examples returns example programs", async () => {
        const result = await client.readResource({ uri: "edict://examples" });
        expect(result.contents).toBeDefined();
        const data = JSON.parse(result.contents[0].text as string);
        expect(data.examples).toBeDefined();
        expect(data.examples.length).toBeGreaterThan(0);
    });

    it("edict://errors returns error catalog", async () => {
        const result = await client.readResource({ uri: "edict://errors" });
        expect(result.contents).toBeDefined();
        const data = JSON.parse(result.contents[0].text as string);
        expect(data.errors).toBeDefined();
        expect(data.errors.length).toBeGreaterThan(0);
        expect(data.count).toBe(data.errors.length);
    });
});

// =============================================================================
// Prompts
// =============================================================================

describe("MCP integration — prompts", () => {
    it("write_program prompt returns messages with schema context", async () => {
        const result = await client.getPrompt({
            name: "write_program",
            arguments: { task: "Calculate the factorial of a number" },
        });
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
        // At least one message should contain schema/example context
        const text = result.messages.map((m) => (m.content as any).text || "").join(" ");
        expect(text.length).toBeGreaterThan(100); // substantial context
    });

    it("fix_error prompt returns messages with fix strategy", async () => {
        const result = await client.getPrompt({
            name: "fix_error",
            arguments: {
                error: JSON.stringify({
                    error: "type_mismatch",
                    location: { nodeId: "lit-001" },
                    expected: { kind: "basic", name: "Int" },
                    actual: { kind: "basic", name: "String" },
                }),
            },
        });
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
    });

    it("add_contracts prompt returns messages with contract guidance", async () => {
        const result = await client.getPrompt({
            name: "add_contracts",
            arguments: { ast: JSON.stringify(HELLO_MODULE) },
        });
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
    });

    it("review_ast prompt returns messages with review criteria", async () => {
        const result = await client.getPrompt({
            name: "review_ast",
            arguments: { ast: JSON.stringify(HELLO_MODULE) },
        });
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Tool discovery
// =============================================================================

describe("MCP integration — discovery", () => {
    it("lists all expected tools", async () => {
        const { tools } = await client.listTools();
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("edict_version");
        expect(toolNames).toContain("edict_schema");
        expect(toolNames).toContain("edict_examples");
        expect(toolNames).toContain("edict_validate");
        expect(toolNames).toContain("edict_check");
        expect(toolNames).toContain("edict_compile");
        expect(toolNames).toContain("edict_run");
        expect(toolNames).toContain("edict_patch");
        expect(toolNames).toContain("edict_errors");
    });

    it("lists all expected resources", async () => {
        const { resources } = await client.listResources();
        const uris = resources.map((r) => r.uri);
        expect(uris).toContain("edict://schema");
        expect(uris).toContain("edict://schema/minimal");
        expect(uris).toContain("edict://examples");
        expect(uris).toContain("edict://errors");
    });

    it("lists all expected prompts", async () => {
        const { prompts } = await client.listPrompts();
        const promptNames = prompts.map((p) => p.name);
        expect(promptNames).toContain("write_program");
        expect(promptNames).toContain("fix_error");
        expect(promptNames).toContain("add_contracts");
        expect(promptNames).toContain("review_ast");
    });
});

// =============================================================================
// End-to-end agent loop via MCP protocol
// =============================================================================

describe("MCP integration — full agent loop", () => {
    it("discover → learn → write → fix → compile → run", async () => {
        // Step 1: Agent discovers available tools
        const { tools } = await client.listTools();
        expect(tools.length).toBeGreaterThan(0);

        // Step 2: Agent reads the schema to learn AST format
        const { parsed: schemaResult } = await callTool("edict_schema", { format: "full" });
        expect(schemaResult.schema).toBeDefined();

        // Step 3: Agent reads examples to learn patterns
        const { parsed: examplesResult } = await callTool("edict_examples");
        expect(examplesResult.examples.length).toBeGreaterThan(0);

        // Step 4: Agent writes a buggy program (String return but declares Int)
        const buggyModule = {
            kind: "module",
            id: "mod-e2e-001",
            name: "e2e_agent_loop",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-e2e-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["io"],
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-print-e2e-001",
                            fn: { kind: "ident", id: "ident-print-e2e-001", name: "print" },
                            args: [
                                { kind: "literal", id: "lit-msg-e2e-001", value: "hello from e2e" },
                            ],
                        },
                        // BUG: agent returns String, should be Int
                        { kind: "literal", id: "lit-ret-e2e-001", value: "wrong type" },
                    ],
                },
            ],
        };

        // Step 5: Agent submits for compilation → gets structured error
        const compileResult = await client.callTool({
            name: "edict_compile",
            arguments: { ast: buggyModule },
        });
        expect(compileResult.isError).toBe(true);
        const errors = JSON.parse((compileResult.content as any[])[0].text);
        expect(errors.errors.some((e: any) => e.error === "type_mismatch")).toBe(true);

        // Step 6: Agent uses edict_patch to fix the bug
        const patchResult = await client.callTool({
            name: "edict_patch",
            arguments: {
                ast: buggyModule,
                patches: [
                    { nodeId: "lit-ret-e2e-001", op: "replace", field: "value", value: 0 },
                ],
                returnAst: true,
            },
        });
        expect(patchResult.isError).toBeFalsy();
        const patched = JSON.parse((patchResult.content as any[])[0].text);
        expect(patched.ok).toBe(true);

        // Step 7: Agent compiles the patched program
        const compile2 = await client.callTool({
            name: "edict_compile",
            arguments: { ast: patched.patchedAst },
        });
        expect(compile2.isError).toBeFalsy();
        const compiled = JSON.parse((compile2.content as any[])[0].text);
        expect(compiled.wasm).toBeDefined();

        // Step 8: Agent runs the compiled WASM
        const { parsed: runResult } = await callTool("edict_run", {
            wasmBase64: compiled.wasm,
        });
        expect(runResult.exitCode).toBe(0);
        expect(runResult.output).toContain("hello from e2e");
        expect(runResult.returnValue).toBe(0);
    });
});
