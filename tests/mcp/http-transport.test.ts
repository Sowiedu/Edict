import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import crypto from "node:crypto";
import { Server } from "node:http";
import { createEdictServer } from "../../src/mcp/create-server.js";

describe("HTTP/SSE Transport", () => {
    let app: express.Express;
    let expressServer: Server;
    let port = 0;
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    beforeAll(async () => {
        app = createMcpExpressApp();
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

        return new Promise<void>((resolve) => {
            expressServer = app.listen(0, () => {
                port = (expressServer.address() as any).port;
                resolve();
            });
        });
    });

    afterAll(() => {
        if (expressServer) {
            expressServer.close();
        }
    });

    it("accepts connections and returns initialization info", async () => {
        const url = new URL(`http://localhost:${port}/mcp`);
        const clientTransport = new StreamableHTTPClientTransport(url);
        const client = new Client(
            { name: "test-client", version: "1.0.0" },
            { capabilities: {} }
        );

        await client.connect(clientTransport);

        // Verify that the server responds with the edict_version tool
        const toolsResult = await client.listTools();
        expect(toolsResult.tools.some((t) => t.name === "edict_version")).toBe(true);
        expect(toolsResult.tools.some((t) => t.name === "edict_compile")).toBe(true);

        const versionResult = await client.callTool({
            name: "edict_version",
            arguments: {}
        });

        expect(versionResult.content).toBeDefined();
        if (versionResult.content[0].type === "text") {
            const data = JSON.parse(versionResult.content[0].text);
            expect(data.version).toMatch(/^\d+\.\d+\.\d+/);
            expect(data.features).toBeDefined();
        }

        await client.close();
    });
});
