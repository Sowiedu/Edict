// =============================================================================
// Browser WASM Runner — execute compiled Edict WASM in the browser
// =============================================================================
// Browser-compatible equivalent of runner.ts. Uses the browser WebAssembly API
// for instantiation and Web Workers for sandboxed execution with timeout.
//
// Execution model:
//   runBrowser()       → spawns Web Worker, enforces timeout, returns RunResult
//   runBrowserDirect() → in-process execution (used by worker and for quick runs)

import { createHostImports } from "../builtins/registry.js";
import { type RuntimeState, EdictOomError, getHeapUsage } from "../builtins/host-helpers.js";
import type { EdictHostAdapter } from "./host-adapter.js";
import { BrowserHostAdapter } from "./browser-host-adapter.js";
import type { RunResult, RunLimits } from "./runner.js";

// Re-export RunResult and RunLimits so browser consumers don't need runner.ts
export type { RunResult, RunLimits };

/* eslint-disable @typescript-eslint/no-namespace */
// Minimal WebAssembly type declarations for browser context
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

/** Options for browser-specific execution. */
export interface BrowserRunLimits {
    /** Max execution time in ms (default: 15_000, min: 100). */
    timeoutMs?: number;
    /** Max WASM memory in MB (compile-time, default: 1). */
    maxMemoryMb?: number;
    /** Optional host adapter. Defaults to BrowserHostAdapter. */
    adapter?: EdictHostAdapter;
    /** External WASM modules keyed by import namespace (base64-encoded). */
    externalModules?: Record<string, string>;
}

/**
 * Direct (in-process) browser WASM execution — no Web Worker, no timeout.
 *
 * Uses the browser's native WebAssembly API. All host imports are provided
 * via `BrowserHostAdapter` (or a custom adapter).
 *
 * @param wasm - WASM binary (Uint8Array from codegen)
 * @param entryFn - Function to call (default: "main")
 * @param limits - Optional execution limits
 */
export async function runBrowserDirect(
    wasm: Uint8Array,
    entryFn: string = "main",
    limits: BrowserRunLimits = {},
): Promise<RunResult> {
    const effectiveAdapter: EdictHostAdapter = limits.adapter ?? new BrowserHostAdapter();

    const state: RuntimeState = {
        outputParts: [],
        instance: null,
    };

    const importObject = createHostImports(state, effectiveAdapter);

    // External module loading (simplified — no shared memory path for browser)
    if (limits.externalModules) {
        for (const [namespace, base64] of Object.entries(limits.externalModules)) {
            if (importObject[namespace]) continue;
            try {
                const extBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                const { instance: extInstance } = await WebAssembly.instantiate(extBytes, {});
                const nsExports: Record<string, unknown> = {};
                for (const [key, val] of Object.entries(extInstance.exports)) {
                    if (typeof val === "function") {
                        nsExports[key] = val;
                    }
                }
                importObject[namespace] = nsExports;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return {
                    output: `External module error (${namespace}): ${msg}`,
                    exitCode: 1,
                };
            }
        }
    }

    let instance: WebAssembly.Instance;
    try {
        const result = await WebAssembly.instantiate(wasm, importObject);
        instance = result.instance;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            output: `WASM instantiation error: ${msg}`,
            exitCode: 1,
        };
    }
    state.instance = instance;

    let returnValue: number | undefined;
    let exitCode = 0;

    try {
        const mainFn = instance.exports[entryFn] as
            | ((...args: unknown[]) => number)
            | undefined;

        if (!mainFn || typeof mainFn !== "function") {
            return { output: "", exitCode: 1 };
        }

        returnValue = mainFn();
    } catch (e) {
        if (e instanceof EdictOomError) {
            return {
                output: state.outputParts.join(""),
                exitCode: 1,
                error: "execution_oom",
                limitInfo: { maxMemoryMb: Math.round(e.heapLimit / 1048576) },
            };
        }
        const msg = e instanceof Error ? e.message : String(e);
        const exitMatch = msg.match(/^edict_exit:(\d+)$/);
        if (exitMatch) {
            exitCode = parseInt(exitMatch[1]!, 10);
        } else {
            state.outputParts.push(`Runtime error: ${msg}`);
            exitCode = 1;
        }
    }

    const heapUsed = state.instance ? getHeapUsage(state).used : undefined;

    return {
        output: state.outputParts.join(""),
        exitCode,
        returnValue,
        ...(heapUsed !== undefined && heapUsed > 0 ? { heapUsed } : {}),
    };
}

/**
 * Execute WASM in a Web Worker with timeout enforcement.
 *
 * Creates an inline Web Worker via Blob URL that runs a minimal WASM executor.
 * If execution exceeds the timeout, the worker is terminated.
 *
 * **Limitation**: The Worker sandbox includes only basic host functions:
 * print, string ops, int/float_to_string, panic, exit, random_int, time_now.
 * Programs using crypto, HTTP, file IO, or other domain builtins should use
 * `runBrowserDirect()` instead, which has the full host import set via
 * `createHostImports()`.
 *
 * **Note**: Requires a browser environment with Web Worker support.
 * In environments without `Worker` (e.g., Node.js vitest), falls back to
 * `runBrowserDirect()`.
 *
 * @param wasm - WASM binary (Uint8Array from codegen)
 * @param entryFn - Function to call (default: "main")
 * @param limits - Execution limits (timeout, adapter)
 */
export async function runBrowser(
    wasm: Uint8Array,
    entryFn: string = "main",
    limits: BrowserRunLimits = {},
): Promise<RunResult> {
    // If Web Workers aren't available, fall back to direct execution
    if (typeof Worker === "undefined") {
        return runBrowserDirect(wasm, entryFn, limits);
    }

    const timeoutMs = Math.max(100, limits.timeoutMs ?? 15_000);

    return new Promise<RunResult>((resolvePromise) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        // The worker script runs runBrowserDirect inline.
        // We self-contain a minimal runner to avoid import complexities.
        const workerScript = `
            self.onmessage = async function(e) {
                const { wasm, entryFn } = e.data;
                const wasmBytes = new Uint8Array(wasm);
                const outputParts = [];
                const encoder = new TextEncoder();
                const decoder = new TextDecoder();

                // Minimal host imports for the Web Worker context
                function readString(memory, ptr) {
                    const buf = memory.buffer;
                    const view = new DataView(buf);
                    const len = view.getInt32(ptr, true);
                    const bytes = new Uint8Array(buf, ptr + 4, len);
                    return decoder.decode(bytes);
                }
                function allocateHeap(exports, size) {
                    const ptr = exports.__get_heap_ptr();
                    const aligned = Math.ceil(size / 8) * 8;
                    exports.__set_heap_ptr(ptr + aligned);
                    return ptr;
                }
                function writeString(exports, str) {
                    const encoded = encoder.encode(str);
                    const totalSize = 4 + encoded.length;
                    const resultPtr = allocateHeap(exports, totalSize);
                    const buf = exports.memory.buffer;
                    const view = new DataView(buf);
                    view.setInt32(resultPtr, encoded.length, true);
                    const dest = new Uint8Array(buf, resultPtr + 4, encoded.length);
                    dest.set(encoded);
                    return resultPtr;
                }

                let wasmExports = null;
                const hostFunctions = {
                    print: (ptr) => {
                        const str = readString(wasmExports.memory, ptr);
                        outputParts.push(str);
                        return ptr;
                    },
                    println: (ptr) => {
                        const str = readString(wasmExports.memory, ptr);
                        outputParts.push(str + "\n");
                        return ptr;
                    },
                    int_to_string: (n) => writeString(wasmExports, String(n)),
                    float_to_string: (n) => writeString(wasmExports, String(n)),
                    string_length: (ptr) => {
                        const buf = wasmExports.memory.buffer;
                        return new DataView(buf).getInt32(ptr, true);
                    },
                    string_concat: (aPtr, bPtr) => {
                        const a = readString(wasmExports.memory, aPtr);
                        const b = readString(wasmExports.memory, bPtr);
                        return writeString(wasmExports, a + b);
                    },
                    string_eq: (aPtr, bPtr) => {
                        const a = readString(wasmExports.memory, aPtr);
                        const b = readString(wasmExports.memory, bPtr);
                        return a === b ? 1 : 0;
                    },
                    panic: (ptr) => {
                        const msg = readString(wasmExports.memory, ptr);
                        throw new Error("edict_panic: " + msg);
                    },
                    exit: (code) => { throw new Error("edict_exit:" + code); },
                    random_int: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
                    time_now: () => Date.now(),
                };

                try {
                    const result = await WebAssembly.instantiate(wasmBytes, { host: hostFunctions });
                    wasmExports = result.instance.exports;
                    const mainFn = wasmExports[entryFn];
                    if (!mainFn || typeof mainFn !== 'function') {
                        self.postMessage({ type: 'result', data: { output: '', exitCode: 1 } });
                        return;
                    }
                    let exitCode = 0;
                    let returnValue;
                    try {
                        returnValue = mainFn();
                    } catch (err) {
                        const msg = err.message || String(err);
                        const exitMatch = msg.match(/^edict_exit:(\\d+)$/);
                        if (exitMatch) { exitCode = parseInt(exitMatch[1], 10); }
                        else { outputParts.push('Runtime error: ' + msg); exitCode = 1; }
                    }
                    self.postMessage({
                        type: 'result',
                        data: { output: outputParts.join(''), exitCode, returnValue }
                    });
                } catch (err) {
                    self.postMessage({
                        type: 'error',
                        message: err.message || String(err)
                    });
                }
            };
        `;

        const blob = new Blob([workerScript], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);

        function settle(result: RunResult): void {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolvePromise(result);
        }

        // Timeout — kill the worker
        timer = setTimeout(() => {
            worker.terminate();
            settle({
                output: "",
                exitCode: 1,
                error: "execution_timeout",
                limitInfo: { timeoutMs },
            });
        }, timeoutMs);

        worker.onmessage = (ev: { data: unknown }) => {
            const msg = ev.data as { type: string; data?: RunResult; message?: string };
            if (msg.type === "result" && msg.data) {
                settle(msg.data);
            } else if (msg.type === "error") {
                settle({
                    output: msg.message ?? "Worker execution error",
                    exitCode: 1,
                });
            }
        };

        worker.onerror = (err: { message: string }) => {
            settle({
                output: `Runtime error: ${err.message}`,
                exitCode: 1,
            });
        };

        // Send WASM bytes to the worker (transfer for zero-copy)
        const wasmCopy = new Uint8Array(wasm).buffer as ArrayBuffer;
        worker.postMessage(
            { wasm: wasmCopy, entryFn },
            [wasmCopy],
        );
    });
}

// Minimal browser API type declarations for Node-targeted TypeScript
declare class Worker {
    constructor(url: string | URL);
    postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
    terminate(): void;
    onmessage: ((ev: { data: unknown }) => void) | null;
    onerror: ((ev: { message: string }) => void) | null;
}
declare class Blob {
    constructor(parts: (string | ArrayBuffer | Uint8Array)[], options?: { type?: string });
}
declare class URL {
    constructor(url: string, base?: string);
    static createObjectURL(obj: Blob): string;
    static revokeObjectURL(url: string): void;
}
