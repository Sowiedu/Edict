/**
 * @module edict-lang/browser-full
 *
 * Edict Browser Full API — the complete pipeline including compilation and execution.
 *
 * Re-exports everything from `edict-lang/browser` (phases 1–3, lint, patch, compose)
 * and adds:
 * - Phase 4: Contract verification via Z3 (requires `initEdictBrowser()` first)
 * - Phase 5: WASM compilation via pure-JS encoder
 * - Phase 6: WASM execution via the browser WebAssembly API
 *
 * Quick start:
 *   1. Call `initEdictBrowser()` once (loads Z3 WASM, ~1-2s)
 *   2. Call `compileBrowserFull(ast)` to compile an Edict program
 *   3. Call `runBrowserDirect(wasm)` to execute the resulting WASM
 *
 * For environments where Z3 is not available, use `compileBrowser(ast)` which
 * skips contract verification (phase 4).
 */

// ---------------------------------------------------------------------------
// Re-export everything from the lightweight browser entry
// ---------------------------------------------------------------------------
export * from "./browser.js";

// ---------------------------------------------------------------------------
// Phase 4 — Contract Verification: Z3 SMT proving
// ---------------------------------------------------------------------------
export { contractVerify, contractVerifySync, clearVerificationCache } from "./contracts/verify.js";
export type { ContractVerifyResult, ContractVerifyOptions } from "./contracts/verify.js";
export { getZ3, getSolver, resetZ3 } from "./contracts/z3-context.js";

// ---------------------------------------------------------------------------
// Phase 4 (browser) — Contract Verification: built-in QF-LIA solver (no Z3)
// ---------------------------------------------------------------------------
export { checkBrowserFull } from "./check-browser-full.js";
export type { CheckBrowserFullResult, CheckBrowserFullSuccess, CheckBrowserFullFailure } from "./check-browser-full.js";
export { createBuiltinSolver } from "./contracts/solver/index.js";
export type { SolverContext } from "./contracts/solver-context.js";

// ---------------------------------------------------------------------------
// Phase 5 — Code Generation: WASM compilation via pure-JS encoder
// ---------------------------------------------------------------------------
export { compile } from "./codegen/codegen.js";
export type {
    CompileResult,
    CompileSuccess,
    CompileFailure,
    CompileOptions,
} from "./codegen/codegen.js";

// ---------------------------------------------------------------------------
// Phase 6 — Execution: browser WASM runner
// ---------------------------------------------------------------------------
export { runBrowserDirect, runBrowser } from "./codegen/browser-runner.js";
export type { BrowserRunLimits } from "./codegen/browser-runner.js";
export type { RunResult } from "./codegen/runner.js";

// ---------------------------------------------------------------------------
// Phase 6 — Execution: pure-JS WASM interpreter (QuickJS-compatible)
// ---------------------------------------------------------------------------
export { wasmInstantiate } from "./codegen/wasm-interpreter.js";
export type { WasmInstance, WasmInterpreterResult, WasmInterpreterOptions } from "./codegen/wasm-interpreter.js";

// ---------------------------------------------------------------------------
// Host Adapters
// ---------------------------------------------------------------------------
export type { EdictHostAdapter } from "./codegen/host-adapter.js";
export { BrowserHostAdapter } from "./codegen/browser-host-adapter.js";
export type { BrowserHostAdapterOptions } from "./codegen/browser-host-adapter.js";
export { EdictOomError } from "./builtins/host-helpers.js";

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { checkBrowser, type CheckBrowserResult } from "./check-browser.js";
import { check, type CheckResult } from "./check.js";
import { compile } from "./codegen/codegen.js";
import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "./errors/structured-errors.js";
import type { EdictModule } from "./ast/nodes.js";
import type { TypedModuleInfo } from "./checker/check.js";
import type { CompileResult } from "./codegen/codegen.js";

// ---------------------------------------------------------------------------
// Z3 Initialization
// ---------------------------------------------------------------------------

let z3Initialized = false;

/**
 * Initialize the Edict browser compiler.
 *
 * This must be called once before using `compileBrowserFull()`. It loads Z3's
 * WASM binary (~34MB) and initializes the theorem prover. Subsequent calls
 * are no-ops.
 *
 * For Z3 to work in the browser, the consumer must load `z3-built.js` before
 * calling this function. This sets `globalThis.initZ3` which Z3 needs.
 *
 * If Z3 initialization fails, `compileBrowserFull()` falls back to
 * `compileBrowser()` (skipping contract verification).
 *
 * @returns `{ ok: true }` on success, `{ ok: false, error }` on failure
 */
export async function initEdictBrowser(): Promise<{ ok: boolean; error?: string }> {
    if (z3Initialized) return { ok: true };
    try {
        const { getZ3 } = await import("./contracts/z3-context.js");
        await getZ3();
        z3Initialized = true;
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}

/**
 * Check if Z3 has been initialized for contract verification.
 */
export function isZ3Initialized(): boolean {
    return z3Initialized;
}

// ---------------------------------------------------------------------------
// Convenience Wrappers
// ---------------------------------------------------------------------------

/** Result of a browser compilation (phases 1-3/5 + compile). */
export interface CompileBrowserResult {
    ok: boolean;
    /** WASM bytes (only when ok === true) */
    wasm?: Uint8Array;
    errors: StructuredError[];
    /** Validated module AST (only when ok === true) */
    module?: EdictModule;
    /** Inferred type information */
    typeInfo?: TypedModuleInfo;
    /** Analysis diagnostics */
    diagnostics?: AnalysisDiagnostic[];
}

/** Result of a full browser compilation (with contract verification). */
export interface CompileBrowserFullResult extends CompileBrowserResult {
    /** Z3 verification coverage (only when Z3 is initialized) */
    coverage?: VerificationCoverage;
}

/**
 * Full browser pipeline: validate → resolve → typeCheck → effectCheck → contractVerify → compile.
 *
 * Reuses the existing `check()` pipeline (no duplication). If Z3 is not
 * initialized, falls back to `compileBrowser()` (skips contract verification).
 *
 * @param ast - Any JSON value to compile
 * @returns `{ ok, wasm?, errors, module?, typeInfo?, diagnostics?, coverage? }`
 */
export async function compileBrowserFull(ast: unknown): Promise<CompileBrowserFullResult> {
    if (!z3Initialized) {
        // Fall back to compileBrowser (no Z3)
        return compileBrowser(ast);
    }

    // Reuse the full pipeline from check.ts (phases 1-4)
    const checkResult: CheckResult = await check(ast);
    if (!checkResult.ok) {
        return {
            ok: false,
            errors: checkResult.errors,
            diagnostics: checkResult.diagnostics,
        };
    }

    // Phase 5 — Compile
    const compileResult: CompileResult = compile(checkResult.module!, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    return {
        ok: true,
        wasm: compileResult.wasm,
        errors: [],
        module: checkResult.module,
        typeInfo: checkResult.typeInfo,
        diagnostics: checkResult.diagnostics,
        coverage: checkResult.coverage,
    };
}

/**
 * Browser pipeline without contract verification:
 * validate → resolve → typeCheck → effectCheck → compile.
 *
 * Reuses `checkBrowser()` (no duplication). Does not require Z3.
 *
 * @param ast - Any JSON value to compile
 * @returns `{ ok, wasm?, errors, module?, typeInfo?, diagnostics? }`
 */
export function compileBrowser(ast: unknown): CompileBrowserResult {
    // Reuse the browser pipeline from check-browser.ts (phases 1-3)
    const checkResult: CheckBrowserResult = checkBrowser(ast);
    if (!checkResult.ok) {
        return {
            ok: false,
            errors: checkResult.errors,
            diagnostics: checkResult.diagnostics,
        };
    }

    // Phase 5 — Compile
    const compileResult: CompileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    return {
        ok: true,
        wasm: compileResult.wasm,
        errors: [],
        module: checkResult.module,
        typeInfo: checkResult.typeInfo,
        diagnostics: checkResult.diagnostics,
    };
}

// ---------------------------------------------------------------------------
// Interpreted WASM execution — for QuickJS self-hosting
// ---------------------------------------------------------------------------
// This function provides a self-contained WASM execution capability using
// the pure-JS interpreter, with minimal inline host imports.
// Used by EdictQuickJS.run() via Edict.runInterpreted() in the IIFE bundle.

import { wasmInstantiate } from "./codegen/wasm-interpreter.js";

/** Result of interpreted WASM execution. */
export interface InterpretedRunResult {
    output: string;
    exitCode: number;
    returnValue?: number;
    error?: string;
}

/**
 * Execute WASM bytes using the pure-JS interpreter with minimal host imports.
 *
 * @param wasmBytes - Array of byte values (not Uint8Array, for JSON transport)
 * @param entryFn - Function name to call (default: "main")
 * @param maxSteps - Max instructions (default: 10_000_000)
 * @returns InterpretedRunResult with output, exitCode, returnValue
 */
export function runInterpreted(
    wasmBytes: number[],
    entryFn: string = "main",
    maxSteps: number = 10_000_000,
): InterpretedRunResult {
    const bytes = new Uint8Array(wasmBytes);
    const outputParts: string[] = [];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let wasmExports: Record<string, unknown> = {};

    function readString(ptr: number): string {
        const mem = wasmExports.memory as { buffer: ArrayBuffer };
        const view = new DataView(mem.buffer);
        const len = view.getInt32(ptr, true);
        const u8 = new Uint8Array(mem.buffer, ptr + 4, len);
        return decoder.decode(u8);
    }

    function allocateHeap(size: number): number {
        const getPtr = wasmExports.__get_heap_ptr as () => number;
        const setPtr = wasmExports.__set_heap_ptr as (p: number) => void;
        const ptr = getPtr();
        const aligned = Math.ceil(size / 8) * 8;
        setPtr(ptr + aligned);
        return ptr;
    }

    function writeString(str: string): number {
        const encoded = encoder.encode(str);
        const totalSize = 4 + encoded.length;
        const resultPtr = allocateHeap(totalSize);
        const mem = wasmExports.memory as { buffer: ArrayBuffer };
        const view = new DataView(mem.buffer);
        view.setInt32(resultPtr, encoded.length, true);
        new Uint8Array(mem.buffer, resultPtr + 4, encoded.length).set(encoded);
        return resultPtr;
    }

    // Minimal host imports — matches browser worker set
    const hostFunctions: Record<string, Function> = {
        print: (ptr: number) => { outputParts.push(readString(ptr)); return ptr; },
        println: (ptr: number) => { outputParts.push(readString(ptr) + "\n"); return ptr; },
        int_to_string: (n: number) => writeString(String(n)),
        float_to_string: (n: number) => writeString(String(n)),
        string_length: (ptr: number) => {
            const mem = wasmExports.memory as { buffer: ArrayBuffer };
            return new DataView(mem.buffer).getInt32(ptr, true);
        },
        string_concat: (a: number, b: number) => writeString(readString(a) + readString(b)),
        string_eq: (a: number, b: number) => readString(a) === readString(b) ? 1 : 0,
        string_replace: (sPtr: number, fromPtr: number, toPtr: number) => {
            const s = readString(sPtr), from = readString(fromPtr), to = readString(toPtr);
            return writeString(s.split(from).join(to));
        },
        string_contains: (sPtr: number, subPtr: number) => {
            return readString(sPtr).includes(readString(subPtr)) ? 1 : 0;
        },
        string_slice: (sPtr: number, start: number, end: number) => {
            return writeString(readString(sPtr).slice(start, end));
        },
        substring: (sPtr: number, start: number, end: number) => {
            return writeString(readString(sPtr).substring(start, end));
        },
        char_at: (sPtr: number, idx: number) => {
            const s = readString(sPtr);
            return idx >= 0 && idx < s.length ? writeString(s[idx]!) : writeString("");
        },
        string_index_of: (sPtr: number, subPtr: number) => {
            return readString(sPtr).indexOf(readString(subPtr));
        },
        string_upper: (sPtr: number) => writeString(readString(sPtr).toUpperCase()),
        string_lower: (sPtr: number) => writeString(readString(sPtr).toLowerCase()),
        string_trim: (sPtr: number) => writeString(readString(sPtr).trim()),
        string_starts_with: (sPtr: number, prefPtr: number) => {
            return readString(sPtr).startsWith(readString(prefPtr)) ? 1 : 0;
        },
        string_ends_with: (sPtr: number, sufPtr: number) => {
            return readString(sPtr).endsWith(readString(sufPtr)) ? 1 : 0;
        },
        string_repeat: (sPtr: number, n: number) => writeString(readString(sPtr).repeat(n)),
        string_reverse: (sPtr: number) => writeString([...readString(sPtr)].reverse().join("")),
        panic: (ptr: number) => { throw new Error("edict_panic: " + readString(ptr)); },
        exit: (code: number) => { throw new Error("edict_exit:" + code); },
        random_int: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
        time_now: () => Date.now(),
    };

    // Wrap with Proxy so unknown host builtins produce a clear error at call time
    // rather than a generic wasm_link error at instantiation time
    const hostProxy = new Proxy(hostFunctions, {
        get(target, prop) {
            if (typeof prop === "string" && !(prop in target)) {
                return (..._args: unknown[]) => {
                    throw new Error("wasm_trap: unimplemented host builtin '" + prop + "'");
                };
            }
            return target[prop as string];
        },
    });

    try {
        const { instance } = wasmInstantiate(bytes, { host: hostProxy }, { maxSteps });
        wasmExports = instance.exports as Record<string, unknown>;
        const mainFn = instance.exports[entryFn] as ((...args: unknown[]) => number) | undefined;

        if (!mainFn || typeof mainFn !== "function") {
            return { output: "", exitCode: 1, error: "entry function not found: " + entryFn };
        }

        let exitCode = 0;
        let returnValue: number | undefined;
        try {
            returnValue = mainFn();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const exitMatch = msg.match(/^edict_exit:(\d+)$/);
            if (exitMatch) {
                exitCode = parseInt(exitMatch[1]!, 10);
            } else {
                outputParts.push("Runtime error: " + msg);
                exitCode = 1;
            }
        }

        return { output: outputParts.join(""), exitCode, returnValue };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { output: "", exitCode: 1, error: msg };
    }
}
