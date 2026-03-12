// =============================================================================
// Worker Scaffold Generator Tests — verify bundle structure and content
// =============================================================================

import { describe, it, expect } from "vitest";
import { generateWorkerScaffold, getHostBuiltinNames } from "../../src/deploy/scaffold.js";
import type { WorkerConfig } from "../../src/deploy/scaffold.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Minimal valid WASM binary (8-byte magic + version header)
const MINIMAL_WASM = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic: \0asm
    0x01, 0x00, 0x00, 0x00, // version: 1
]);

const BASE_CONFIG: WorkerConfig = { name: "test-worker" };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getFile(result: ReturnType<typeof generateWorkerScaffold>, path: string) {
    if (!result.ok) throw new Error(`Scaffold failed: ${result.error}`);
    return result.bundle.files.find(f => f.path === path);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateWorkerScaffold: bundle structure", () => {
    it("produces exactly 3 files: worker.js, wrangler.toml, program.wasm", () => {
        const result = generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const paths = result.bundle.files.map(f => f.path).sort();
        expect(paths).toEqual(["program.wasm", "worker.js", "wrangler.toml"]);
    });
});

describe("generateWorkerScaffold: worker.js", () => {
    it("contains ES Module Worker export default with fetch handler", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "worker.js");
        expect(file).toBeDefined();
        const content = file!.content as string;
        expect(content).toContain("export default");
        expect(content).toContain("async fetch");
    });

    it("contains WebAssembly.instantiate call", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "worker.js");
        const content = file!.content as string;
        expect(content).toContain("WebAssembly.instantiate");
    });

    it("includes all host-kind builtin names in hostFunctions object", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "worker.js");
        const content = file!.content as string;

        const hostNames = getHostBuiltinNames();
        expect(hostNames.length).toBeGreaterThan(50); // sanity check — there are ~70 host builtins

        for (const name of hostNames) {
            // Each host builtin should appear as a property in the hostFunctions object
            expect(content).toContain(name);
        }
    });

    it("includes string helper functions (readString, writeString, allocateHeap)", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "worker.js");
        const content = file!.content as string;
        expect(content).toContain("readString");
        expect(content).toContain("writeString");
        expect(content).toContain("allocateHeap");
    });

    it("imports WASM module from ./program.wasm", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "worker.js");
        const content = file!.content as string;
        expect(content).toContain("from './program.wasm'");
    });
});

describe("generateWorkerScaffold: wrangler.toml", () => {
    it("contains name, main, and compatibility_date", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "wrangler.toml");
        expect(file).toBeDefined();
        const content = file!.content as string;
        expect(content).toContain('name = "test-worker"');
        expect(content).toContain('main = "worker.js"');
        expect(content).toContain('compatibility_date = "2024-01-01"');
    });

    it("uses custom compatibility date when provided", () => {
        const config: WorkerConfig = { name: "custom-worker", compatibilityDate: "2025-06-15" };
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, config), "wrangler.toml");
        const content = file!.content as string;
        expect(content).toContain('compatibility_date = "2025-06-15"');
    });

    it("includes KV namespace bindings when configured", () => {
        const config: WorkerConfig = {
            name: "kv-worker",
            kvNamespaces: [
                { binding: "MY_KV", id: "abc123" },
                { binding: "CACHE", id: "def456" },
            ],
        };
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, config), "wrangler.toml");
        const content = file!.content as string;
        expect(content).toContain("[[kv_namespaces]]");
        expect(content).toContain('binding = "MY_KV"');
        expect(content).toContain('id = "abc123"');
        expect(content).toContain('binding = "CACHE"');
        expect(content).toContain('id = "def456"');
    });

    it("omits KV section when no namespaces configured", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "wrangler.toml");
        const content = file!.content as string;
        expect(content).not.toContain("kv_namespaces");
    });
});

describe("generateWorkerScaffold: program.wasm", () => {
    it("preserves the input WASM binary exactly", () => {
        const file = getFile(generateWorkerScaffold(MINIMAL_WASM, BASE_CONFIG), "program.wasm");
        expect(file).toBeDefined();
        expect(file!.content).toBeInstanceOf(Uint8Array);
        expect(file!.content).toEqual(MINIMAL_WASM);
    });

    it("works with larger WASM binaries", () => {
        const largeWasm = new Uint8Array(10000);
        largeWasm.set(MINIMAL_WASM); // valid header
        largeWasm.fill(0xFF, 8); // remainder
        const file = getFile(generateWorkerScaffold(largeWasm, BASE_CONFIG), "program.wasm");
        expect(file!.content).toEqual(largeWasm);
    });
});

describe("generateWorkerScaffold: input validation", () => {
    it("returns error for empty WASM", () => {
        const result = generateWorkerScaffold(new Uint8Array(0), BASE_CONFIG);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe("wasm_empty");
        }
    });

    it("returns error for empty name", () => {
        const result = generateWorkerScaffold(MINIMAL_WASM, { name: "" });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe("name_empty");
        }
    });

    it("returns error for whitespace-only name", () => {
        const result = generateWorkerScaffold(MINIMAL_WASM, { name: "   " });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe("name_empty");
        }
    });
});

describe("generateWorkerScaffold: round-trip with compiler", () => {
    it("scaffolds a compiled Edict program", async () => {
        // Import the full pipeline
        const { check, compile } = await import("../../src/index.js");

        // Minimal Edict program: main returns 42
        const ast = {
            kind: "module",
            id: "mod-test",
            name: "test",
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

        const checkResult = await check(ast);
        expect(checkResult.ok).toBe(true);
        if (!checkResult.ok) return;

        const compileResult = compile(checkResult.module!, { typeInfo: checkResult.typeInfo });
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const scaffoldResult = generateWorkerScaffold(compileResult.wasm, { name: "edict-test" });
        expect(scaffoldResult.ok).toBe(true);
        if (!scaffoldResult.ok) return;

        // Verify bundle integrity
        expect(scaffoldResult.bundle.files).toHaveLength(3);

        const workerJs = scaffoldResult.bundle.files.find(f => f.path === "worker.js");
        expect(workerJs).toBeDefined();
        expect(typeof workerJs!.content).toBe("string");

        const wasmFile = scaffoldResult.bundle.files.find(f => f.path === "program.wasm");
        expect(wasmFile).toBeDefined();
        expect(wasmFile!.content).toEqual(compileResult.wasm);

        const toml = scaffoldResult.bundle.files.find(f => f.path === "wrangler.toml");
        expect(toml).toBeDefined();
        expect(toml!.content as string).toContain('name = "edict-test"');
    });
});
