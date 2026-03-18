// =============================================================================
// EdictQuickJS — Self-hosted compiler in QuickJS-WASM
// =============================================================================
// Packages the Edict compiler pipeline inside a QuickJS-WASM interpreter,
// providing a reusable API for running schema validation, name resolution,
// type checking, effect checking, and WASM compilation in sandboxed/edge
// environments.
//
// Two bundles are available:
//   - dist/edict-quickjs-check.js  — phases 1-3 (check only, 365 KB)
//   - dist/edict-quickjs-full.js   — phases 1-5 (check + compile, 860 KB)
//
// Usage:
//   const edict = await EdictQuickJS.create();          // check-only
//   const edict = await EdictQuickJS.createFull();       // check + compile
//   const checkResult = edict.check(ast);
//   const compileResult = edict.compile(ast);            // requires full bundle
//   edict.dispose();

import type { QuickJSWASMModule, QuickJSRuntime, QuickJSContext } from "quickjs-emscripten";
import { getQuickJS } from "quickjs-emscripten";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckBrowserResult } from "../browser.js";
import type { StructuredError } from "../errors/structured-errors.js";
import { quickjsRuntimeError } from "../errors/structured-errors.js";

// Path to the IIFE bundles — built by scripts/build-quickjs-bundle.ts
const DEFAULT_CHECK_BUNDLE_PATH = resolve(
    import.meta.dirname ?? new URL(".", import.meta.url).pathname,
    "../../dist/edict-quickjs-check.js",
);

const DEFAULT_FULL_BUNDLE_PATH = resolve(
    import.meta.dirname ?? new URL(".", import.meta.url).pathname,
    "../../dist/edict-quickjs-full.js",
);

// Minimal polyfills for Web APIs missing in QuickJS
const POLYFILLS = `
globalThis.TextEncoder = class TextEncoder {
    encode(str) {
        const arr = [];
        for (let i = 0; i < str.length; i++) {
            let c = str.charCodeAt(i);
            if (c < 0x80) {
                arr.push(c);
            } else if (c < 0x800) {
                arr.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
            } else {
                arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
            }
        }
        return new Uint8Array(arr);
    }
};
globalThis.TextDecoder = class TextDecoder {
    decode(buf) {
        const bytes = new Uint8Array(buf);
        let str = "";
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b < 0x80) {
                str += String.fromCharCode(b);
            } else if (b < 0xe0) {
                str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f));
            } else {
                str += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
            }
        }
        return str;
    }
};
`;

export interface EdictQuickJSOptions {
    /** Override the default bundle path (dist/edict-quickjs-check.js) */
    bundlePath?: string;
    /** Pass the IIFE bundle source directly (avoids readFileSync — use in fs-free environments) */
    bundleSource?: string;
    /** Memory limit in bytes (default: 256MB) */
    memoryLimit?: number;
    /** Stack size in bytes (default: 1MB) */
    maxStackSize?: number;
}

/** Result of compiling via QuickJS. */
export interface QuickJSCompileResult {
    ok: boolean;
    /** WASM bytes (only when ok === true) */
    wasm?: Uint8Array;
    errors: StructuredError[];
}

/**
 * Self-hosted Edict compiler running inside QuickJS-WASM.
 *
 * Supports two modes:
 * - **Check-only** (default): phases 1–3 — schema validation, name resolution,
 *   type checking, effect checking. Uses the lightweight check bundle (~365 KB).
 * - **Full compile**: phases 1–5 — check + WASM codegen via the pure-JS WASM
 *   encoder. Uses the full bundle (~860 KB). Create with `EdictQuickJS.createFull()`.
 *
 * Usage:
 *   const edict = await EdictQuickJS.createFull();
 *   const result = edict.compile({ kind: "module", ... });
 *   console.log(result.ok, result.wasm);
 *   edict.dispose();
 */
export class EdictQuickJS {
    private readonly rt: QuickJSRuntime;
    private readonly vm: QuickJSContext;
    private readonly hasCompile: boolean;
    private disposed = false;

    private constructor(rt: QuickJSRuntime, vm: QuickJSContext, hasCompile: boolean) {
        this.rt = rt;
        this.vm = vm;
        this.hasCompile = hasCompile;
    }

    /**
     * Create a new EdictQuickJS instance with check-only capability (phases 1-3).
     * Uses the lightweight check bundle.
     */
    static async create(options?: EdictQuickJSOptions): Promise<EdictQuickJS> {
        return EdictQuickJS._create(options, false);
    }

    /**
     * Create a new EdictQuickJS instance with full compile capability (phases 1-5).
     * Uses the full bundle with WASM codegen.
     */
    static async createFull(options?: EdictQuickJSOptions): Promise<EdictQuickJS> {
        const fullOptions = { ...options };
        if (!fullOptions.bundlePath && !fullOptions.bundleSource) {
            fullOptions.bundlePath = DEFAULT_FULL_BUNDLE_PATH;
        }
        return EdictQuickJS._create(fullOptions, true);
    }

    private static async _create(options: EdictQuickJSOptions | undefined, hasCompile: boolean): Promise<EdictQuickJS> {
        const bundlePath = options?.bundlePath ?? DEFAULT_CHECK_BUNDLE_PATH;
        const memoryLimit = options?.memoryLimit ?? 256 * 1024 * 1024;
        const maxStackSize = options?.maxStackSize ?? 1024 * 1024;

        const QuickJS: QuickJSWASMModule = await getQuickJS();
        const rt = QuickJS.newRuntime();
        rt.setMemoryLimit(memoryLimit);
        rt.setMaxStackSize(maxStackSize);

        const vm = rt.newContext();

        // Inject Web API polyfills
        const pfResult = vm.evalCode(POLYFILLS, "polyfills.js");
        if (pfResult.error) {
            const err = vm.dump(pfResult.error);
            pfResult.error.dispose();
            vm.dispose();
            rt.dispose();
            throw new Error(`Failed to inject polyfills: ${JSON.stringify(err)}`);
        }
        pfResult.value.dispose();

        // Load the IIFE compiler bundle
        const bundleSource = options?.bundleSource ?? readFileSync(bundlePath, "utf-8");
        const loadResult = vm.evalCode(bundleSource, "edict-bundle.js");
        if (loadResult.error) {
            const err = vm.dump(loadResult.error);
            loadResult.error.dispose();
            vm.dispose();
            rt.dispose();
            throw new Error(`Failed to load compiler bundle: ${JSON.stringify(err)}`);
        }
        loadResult.value.dispose();

        return new EdictQuickJS(rt, vm, hasCompile);
    }

    /**
     * Run the check pipeline (phases 1–3) on an Edict AST.
     * Returns structured result — never throws.
     */
    check(ast: unknown): CheckBrowserResult {
        if (this.disposed) {
            throw new Error("EdictQuickJS instance has been disposed");
        }

        const astJson = JSON.stringify(ast);
        // Use checkBrowserFull (phases 1-4 with built-in solver) when available
        // in the full bundle, otherwise fall back to checkBrowser (phases 1-3).
        const code = `JSON.stringify(
            typeof Edict.checkBrowserFull === 'function'
                ? Edict.checkBrowserFull(${astJson})
                : Edict.checkBrowser(${astJson})
        )`;
        const result = this.vm.evalCode(code, "check.js");

        if (result.error) {
            const err = this.vm.dump(result.error);
            result.error.dispose();
            const message = typeof err === "object" && err !== null && "message" in err
                ? (err as { message: string }).message
                : JSON.stringify(err);
            return {
                ok: false,
                errors: [quickjsRuntimeError(message)],
                module: null,
                typeInfo: null,
                diagnostics: [],
            };
        }

        const json = this.vm.getString(result.value);
        result.value.dispose();
        return JSON.parse(json) as CheckBrowserResult;
    }

    /**
     * Run the full compile pipeline (phases 1–5) on an Edict AST.
     * Returns WASM bytes on success, structured errors on failure.
     * Requires the full bundle — create with `EdictQuickJS.createFull()`.
     */
    compile(ast: unknown): QuickJSCompileResult {
        if (this.disposed) {
            throw new Error("EdictQuickJS instance has been disposed");
        }

        if (!this.hasCompile) {
            return {
                ok: false,
                errors: [quickjsRuntimeError(
                    "compile() requires the full bundle. Use EdictQuickJS.createFull() instead of EdictQuickJS.create().",
                )],
            };
        }

        const astJson = JSON.stringify(ast);
        // compileBrowser() returns { ok, wasm?: Uint8Array, errors, ... }.
        // Uint8Array doesn't serialize cleanly via JSON.stringify (becomes {"0":0,"1":97,...}).
        // Convert wasm to a regular Array inside QuickJS for clean serialization.
        const code = `(function() {
            var r = Edict.compileBrowser(${astJson});
            if (r.wasm) r.wasm = Array.from(r.wasm);
            return JSON.stringify({ ok: r.ok, wasm: r.wasm || null, errors: r.errors });
        })()`;
        const result = this.vm.evalCode(code, "compile.js");

        if (result.error) {
            const err = this.vm.dump(result.error);
            result.error.dispose();
            const message = typeof err === "object" && err !== null && "message" in err
                ? (err as { message: string }).message
                : JSON.stringify(err);
            return {
                ok: false,
                errors: [quickjsRuntimeError(message)],
            };
        }

        const json = this.vm.getString(result.value);
        result.value.dispose();
        const parsed = JSON.parse(json) as { ok: boolean; wasm: number[] | null; errors: StructuredError[] };

        return {
            ok: parsed.ok,
            wasm: parsed.wasm ? new Uint8Array(parsed.wasm) : undefined,
            errors: parsed.errors,
        };
    }

    /**
     * Dispose the QuickJS context and runtime.
     * Must be called when done to free WASM memory.
     */
    dispose(): void {
        if (!this.disposed) {
            this.vm.dispose();
            this.rt.dispose();
            this.disposed = true;
        }
    }
}
