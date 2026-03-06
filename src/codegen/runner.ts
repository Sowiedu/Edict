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
import { createHostImports, type RuntimeState } from "./host-functions.js";

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
    /** Max execution time in ms (default: 5000, min: 100) */
    timeoutMs?: number;
    /** Max WASM memory in MB (compile-time, default: 1) */
    maxMemoryMb?: number;
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
    const timeoutMs = Math.max(100, limits.timeoutMs ?? 5000);

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
                const result = await runner.runDirect(wasmBytes, workerData.entryFn);
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
 */
export async function runDirect(
    wasm: Uint8Array,
    entryFn: string = "main",
): Promise<RunResult> {
    const state: RuntimeState = { outputParts: [], instance: null };
    const importObject = createHostImports(state);

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
        state.outputParts.push(
            `Runtime error: ${e instanceof Error ? e.message : String(e)}`,
        );
        exitCode = 1;
    }

    return {
        output: state.outputParts.join(""),
        exitCode,
        returnValue,
    };
}
