// =============================================================================
// HTTP Client Builtins — E2E Tests
// =============================================================================
// Compile+run Edict programs using httpGet, httpPost, httpPut, httpDelete
// builtins against a local mock HTTP server.
// Uses compile()+runDirect() pattern (like json-builtins) — skips type checker
// since Result builtins (isOk/unwrapOk) are typed for Result<Int,Int> while
// HTTP returns Result<String,String>. The runtime layout is identical.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { compile } from "../../src/codegen/codegen.js";
import { run } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression } from "../../src/ast/nodes.js";

// =============================================================================
// Mock HTTP server
// =============================================================================

let server: Server;
let baseUrl: string;

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");

        if (req.method === "GET" && url === "/hello") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Hello World");
        } else if (req.method === "GET" && url === "/json") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"key":"value"}');
        } else if (req.method === "GET" && url === "/notfound") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found");
        } else if (req.method === "POST" && url === "/echo") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(body);
        } else if (req.method === "PUT" && url === "/update") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("updated");
        } else if (req.method === "DELETE" && url === "/remove") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("deleted");
        } else {
            res.writeHead(404);
            res.end("unknown route");
        }
    });
}

beforeAll(async () => {
    server = createServer(handleRequest);
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
    }
});

afterAll(async () => {
    await new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
});

// =============================================================================
// AST helpers (same pattern as json-builtins.test.ts)
// =============================================================================

function mkLiteral(value: number | string | boolean, id = "l-1"): Expression {
    return { kind: "literal", id, value };
}

function mkCall(fn: string, args: Expression[], id = "c-1"): Expression {
    return {
        kind: "call", id,
        fn: { kind: "ident", id: `i-${fn}`, name: fn },
        args,
    };
}

function mkFn(
    name: string,
    body: Expression[],
    overrides: Partial<FunctionDef> = {},
): FunctionDef {
    return {
        kind: "fn",
        id: `fn-${name}`,
        name,
        params: [],
        effects: ["io"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body,
        ...overrides,
    };
}

function mkModule(defs: EdictModule["definitions"]): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports: [],
        definitions: defs,
    };
}

async function compileAndRun(mod: EdictModule) {
    const compiled = compile(mod);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(`compile failed: ${compiled.errors.join(", ")}`);
    // Must use run() (worker thread) not runDirect() — syncFetch uses execFileSync
    // which blocks the event loop. runDirect runs in-process, so the mock HTTP server
    // on the same event loop would deadlock. run() spawns a worker thread.
    return run(compiled.wasm, "main", { timeoutMs: 30_000 });
}

// =============================================================================
// httpGet
// =============================================================================

describe("httpGet builtin", () => {
    it("200 response → isOk returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpGet", [mkLiteral(`${baseUrl}/hello`, "l-url")]),
                },
                mkCall("isOk", [{ kind: "ident", id: "i-res", name: "res" }], "c-isOk"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("200 response → unwrapOk returns body", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpGet", [mkLiteral(`${baseUrl}/hello`, "l-url")]),
                },
                {
                    kind: "let", id: "let-body", name: "body",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("unwrapOk", [{ kind: "ident", id: "i-res", name: "res" }], "c-unwrap"),
                },
                mkCall("print", [{ kind: "ident", id: "i-body", name: "body" }], "c-print"),
                mkLiteral(0, "l-ret"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.output).toBe("Hello World");
    });

    it("404 response → isErr returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpGet", [mkLiteral(`${baseUrl}/notfound`, "l-url")]),
                },
                mkCall("isErr", [{ kind: "ident", id: "i-res", name: "res" }], "c-isErr"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("invalid URL → isErr returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpGet", [mkLiteral("http://127.0.0.1:1/nonexistent", "l-url")]),
                },
                mkCall("isErr", [{ kind: "ident", id: "i-res", name: "res" }], "c-isErr"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });
});

// =============================================================================
// httpPost
// =============================================================================

describe("httpPost builtin", () => {
    it("echoes JSON body → unwrapOk returns echoed body", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpPost", [
                        mkLiteral(`${baseUrl}/echo`, "l-url"),
                        mkLiteral('{"msg":"hello"}', "l-body"),
                    ]),
                },
                {
                    kind: "let", id: "let-body", name: "body",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("unwrapOk", [{ kind: "ident", id: "i-res", name: "res" }], "c-unwrap"),
                },
                mkCall("print", [{ kind: "ident", id: "i-body", name: "body" }], "c-print"),
                mkLiteral(0, "l-ret"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.output).toBe('{"msg":"hello"}');
    });

    it("invalid URL → isErr returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpPost", [
                        mkLiteral("http://127.0.0.1:1/nope", "l-url"),
                        mkLiteral("{}", "l-body"),
                    ]),
                },
                mkCall("isErr", [{ kind: "ident", id: "i-res", name: "res" }], "c-isErr"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("empty body → isOk returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpPost", [
                        mkLiteral(`${baseUrl}/echo`, "l-url"),
                        mkLiteral("", "l-body"),
                    ]),
                },
                mkCall("isOk", [{ kind: "ident", id: "i-res", name: "res" }], "c-isOk"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });
});

// =============================================================================
// httpPut
// =============================================================================

describe("httpPut builtin", () => {
    it("returns Ok with response body", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpPut", [
                        mkLiteral(`${baseUrl}/update`, "l-url"),
                        mkLiteral('{"data":"test"}', "l-body"),
                    ]),
                },
                {
                    kind: "let", id: "let-body", name: "body",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("unwrapOk", [{ kind: "ident", id: "i-res", name: "res" }], "c-unwrap"),
                },
                mkCall("print", [{ kind: "ident", id: "i-body", name: "body" }], "c-print"),
                mkLiteral(0, "l-ret"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.output).toBe("updated");
    });
});

// =============================================================================
// httpDelete
// =============================================================================

describe("httpDelete builtin", () => {
    it("returns Ok with response body", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpDelete", [mkLiteral(`${baseUrl}/remove`, "l-url")]),
                },
                {
                    kind: "let", id: "let-body", name: "body",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("unwrapOk", [{ kind: "ident", id: "i-res", name: "res" }], "c-unwrap"),
                },
                mkCall("print", [{ kind: "ident", id: "i-body", name: "body" }], "c-print"),
                mkLiteral(0, "l-ret"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.output).toBe("deleted");
    });
});

// =============================================================================
// Composition — HTTP result piped to jsonParse
// =============================================================================

describe("http builtin composition", () => {
    it("httpGet + jsonParse pipeline", async () => {
        const mod = mkModule([
            mkFn("main", [
                // let response = unwrapOk(httpGet(url))
                {
                    kind: "let", id: "let-resp", name: "response",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("unwrapOk", [
                        mkCall("httpGet", [mkLiteral(`${baseUrl}/json`, "l-url")], "c-get"),
                    ], "c-unwrap"),
                },
                // let parsed = jsonParse(response)
                {
                    kind: "let", id: "let-parsed", name: "parsed",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("jsonParse", [
                        { kind: "ident", id: "i-resp", name: "response" },
                    ], "c-parse"),
                },
                // isOk(parsed) → should be 1 since JSON endpoint returns valid JSON
                mkCall("isOk", [{ kind: "ident", id: "i-parsed", name: "parsed" }], "c-isOk"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("httpGet + match arms for Ok/Err", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-res", name: "res",
                    type: { kind: "named", name: "Result" },
                    value: mkCall("httpGet", [mkLiteral(`${baseUrl}/hello`, "l-url")]),
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-res", name: "res" },
                    arms: [
                        {
                            id: "arm-ok",
                            pattern: { kind: "constructor", name: "Ok", fields: [{ kind: "binding", name: "val" }] },
                            body: [
                                {
                                    kind: "let", id: "let-p", name: "_p",
                                    type: { kind: "basic", name: "String" },
                                    value: mkCall("print", [{ kind: "ident", id: "i-val", name: "val" }], "c-print"),
                                },
                                mkLiteral(1, "l-1"),
                            ],
                        },
                        {
                            id: "arm-err",
                            pattern: { kind: "constructor", name: "Err", fields: [{ kind: "binding", name: "e" }] },
                            body: [mkLiteral(0, "l-0")],
                        },
                    ],
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
        expect(result.output).toBe("Hello World");
    });
});
