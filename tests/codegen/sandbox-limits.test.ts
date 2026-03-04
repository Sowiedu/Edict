import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { run, runDirect } from "../../src/codegen/runner.js";
import { check } from "../../src/check.js";

// =============================================================================
// Helpers — compile Edict AST to WASM bytes
// =============================================================================

async function compileAst(ast: unknown): Promise<Uint8Array> {
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        throw new Error(`Check failed: ${JSON.stringify(checkResult.errors)}`);
    }
    const compileResult = compile(checkResult.module);
    if (!compileResult.ok) {
        throw new Error(`Compile failed: ${compileResult.errors.join(", ")}`);
    }
    return compileResult.wasm;
}

// =============================================================================
// AST fixtures
// =============================================================================

/** Simple hello world program — finishes quickly */
const HELLO_WORLD_AST = {
    kind: "module",
    id: "mod-hello",
    name: "hello",
    imports: [],
    definitions: [{
        kind: "fn",
        id: "fn-main",
        name: "main",
        params: [],
        effects: ["io"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{
            kind: "call",
            id: "c-1",
            fn: { kind: "ident", id: "i-print", name: "print" },
            args: [{ kind: "literal", id: "l-1", value: "Hello, World!" }],
        }, {
            kind: "literal",
            id: "l-ret",
            value: 0,
        }],
    }],
};

/**
 * Exponential-time fibonacci — fib(40) takes several seconds without memoization.
 * Used to test timeout: the computation runs long enough to exceed short timeouts
 * without causing stack overflow (unlike infinite recursion).
 */
const SLOW_PROGRAM_AST = {
    kind: "module",
    id: "mod-slow",
    name: "slow",
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
            kind: "call",
            id: "c-fib",
            fn: { kind: "ident", id: "i-fib", name: "fib" },
            args: [{ kind: "literal", id: "l-40", value: 40 }],
        }],
    }, {
        kind: "fn",
        id: "fn-fib",
        name: "fib",
        params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body: [{
            kind: "if",
            id: "if-base",
            condition: {
                kind: "binop", id: "b-le", op: "<=",
                left: { kind: "ident", id: "i-n1", name: "n" },
                right: { kind: "literal", id: "l-1", value: 1 },
            },
            then: [{ kind: "ident", id: "i-n2", name: "n" }],
            else: [{
                kind: "binop", id: "b-add", op: "+",
                left: {
                    kind: "call", id: "c-fib1",
                    fn: { kind: "ident", id: "i-fib1", name: "fib" },
                    args: [{
                        kind: "binop", id: "b-sub1", op: "-",
                        left: { kind: "ident", id: "i-n3", name: "n" },
                        right: { kind: "literal", id: "l-1b", value: 1 },
                    }],
                },
                right: {
                    kind: "call", id: "c-fib2",
                    fn: { kind: "ident", id: "i-fib2", name: "fib" },
                    args: [{
                        kind: "binop", id: "b-sub2", op: "-",
                        left: { kind: "ident", id: "i-n4", name: "n" },
                        right: { kind: "literal", id: "l-2", value: 2 },
                    }],
                },
            }],
        }],
    }],
};

// =============================================================================
// Tests
// =============================================================================

describe("Sandbox Limits", () => {
    describe("Timeout", () => {
        it("kills an infinite loop within the specified timeout", async () => {
            const wasm = await compileAst(SLOW_PROGRAM_AST);

            const start = Date.now();
            const result = await run(wasm, "main", { timeoutMs: 500 });
            const elapsed = Date.now() - start;

            expect(result.exitCode).not.toBe(0);
            expect(result.error).toBe("execution_timeout");
            expect(result.limitInfo?.timeoutMs).toBe(500);
            // Should finish close to the timeout, not hang
            expect(elapsed).toBeLessThan(2000);
        }, 10_000);

        it("normal program completes within timeout", async () => {
            const wasm = await compileAst(HELLO_WORLD_AST);

            const result = await run(wasm, "main", { timeoutMs: 5000 });

            expect(result.exitCode).toBe(0);
            expect(result.output).toBe("Hello, World!");
            expect(result.error).toBeUndefined();
        }, 10_000);

        it("clamps timeoutMs to minimum of 100", async () => {
            const wasm = await compileAst(SLOW_PROGRAM_AST);

            // timeoutMs: 1 should be clamped to 100
            const result = await run(wasm, "main", { timeoutMs: 1 });

            // The slow program should still time out (even at 100ms)
            expect(result.error).toBe("execution_timeout");
            // limitInfo should reflect the clamped value, not the original
            expect(result.limitInfo?.timeoutMs).toBe(100);
        }, 10_000);

        it("applies default limits without hanging on normal programs", async () => {
            const wasm = await compileAst(HELLO_WORLD_AST);

            // Run without any limits specified — default timeout should apply
            // but program completes normally before it triggers
            const result = await run(wasm, "main");

            expect(result.exitCode).toBe(0);
            expect(result.output).toBe("Hello, World!");
            expect(result.error).toBeUndefined();
        }, 10_000);
    });

    describe("runDirect (no limits)", () => {
        it("executes WASM without worker overhead", async () => {
            const wasm = await compileAst(HELLO_WORLD_AST);

            const result = await runDirect(wasm, "main");

            expect(result.exitCode).toBe(0);
            expect(result.output).toBe("Hello, World!");
            expect(result.returnValue).toBe(0);
        });
    });

    describe("RunResult structure", () => {
        it("includes error and limitInfo fields on timeout", async () => {
            const wasm = await compileAst(SLOW_PROGRAM_AST);

            const result = await run(wasm, "main", { timeoutMs: 300 });

            // Verify the structured error shape
            expect(result).toHaveProperty("error");
            expect(result).toHaveProperty("limitInfo");
            expect(result.error).toBe("execution_timeout");
            expect(result.limitInfo).toEqual({ timeoutMs: 300 });
            expect(result.exitCode).toBe(1);
        }, 10_000);

        it("omits error and limitInfo on successful execution", async () => {
            const wasm = await compileAst(HELLO_WORLD_AST);

            const result = await run(wasm, "main", { timeoutMs: 5000 });

            expect(result.error).toBeUndefined();
            expect(result.limitInfo).toBeUndefined();
            expect(result.exitCode).toBe(0);
        }, 10_000);
    });
});
