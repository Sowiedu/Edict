// =============================================================================
// edict_invoke MCP Tool Tests
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { handleInvoke, handleVersion } from "../../src/mcp/handlers.js";

// =============================================================================
// Local HTTP server for mocking
// =============================================================================

let server: Server;
let baseUrl: string;

beforeAll(() => {
    return new Promise<void>((resolve) => {
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const url = req.url ?? "/";

            if (url === "/echo") {
                let body = "";
                req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                req.on("end", () => {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ method: req.method, body, headers: req.headers }));
                });
                return;
            }

            if (url === "/error500") {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal Server Error");
                return;
            }

            if (url === "/slow") {
                // Delay longer than the test timeout
                setTimeout(() => {
                    res.writeHead(200);
                    res.end("eventually");
                }, 5000);
                return;
            }

            if (url === "/simple") {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("hello from edict");
                return;
            }

            res.writeHead(404);
            res.end("Not Found");
        });

        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr === "object") {
                baseUrl = `http://127.0.0.1:${addr.port}`;
            }
            resolve();
        });
    });
});

afterAll(() => {
    return new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
});

// =============================================================================
// handleInvoke — success paths
// =============================================================================

describe("handleInvoke — success", () => {
    it("POST with input → ok: true, correct output, status 200, durationMs > 0", async () => {
        const result = await handleInvoke(`${baseUrl}/echo`, '{"key":"value"}');
        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.output).toBeDefined();

        const parsed = JSON.parse(result.output!);
        expect(parsed.method).toBe("POST");
        expect(parsed.body).toBe('{"key":"value"}');
    });

    it("GET with no body → ok: true", async () => {
        const result = await handleInvoke(`${baseUrl}/simple`, undefined, { method: "GET" });
        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(result.output).toBe("hello from edict");
    });

    it("custom headers are forwarded to the server", async () => {
        const result = await handleInvoke(`${baseUrl}/echo`, "test", {
            headers: { "X-Custom-Header": "edict-test" },
        });
        expect(result.ok).toBe(true);
        const parsed = JSON.parse(result.output!);
        expect(parsed.headers["x-custom-header"]).toBe("edict-test");
    });
});

// =============================================================================
// handleInvoke — error paths
// =============================================================================

describe("handleInvoke — errors", () => {
    it("non-2xx status → ok: false, errorCode: http_error", async () => {
        const result = await handleInvoke(`${baseUrl}/error500`);
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe("http_error");
        expect(result.status).toBe(500);
        expect(result.output).toBe("Internal Server Error");
        expect(result.durationMs).toBeGreaterThan(0);
    });

    it("timeout → ok: false, errorCode: timeout", async () => {
        const result = await handleInvoke(`${baseUrl}/slow`, undefined, { timeoutMs: 200 });
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe("timeout");
        expect(result.durationMs).toBeGreaterThanOrEqual(100);
    });

    it("unreachable host → ok: false, errorCode: unreachable", async () => {
        const result = await handleInvoke("http://192.0.2.1:1/unreachable", undefined, { timeoutMs: 2000 });
        expect(result.ok).toBe(false);
        // Could be timeout or unreachable depending on OS behavior with RFC 5737 TEST-NET address
        expect(["unreachable", "timeout"]).toContain(result.errorCode);
    });
});

// =============================================================================
// Tool registration and feature flag
// =============================================================================

describe("edict_invoke registration", () => {
    it("edict_invoke is in ALL_TOOLS", async () => {
        const { ALL_TOOLS } = await import("../../src/mcp/tools/index.js");
        expect(ALL_TOOLS.some((t: { name: string }) => t.name === "edict_invoke")).toBe(true);
    });

    it("handleVersion includes invoke feature flag", () => {
        const version = handleVersion();
        expect(version.features.invoke).toBe(true);
    });
});

// =============================================================================
// invokeTool.handler wrapper — MCP tool layer
// =============================================================================

describe("invokeTool.handler wrapper", () => {
    it("success → content is valid JSON, isError is false", async () => {
        const { invokeTool } = await import("../../src/mcp/tools/invoke.js");
        const result = await invokeTool.handler({ url: `${baseUrl}/simple`, method: "GET" });
        expect(result.isError).toBe(false);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.ok).toBe(true);
        expect(parsed.output).toBe("hello from edict");
    });

    it("error → content is valid JSON, isError is true", async () => {
        const { invokeTool } = await import("../../src/mcp/tools/invoke.js");
        const result = await invokeTool.handler({ url: `${baseUrl}/error500` });
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.ok).toBe(false);
        expect(parsed.errorCode).toBe("http_error");
    });
});
