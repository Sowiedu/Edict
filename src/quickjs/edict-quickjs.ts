// =============================================================================
// EdictQuickJS — Self-hosted check-only compiler in QuickJS-WASM
// =============================================================================
// Packages the check pipeline (phases 1–3) inside a QuickJS-WASM interpreter,
// providing a reusable API for running schema validation, name resolution,
// type checking, and effect checking in sandboxed/edge environments.
//
// This is the self-hosting PoC for issue #156. The compiler's IIFE bundle
// (dist/edict-quickjs-check.js) runs inside QuickJS-WASM with ~3.7x slowdown
// vs native Node.js.
//
// Usage:
//   const edict = await EdictQuickJS.create();
//   const result = edict.check(ast);  // CheckBrowserResult
//   edict.dispose();

import type { QuickJSWASMModule, QuickJSRuntime, QuickJSContext } from "quickjs-emscripten";
import { getQuickJS } from "quickjs-emscripten";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckBrowserResult } from "../browser.js";
import { quickjsRuntimeError } from "../errors/structured-errors.js";

// Path to the IIFE bundle — built by scripts/build-quickjs-bundle.ts
const DEFAULT_BUNDLE_PATH = resolve(
    import.meta.dirname ?? new URL(".", import.meta.url).pathname,
    "../../dist/edict-quickjs-check.js",
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

/**
 * Self-hosted Edict check-only compiler running inside QuickJS-WASM.
 *
 * Supports phases 1–3: schema validation, name resolution, type checking,
 * and effect checking. WASM codegen (binaryen) and contract verification (Z3)
 * are not available in this environment.
 *
 * Usage:
 *   const edict = await EdictQuickJS.create();
 *   const result = edict.check({ kind: "module", ... });
 *   console.log(result.ok, result.errors);
 *   edict.dispose();
 */
export class EdictQuickJS {
    private readonly rt: QuickJSRuntime;
    private readonly vm: QuickJSContext;
    private disposed = false;

    private constructor(rt: QuickJSRuntime, vm: QuickJSContext) {
        this.rt = rt;
        this.vm = vm;
    }

    /**
     * Create a new EdictQuickJS instance.
     * Initializes QuickJS-WASM, loads polyfills and the compiler bundle.
     */
    static async create(options?: EdictQuickJSOptions): Promise<EdictQuickJS> {
        const bundlePath = options?.bundlePath ?? DEFAULT_BUNDLE_PATH;
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

        return new EdictQuickJS(rt, vm);
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
        const code = `JSON.stringify(Edict.checkBrowser(${astJson}))`;
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
