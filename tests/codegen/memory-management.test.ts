import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import { check } from "../../src/check.js";

// =============================================================================
// Helpers
// =============================================================================

async function compileAst(ast: unknown): Promise<Uint8Array> {
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        throw new Error(`Check failed: ${JSON.stringify(checkResult.errors)}`);
    }
    const compileResult = compile(checkResult.module);
    if (!compileResult.ok) {
        throw new Error(`Compile failed: ${JSON.stringify(compileResult.errors)}`);
    }
    return compileResult.wasm;
}

// =============================================================================
// High-level helper — compile + instantiate for low-level WASM access
// =============================================================================

async function compileAndInstantiate(ast: unknown) {
    const wasm = await compileAst(ast);
    const { createHostImports } = await import("../../src/builtins/registry.js");
    const state = { outputParts: [] as string[], instance: null as any };
    const importObject = createHostImports(state);
    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    state.instance = instance;
    return { instance, state };
}

// =============================================================================
// AST fixtures
// =============================================================================

/** Simple program that allocates nothing beyond strings */
const SIMPLE_AST = {
    kind: "module",
    id: "mod-simple",
    name: "simple",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main",
        name: "main",
        params: [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{
            kind: "literal",
            id: "l-ret",
            value: 42,
        }],
    }],
};

/** Program that allocates arrays and records on the heap */
const ALLOCATING_AST = {
    kind: "module",
    id: "mod-alloc",
    name: "alloc",
    imports: [],
    definitions: [{
        kind: "record",
        id: "rec-point",
        name: "Point",
        fields: [
            { kind: "field", id: "field-x-1", name: "x", type: { kind: "basic", name: "Int" } },
            { kind: "field", id: "field-y-1", name: "y", type: { kind: "basic", name: "Int" } },
        ],
    }, {
        kind: "fn",
        id: "fn-main",
        name: "main",
        params: [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{
            kind: "let",
            id: "let-arr",
            name: "arr",
            type: { kind: "array", element: { kind: "basic", name: "Int" } },
            value: {
                kind: "array",
                id: "arr-1",
                elements: [
                    { kind: "literal", id: "l-1", value: 1 },
                    { kind: "literal", id: "l-2", value: 2 },
                    { kind: "literal", id: "l-3", value: 3 },
                ],
            },
        }, {
            kind: "let",
            id: "let-pt",
            name: "pt",
            type: { kind: "named", name: "Point" },
            value: {
                kind: "record_expr",
                id: "rec-expr-1",
                name: "Point",
                fields: [
                    { kind: "field_init", name: "x", value: { kind: "literal", id: "l-x", value: 10 } },
                    { kind: "field_init", name: "y", value: { kind: "literal", id: "l-y", value: 20 } },
                ],
            },
        }, {
            kind: "access",
            id: "acc-x",
            target: { kind: "ident", id: "i-pt", name: "pt" },
            field: "x",
        }],
    }],
};

// =============================================================================
// Tests
// =============================================================================

describe("Memory Management", () => {
    describe("Heap exports", () => {
        it("exports __heap_reset function", async () => {
            const { instance } = await compileAndInstantiate(SIMPLE_AST);
            expect(typeof instance.exports.__heap_reset).toBe("function");
        });

        it("exports __get_heap_start function", async () => {
            const { instance } = await compileAndInstantiate(SIMPLE_AST);
            expect(typeof instance.exports.__get_heap_start).toBe("function");
        });

        it("__heap_start equals initial __heap_ptr", async () => {
            const { instance } = await compileAndInstantiate(SIMPLE_AST);
            const getHeapStart = instance.exports.__get_heap_start as () => number;
            const getHeapPtr = instance.exports.__get_heap_ptr as () => number;
            // Before any execution, heap_ptr should equal heap_start
            expect(getHeapPtr()).toBe(getHeapStart());
        });
    });

    describe("Arena reset", () => {
        it("__heap_reset restores pointer to __heap_start after allocations", async () => {
            const { instance, state } = await compileAndInstantiate(ALLOCATING_AST);
            const getHeapStart = instance.exports.__get_heap_start as () => number;
            const getHeapPtr = instance.exports.__get_heap_ptr as () => number;
            const heapReset = instance.exports.__heap_reset as () => void;
            const mainFn = instance.exports.main as () => number;

            const startBefore = getHeapStart();
            
            // Run main which allocates an array and a record
            mainFn();
            const ptrAfterRun = getHeapPtr();
            
            // Heap pointer should have advanced
            expect(ptrAfterRun).toBeGreaterThan(startBefore);
            
            // Reset the heap
            heapReset();
            
            // Heap pointer should be back to start
            expect(getHeapPtr()).toBe(startBefore);
        });
    });

    describe("Watermark save/restore", () => {
        it("save and restore __heap_ptr via existing exports", async () => {
            const { instance } = await compileAndInstantiate(ALLOCATING_AST);
            const getHeapPtr = instance.exports.__get_heap_ptr as () => number;
            const setHeapPtr = instance.exports.__set_heap_ptr as (v: number) => void;
            const mainFn = instance.exports.main as () => number;

            // Save watermark before execution
            const saved = getHeapPtr();

            // Run allocating program
            mainFn();
            expect(getHeapPtr()).toBeGreaterThan(saved);

            // Restore watermark — reclaims all allocations from main()
            setHeapPtr(saved);
            expect(getHeapPtr()).toBe(saved);
        });
    });

    describe("heapUsed in RunResult", () => {
        it("reports heapUsed > 0 for allocating programs", async () => {
            const wasm = await compileAst(ALLOCATING_AST);
            const result = await runDirect(wasm, "main");

            expect(result.exitCode).toBe(0);
            expect(result.heapUsed).toBeDefined();
            expect(result.heapUsed).toBeGreaterThan(0);
        });

        it("reports no heapUsed for non-allocating programs", async () => {
            const wasm = await compileAst(SIMPLE_AST);
            const result = await runDirect(wasm, "main");

            expect(result.exitCode).toBe(0);
            // Simple program doesn't allocate, so heapUsed should be absent or 0
            expect(result.heapUsed ?? 0).toBe(0);
        });
    });

    describe("host-helpers", () => {
        it("resetHeap resets via host helper", async () => {
            const { getHeapUsage, resetHeap } = await import("../../src/builtins/host-helpers.js");
            const { instance, state } = await compileAndInstantiate(ALLOCATING_AST);
            const mainFn = instance.exports.main as () => number;

            // Run allocating program
            mainFn();
            const usageAfter = getHeapUsage(state);
            expect(usageAfter.used).toBeGreaterThan(0);

            // Reset via host helper
            resetHeap(state);
            const usageReset = getHeapUsage(state);
            expect(usageReset.used).toBe(0);
        });

        it("withTemporaryHeap releases allocations", async () => {
            const { withTemporaryHeap, getHeapUsage } = await import("../../src/builtins/host-helpers.js");
            const { instance, state } = await compileAndInstantiate(ALLOCATING_AST);
            const mainFn = instance.exports.main as () => number;

            const usageBefore = getHeapUsage(state);

            // Run in temporary heap — allocations should be released
            withTemporaryHeap(state, () => {
                mainFn();
            });

            const usageAfterTemp = getHeapUsage(state);
            expect(usageAfterTemp.used).toBe(usageBefore.used);
        });
    });
});
