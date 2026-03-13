// =============================================================================
// Deploy Handler Tests — edict_deploy MCP tool handler
// =============================================================================

import { describe, it, expect } from "vitest";
import { handleDeploy } from "../../src/mcp/handlers.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid AST: main returns 42 */
const VALID_AST = {
    kind: "module",
    id: "mod-deploy-test",
    name: "deploy-test",
    schemaVersion: "1.1",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn-main",
            name: "main",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "literal", id: "lit-42", value: 42, type: { kind: "basic", name: "Int" } }],
        },
    ],
};

/** AST with contracts for verified metadata */
const AST_WITH_CONTRACTS = {
    kind: "module",
    id: "mod-contract-test",
    name: "contract-test",
    schemaVersion: "1.1",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn-positive",
            name: "main",
            params: [
                { kind: "param", id: "param-x", name: "x", type: { kind: "basic", name: "Int" } },
            ],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [
                {
                    kind: "pre",
                    id: "pre-1",
                    condition: {
                        kind: "binop",
                        id: "binop-pre",
                        op: ">",
                        left: { kind: "ident", id: "id-x-pre", name: "x" },
                        right: { kind: "literal", id: "lit-0-pre", value: 0, type: { kind: "basic", name: "Int" } },
                    },
                },
            ],
            body: [{ kind: "ident", id: "id-x-body", name: "x" }],
        },
    ],
};

/** Invalid AST — triggers pipeline errors */
const INVALID_AST = {
    kind: "module",
    id: "mod-bad",
    name: "bad",
    schemaVersion: "1.1",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn-main",
            name: "main",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "ident", id: "id-nonexistent", name: "undefined_var" }],
        },
    ],
};

// ---------------------------------------------------------------------------
// wasm_binary target
// ---------------------------------------------------------------------------

describe("handleDeploy: wasm_binary target", () => {
    it("returns ok with WASM base64 and metadata", async () => {
        const result = await handleDeploy(VALID_AST, "wasm_binary");
        expect(result.ok).toBe(true);
        expect(result.target).toBe("wasm_binary");
        expect(result.wasm).toBeDefined();
        expect(typeof result.wasm).toBe("string");
        expect(result.wasmSize).toBeGreaterThan(0);
        expect(result.status).toBe("ready");
        expect(result.effects).toBeDefined();
        expect(Array.isArray(result.effects)).toBe(true);
        expect(result.contracts).toBe(0);
    });

    it("includes verified field based on contract coverage", async () => {
        const result = await handleDeploy(AST_WITH_CONTRACTS, "wasm_binary");
        expect(result.ok).toBe(true);
        expect(result.verified).toBeDefined();
        expect(typeof result.verified).toBe("boolean");
        expect(result.contracts).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// cloudflare target
// ---------------------------------------------------------------------------

describe("handleDeploy: cloudflare target", () => {
    it("generates Worker bundle with 3 files", async () => {
        const result = await handleDeploy(VALID_AST, "cloudflare", { name: "my-worker" });
        expect(result.ok).toBe(true);
        expect(result.target).toBe("cloudflare");
        expect(result.bundle).toBeDefined();
        expect(result.bundle).toHaveLength(3);

        const paths = result.bundle!.map(f => f.path).sort();
        expect(paths).toEqual(["program.wasm", "worker.js", "wrangler.toml"]);
    });

    it("includes worker name in wrangler.toml and URL", async () => {
        const result = await handleDeploy(VALID_AST, "cloudflare", { name: "test-api" });
        expect(result.ok).toBe(true);

        const toml = result.bundle!.find(f => f.path === "wrangler.toml");
        expect(toml).toBeDefined();
        expect(toml!.content).toContain('name = "test-api"');
        expect(result.url).toContain("test-api");
    });

    it("includes route in URL when provided", async () => {
        const result = await handleDeploy(VALID_AST, "cloudflare", { name: "api", route: "/v1/process" });
        expect(result.ok).toBe(true);
        expect(result.url).toBe("https://api.workers.dev/v1/process");
    });

    it("returns status 'bundled'", async () => {
        const result = await handleDeploy(VALID_AST, "cloudflare", { name: "w" });
        expect(result.ok).toBe(true);
        expect(result.status).toBe("bundled");
    });

    it("falls back to module name when config.name is absent", async () => {
        const result = await handleDeploy(VALID_AST, "cloudflare");
        expect(result.ok).toBe(true);
        expect(result.url).toContain("deploy-test"); // module name from VALID_AST
    });

    it("includes WASM size, effects, and contracts metadata", async () => {
        const result = await handleDeploy(VALID_AST, "cloudflare", { name: "w" });
        expect(result.ok).toBe(true);
        expect(result.wasmSize).toBeGreaterThan(0);
        expect(result.effects).toBeDefined();
        expect(result.contracts).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("handleDeploy: error paths", () => {
    it("returns error for unknown deploy target", async () => {
        const result = await handleDeploy(VALID_AST, "lambda");
        expect(result.ok).toBe(false);
        expect(result.target).toBe("lambda");
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
        expect((result.errors![0] as any).error).toBe("unknown_deploy_target");
        expect((result.errors![0] as any).validTargets).toEqual(["wasm_binary", "cloudflare"]);
    });

    it("propagates pipeline errors for invalid AST", async () => {
        const result = await handleDeploy(INVALID_AST, "wasm_binary");
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("propagates pipeline errors for cloudflare target too", async () => {
        const result = await handleDeploy(INVALID_AST, "cloudflare");
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
    });
});
