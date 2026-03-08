// =============================================================================
// WASM Runner — Execute compiled Edict WASM binaries
// =============================================================================
// Instantiates WASM via Node's WebAssembly API, provides host imports
// (e.g. print), captures output, and returns the result.
//
// Execution model:
//   run()       → spawns worker thread, enforces timeout, returns RunResult
//   runDirect() → synchronous execution (used by worker and tests)

import { Worker } from "node:worker_threads";
import { createHostImports } from "../builtins/registry.js";
import { type RuntimeState, EdictOomError, getHeapUsage } from "../builtins/host-helpers.js";
import type { EdictHostAdapter } from "./host-adapter.js";

/* eslint-disable @typescript-eslint/no-namespace */
// Minimal WebAssembly type declarations for Node.js runtime
declare namespace WebAssembly {
    interface Memory {
        readonly buffer: ArrayBuffer;
    }
    interface Exports {
        [key: string]: unknown;
        memory?: Memory;
    }
    interface Instance {
        readonly exports: Exports;
    }
    interface InstantiateResult {
        instance: Instance;
    }
    function instantiate(
        bufferSource: Uint8Array,
        importObject?: Record<string, Record<string, unknown>>,
    ): Promise<InstantiateResult>;
}

/** Configuration for execution sandbox limits */
export interface RunLimits {
    /** Max execution time in ms (default: 15_000, min: 100) */
    timeoutMs?: number;
    /** Max WASM memory in MB (compile-time, default: 1) */
    maxMemoryMb?: number;
    /** Sandbox directory for file IO builtins. If unset, readFile/writeFile return Err. */
    sandboxDir?: string;
    /** Optional host adapter for platform-specific operations. Defaults to NodeHostAdapter. */
    adapter?: EdictHostAdapter;
}

export interface RunResult {
    /** Captured stdout output */
    output: string;
    /** Exit code (0 = success) */
    exitCode: number;
    /** Return value from main (if any) */
    returnValue?: number;
    /** Runtime limit error, if execution was killed */
    error?: "execution_timeout" | "execution_oom";
    /** Limit values that were enforced */
    limitInfo?: { timeoutMs?: number; maxMemoryMb?: number };
    /** Heap bytes consumed by the program's allocations (only set on success) */
    heapUsed?: number;
}

/**
 * Run a compiled Edict WASM binary with sandbox limits.
 *
 * Spawns a worker thread and enforces a timeout. If execution exceeds
 * the timeout, the worker is terminated and a structured error is returned.
 *
 * @param wasm - The WASM binary (Uint8Array from codegen)
 * @param entryFn - Name of the function to call (default: "main")
 * @param limits - Optional execution limits (timeout, memory)
 */
export async function run(
    wasm: Uint8Array,
    entryFn: string = "main",
    limits: RunLimits = {},
): Promise<RunResult> {
    const timeoutMs = Math.max(100, limits.timeoutMs ?? 15_000);

    return new Promise<RunResult>((resolvePromise) => {
        // import.meta.url is the URL of this module (runner.ts in dev, runner.js in prod).
        // The worker dynamically imports this same module to call runDirect().
        const runnerModuleUrl = import.meta.url;

        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        // Inline ESM worker script. Since package.json has "type": "module",
        // eval workers run in ESM mode — we use import rather than require.
        // For dev/vitest (.ts files), we register the tsx ESM loader first.
        const workerScript = `
            import { workerData, parentPort } from "node:worker_threads";

            const url = workerData.runnerModuleUrl;

            // In dev/vitest, module URL ends in .ts — register tsx ESM loader
            if (url.endsWith(".ts")) {
                const { register } = await import("tsx/esm/api");
                register();
            }

            try {
                const runner = await import(url);
                const wasmBytes = new Uint8Array(workerData.wasm);
                const result = await runner.runDirect(wasmBytes, workerData.entryFn, { sandboxDir: workerData.sandboxDir });
                parentPort.postMessage({ type: "result", data: result });
            } catch (e) {
                parentPort.postMessage({
                    type: "error",
                    message: e instanceof Error ? e.message : String(e),
                });
            }
        `;

        const worker = new Worker(workerScript, {
            eval: true,
            workerData: {
                wasm: Buffer.from(wasm),
                entryFn,
                runnerModuleUrl,
                sandboxDir: limits.sandboxDir,
            },
            // Register tsx ESM loader so the worker can import .ts files (vitest/dev)
            execArgv: ["--import", "tsx"],
        });

        function settle(result: RunResult): void {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolvePromise(result);
        }

        // Timeout — kill the worker
        timer = setTimeout(() => {
            worker.terminate().then(() => {
                settle({
                    output: "",
                    exitCode: 1,
                    error: "execution_timeout",
                    limitInfo: { timeoutMs },
                });
            });
        }, timeoutMs);

        // Worker completed successfully
        worker.on("message", (msg: { type: string; data?: RunResult; message?: string }) => {
            if (msg.type === "result" && msg.data) {
                settle(msg.data);
            } else if (msg.type === "error") {
                settle({
                    output: msg.message ?? "Worker execution error",
                    exitCode: 1,
                });
            }
        });

        // Worker crashed (OOM, etc.)
        worker.on("error", (err: Error) => {
            const isOom = err.message?.includes("out of memory") ||
                err.message?.includes("memory access") ||
                err.message?.includes("grow");
            settle({
                output: `Runtime error: ${err.message}`,
                exitCode: 1,
                error: isOom ? "execution_oom" : undefined,
                limitInfo: isOom ? { maxMemoryMb: limits.maxMemoryMb ?? 1 } : undefined,
            });
        });

        // Worker exited unexpectedly
        worker.on("exit", (code) => {
            if (code !== 0) {
                settle({
                    output: "",
                    exitCode: code,
                    error: "execution_timeout",
                    limitInfo: { timeoutMs },
                });
            }
        });
    });
}

/**
 * Direct (in-process) WASM execution — no worker thread, no timeout.
 *
 * Used by the worker thread internally and available for tests
 * that don't need sandbox limits.
 *
 * @param wasm - The WASM binary (Uint8Array from codegen)
 * @param entryFn - Name of the function to call (default: "main")
 * @param limits - Optional execution limits (sandboxDir for file IO)
 */
export async function runDirect(
    wasm: Uint8Array,
    entryFn: string = "main",
    limits: RunLimits = {},
): Promise<RunResult> {
    const state: RuntimeState = { outputParts: [], instance: null, sandboxDir: limits.sandboxDir };
    const importObject = createHostImports(state, limits.adapter);

    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    state.instance = instance;

    let returnValue: number | undefined;
    let exitCode = 0;

    try {
        const mainFn = instance.exports[entryFn] as
            | ((...args: unknown[]) => number)
            | undefined;

        if (!mainFn || typeof mainFn !== "function") {
            return {
                output: "",
                exitCode: 1,
            };
        }

        returnValue = mainFn();
    } catch (e) {
        // Heap bounds check failed — structured OOM error
        if (e instanceof EdictOomError) {
            return {
                output: state.outputParts.join(""),
                exitCode: 1,
                error: "execution_oom",
                limitInfo: { maxMemoryMb: Math.round(e.heapLimit / 1048576) },
            };
        }
        const msg = e instanceof Error ? e.message : String(e);
        // Handle edict_exit:N — clean process exit, not an error
        const exitMatch = msg.match(/^edict_exit:(\d+)$/);
        if (exitMatch) {
            exitCode = parseInt(exitMatch[1]!, 10);
        } else {
            state.outputParts.push(`Runtime error: ${msg}`);
            exitCode = 1;
        }
    }

    // Read heap usage after execution (zero-cost — one WASM global read)
    const heapUsed = state.instance ? getHeapUsage(state).used : undefined;

    return {
        output: state.outputParts.join(""),
        exitCode,
        returnValue,
        ...(heapUsed !== undefined && heapUsed > 0 ? { heapUsed } : {}),
    };
}

// =============================================================================
// Debug execution — call stack tracking and crash diagnostics
// =============================================================================

import type { DebugMetadata } from "./types.js";
import { readString } from "../builtins/host-helpers.js";

/** Result from debug execution — includes crash diagnostics and trace info */
export interface DebugResult {
    /** Captured stdout output */
    output: string;
    /** Exit code (0 = success) */
    exitCode: number;
    /** Return value from main (if any) */
    returnValue?: number;
    /** Call stack at crash time (function names, outermost first) */
    callStack?: string[];
    /** Crash location — mapped from debug metadata */
    crashLocation?: { fn: string; nodeId: string };
    /** Number of function entries recorded */
    stepsExecuted: number;
    /** Error type, if execution was killed */
    error?: "execution_timeout" | "execution_oom" | "step_limit_exceeded";
}

/** Options for debug execution */
export interface DebugOptions {
    /** Maximum number of function entries before stopping (default: 10_000) */
    maxSteps?: number;
    /** Sandbox directory for file IO builtins */
    sandboxDir?: string;
    /** Optional host adapter */
    adapter?: EdictHostAdapter;
}

/** Thrown when step limit is exceeded during debug execution */
class StepLimitError extends Error {
    constructor(public stepsExecuted: number) {
        super("step_limit_exceeded");
    }
}

/**
 * Execute a debug-instrumented WASM binary with call stack tracking.
 *
 * Must be compiled with `debugMode: true` so the WASM contains
 * `__trace_enter` / `__trace_exit` calls.
 *
 * @param wasm - The WASM binary (compiled with debugMode: true)
 * @param debugMetadata - fnName→nodeId mapping from compile result
 * @param options - Debug execution options (maxSteps, sandboxDir)
 */
export async function runDebug(
    wasm: Uint8Array,
    debugMetadata: DebugMetadata,
    options: DebugOptions = {},
): Promise<DebugResult> {
    const maxSteps = options.maxSteps ?? 10_000;
    const callStack: string[] = [];
    let stepsExecuted = 0;

    const state: RuntimeState = {
        outputParts: [],
        instance: null,
        sandboxDir: options.sandboxDir,
    };
    const importObject = createHostImports(state, options.adapter);

    const decoder = new TextDecoder();

    // Add debug host functions that track the call stack
    importObject["debug"] = {
        __trace_enter: (fnNamePtr: number) => {
            stepsExecuted++;
            if (stepsExecuted > maxSteps) {
                throw new StepLimitError(stepsExecuted);
            }
            const fnName = readString(state, fnNamePtr, decoder);
            callStack.push(fnName);
        },
        __trace_exit: (fnNamePtr: number) => {
            const fnName = readString(state, fnNamePtr, decoder);
            // Pop matching fn from stack (handles normal exits)
            const idx = callStack.lastIndexOf(fnName);
            if (idx !== -1) {
                callStack.splice(idx, 1);
            }
        },
    };

    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    state.instance = instance;

    let returnValue: number | undefined;
    let exitCode = 0;

    try {
        const mainFn = instance.exports["main"] as
            | ((...args: unknown[]) => number)
            | undefined;

        if (!mainFn || typeof mainFn !== "function") {
            return {
                output: "",
                exitCode: 1,
                stepsExecuted: 0,
            };
        }

        returnValue = mainFn();
    } catch (e) {
        // Step limit exceeded
        if (e instanceof StepLimitError) {
            const topFn = callStack.length > 0 ? callStack[callStack.length - 1]! : undefined;
            return {
                output: state.outputParts.join(""),
                exitCode: 1,
                callStack: [...callStack],
                crashLocation: topFn ? {
                    fn: topFn,
                    nodeId: debugMetadata.fnMap[topFn] ?? "unknown",
                } : undefined,
                stepsExecuted,
                error: "step_limit_exceeded",
            };
        }

        // Heap OOM
        if (e instanceof EdictOomError) {
            const topFn = callStack.length > 0 ? callStack[callStack.length - 1]! : undefined;
            return {
                output: state.outputParts.join(""),
                exitCode: 1,
                callStack: [...callStack],
                crashLocation: topFn ? {
                    fn: topFn,
                    nodeId: debugMetadata.fnMap[topFn] ?? "unknown",
                } : undefined,
                stepsExecuted,
                error: "execution_oom",
            };
        }

        const msg = e instanceof Error ? e.message : String(e);
        // Handle edict_exit:N — clean process exit
        const exitMatch = msg.match(/^edict_exit:(\d+)$/);
        if (exitMatch) {
            exitCode = parseInt(exitMatch[1]!, 10);
        } else {
            // Runtime error (WASM trap, division by zero, etc.)
            const topFn = callStack.length > 0 ? callStack[callStack.length - 1]! : undefined;
            return {
                output: state.outputParts.join("") + `Runtime error: ${msg}`,
                exitCode: 1,
                callStack: [...callStack],
                crashLocation: topFn ? {
                    fn: topFn,
                    nodeId: debugMetadata.fnMap[topFn] ?? "unknown",
                } : undefined,
                stepsExecuted,
            };
        }
    }

    return {
        output: state.outputParts.join(""),
        exitCode,
        returnValue,
        stepsExecuted,
    };
}
