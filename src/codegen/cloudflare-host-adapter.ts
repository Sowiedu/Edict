// =============================================================================
// Cloudflare Workers Host Adapter — edge runtime adapter for Workers environment
// =============================================================================
// Implements EdictHostAdapter for Cloudflare Workers:
//   Crypto: pure-JS (./pure-crypto.ts) — sync, no Web Crypto API needed
//   HTTP:   structured error (Workers fetch is async, unusable in sync host imports)
//   IO:    structured error (Workers KV is async)

import type { EdictHostAdapter } from "./host-adapter.js";
import { sha256Bytes, md5Bytes, hmacBytes, toHex } from "./pure-crypto.js";

const encoder = new TextEncoder();

/** Options for CloudflareHostAdapter construction. */
export interface CloudflareHostAdapterOptions {
    /** Workers environment bindings. Lookups return "" for missing keys. */
    envBindings?: Record<string, string>;
}

/**
 * Cloudflare Workers runtime adapter.
 *
 * - Crypto: pure-JS SHA-256, MD5, HMAC (synchronous, no Web Crypto API)
 * - HTTP: returns structured error (Workers fetch is async, incompatible with sync host imports)
 * - File IO: returns structured error (Workers KV is async)
 * - env: configurable via constructor envBindings
 *
 * This adapter is designed for use in generated Worker scripts where WASM
 * host imports must be synchronous. All async-only operations return
 * structured errors naming the constraint.
 */
export class CloudflareHostAdapter implements EdictHostAdapter {
    private readonly envBindings: Record<string, string>;

    constructor(options?: CloudflareHostAdapterOptions) {
        this.envBindings = options?.envBindings ?? {};
    }

    // ── Crypto ──────────────────────────────────────────────────────────

    sha256(data: string): string {
        return toHex(sha256Bytes(encoder.encode(data)));
    }

    md5(data: string): string {
        return toHex(md5Bytes(encoder.encode(data)));
    }

    hmac(algo: string, key: string, data: string): string {
        const result = hmacBytes(algo, encoder.encode(key), encoder.encode(data));
        return result ? toHex(result) : "";
    }

    // ── HTTP ────────────────────────────────────────────────────────────

    fetch(_url: string, _method: string, _body?: string): { ok: boolean; data: string } {
        // Workers fetch() is async — can't be called from synchronous WASM host imports.
        return { ok: false, data: "fetch_not_available_sync" };
    }

    // ── IO ──────────────────────────────────────────────────────────────

    readFile(_path: string): { ok: false; error: string } {
        // Workers KV is async — can't be called from synchronous WASM host imports.
        return { ok: false, error: "kv_not_available_sync" };
    }

    writeFile(_path: string, _content: string): { ok: false; error: string } {
        // Workers KV is async — can't be called from synchronous WASM host imports.
        return { ok: false, error: "kv_not_available_sync" };
    }

    env(name: string): string {
        return Object.hasOwn(this.envBindings, name) ? this.envBindings[name]! : "";
    }

    args(): string[] {
        return [];
    }

    exit(code: number): never {
        throw new Error(`edict_exit:${code}`);
    }
}
