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
export { contractVerify, clearVerificationCache } from "./contracts/verify.js";
export type { ContractVerifyResult, ContractVerifyOptions } from "./contracts/verify.js";
export { getZ3, getSolver, resetZ3 } from "./contracts/z3-context.js";

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
