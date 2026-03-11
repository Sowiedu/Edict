// =============================================================================
// Browser Host Adapter — functional browser/edge runtime adapter
// =============================================================================
// Implements EdictHostAdapter using browser-compatible APIs:
//   Crypto: pure-JS (./pure-crypto.ts) — sync, no Web Crypto API needed
//   HTTP:   sync XMLHttpRequest (deprecated but functional in main thread)
//   IO:    structured errors (no filesystem in browser)

import type { EdictHostAdapter } from "./host-adapter.js";
import { sha256Bytes, md5Bytes, hmacBytes, toHex } from "./pure-crypto.js";

// Minimal XMLHttpRequest type for browser environments.
// TypeScript is configured for Node (no DOM lib), so we declare just
// the surface area needed by the sync fetch implementation.
declare class XMLHttpRequest {
    open(method: string, url: string, async: boolean): void;
    setRequestHeader(name: string, value: string): void;
    send(body?: string | null): void;
    readonly status: number;
    readonly responseText: string;
}

const encoder = new TextEncoder();

/** Max response body size (1 MB) — matches NodeHostAdapter. */
const HTTP_MAX_RESPONSE_BYTES = 1_048_576;

/** Options for BrowserHostAdapter construction. */
export interface BrowserHostAdapterOptions {
    /** Environment variable map. Lookups return "" for missing keys. */
    envMap?: Record<string, string>;
}

/**
 * Browser/edge runtime adapter with functional crypto and optional HTTP.
 *
 * - Crypto: pure-JS SHA-256, MD5, HMAC (synchronous, no Web Crypto API)
 * - HTTP: sync XMLHttpRequest (deprecated but functional in main thread)
 * - File IO: returns structured errors (no filesystem in browser)
 * - env: configurable via constructor envMap
 */
export class BrowserHostAdapter implements EdictHostAdapter {
    private readonly envMap: Record<string, string>;

    constructor(options?: BrowserHostAdapterOptions) {
        this.envMap = options?.envMap ?? {};
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

    fetch(url: string, method: string, body?: string): { ok: boolean; data: string } {
        if (typeof XMLHttpRequest === "undefined") {
            return { ok: false, data: "sync_xhr_not_available" };
        }

        try {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url, false);
            if (body !== undefined && body !== "") {
                xhr.setRequestHeader("Content-Type", "application/json");
            }
            xhr.send(body || null);

            let responseText = xhr.responseText;
            if (responseText.length > HTTP_MAX_RESPONSE_BYTES) {
                responseText = responseText.slice(0, HTTP_MAX_RESPONSE_BYTES);
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                return { ok: true, data: responseText };
            }
            return { ok: false, data: xhr.status + " " + responseText };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, data: msg };
        }
    }

    // ── IO ──────────────────────────────────────────────────────────────

    readFile(_path: string): { ok: false; error: string } {
        return { ok: false, error: "filesystem_not_available" };
    }

    writeFile(_path: string, _content: string): { ok: false; error: string } {
        return { ok: false, error: "filesystem_not_available" };
    }

    env(name: string): string {
        return Object.hasOwn(this.envMap, name) ? this.envMap[name]! : "";
    }

    args(): string[] {
        return [];
    }

    exit(code: number): never {
        throw new Error(`edict_exit:${code}`);
    }
}
