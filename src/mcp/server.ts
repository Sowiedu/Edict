#!/usr/bin/env node
// =============================================================================
// Edict MCP Server — Agent interface to the Edict compiler pipeline
// =============================================================================
// Usage: tsx src/mcp/server.ts   (or: npm run mcp)
// Transport: stdio (standard for local MCP servers)

import { createEdictServer } from "./create-server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import express from "express";
import crypto from "node:crypto";



// =============================================================================
// Start
// =============================================================================

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // -------------------------------------------------------------------------
    // Argument validation — fail fast on unrecognized CLI arguments (#149)
    // -------------------------------------------------------------------------
    // edict-lang is an MCP server, not a CLI tool. Agents and users sometimes
    // run `npx edict-lang check file.json` expecting CLI behavior. Without this
    // guard, the server starts in stdio mode and hangs waiting for MCP JSON-RPC
    // messages — the CLI arguments are silently ignored.
    const KNOWN_FLAGS = new Set(["--http", "--port"]);
    const unknownArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (KNOWN_FLAGS.has(arg)) {
            if (arg === "--port") i++; // skip the port value
        } else {
            unknownArgs.push(arg);
        }
    }
    if (unknownArgs.length > 0) {
        const error = {
            error: "unknown_cli_argument",
            arguments: unknownArgs,
            hint: "edict-lang is an MCP server, not a CLI tool. Start without arguments for stdio transport, or with --http for HTTP transport. Use MCP tools (edict_check, edict_validate, edict_compile, edict_run) to interact with the compiler.",
        };
        process.stderr.write(JSON.stringify(error, null, 2) + "\n");
        process.exit(1);
    }

    const useHttp = args.includes("--http") || process.env.EDICT_TRANSPORT === "http";

    // Default to port 3000 unless specified or provided in EDICT_PORT
    let port = 3000;
    if (process.env.EDICT_PORT) port = parseInt(process.env.EDICT_PORT, 10);
    const portArgIndex = args.indexOf("--port");
    if (portArgIndex !== -1 && portArgIndex + 1 < args.length) {
        port = parseInt(args[portArgIndex + 1]!, 10);
    }

    if (useHttp) {
        const app = createMcpExpressApp();

        // Active transports keyed by session ID
        const transports: Record<string, StreamableHTTPServerTransport> = {};

        // Need body parser for Express to handle JSON
        app.use(express.json({ limit: "50mb" }));

        app.post("/mcp", async (req: express.Request, res: express.Response) => {

            try {
                let transport: StreamableHTTPServerTransport;
                const sessionId = req.headers["mcp-session-id"] as string | undefined;

                if (sessionId && transports[sessionId]) {
                    // Reusing existing transport
                    transport = transports[sessionId];
                } else if (req.body && req.body.method === "initialize") {
                    // New session needed
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => crypto.randomUUID(),
                        onsessioninitialized: (sid) => {
                            transports[sid] = transport;
                        }
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
                        id: null
                    });
                    return;
                }

                await transport.handleRequest(req, res, req.body);
            } catch (err) {
                console.error("Error handling POST /mcp:", err);
                if (!res.headersSent) res.status(500).end();
            }
        });

        // GET /mcp - handles SSE streaming for responses
        app.get("/mcp", async (req: express.Request, res: express.Response) => {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;
            if (!sessionId || !transports[sessionId]) {
                res.status(400).send("Invalid or missing session ID");
                return;
            }

            try {
                await transports[sessionId].handleRequest(req, res);
            } catch (err) {
                console.error("Error handling GET /mcp:", err);
                if (!res.headersSent) res.status(500).end();
            }
        });

        // DELETE /mcp - handles closing a session
        app.delete("/mcp", async (req: express.Request, res: express.Response) => {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;
            if (!sessionId || !transports[sessionId]) {
                res.status(400).send("Invalid or missing session ID");
                return;
            }

            try {
                await transports[sessionId].handleRequest(req, res);
            } catch (err) {
                console.error("Error handling DELETE /mcp:", err);
                if (!res.headersSent) res.status(500).end();
            }
        });

        const serverInstance = app.listen(port);

        // Graceful shutdown
        process.on("SIGINT", () => {
            serverInstance.close(() => process.exit(0));
        });
        process.on("SIGTERM", () => {
            serverInstance.close(() => process.exit(0));
        });
    } else {
        // Stdio Transport
        const server = createEdictServer();
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}

main().catch((e) => {
    console.error("Edict MCP server failed to start:", e);
    process.exit(1);
});
