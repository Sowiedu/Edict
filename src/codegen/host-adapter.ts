// =============================================================================
// Host Adapter Interface — pluggable platform-specific operations
// =============================================================================
// Defines the contract that platform-specific adapters must implement.
// Only operations that require platform-specific APIs are included here.
// Platform-agnostic operations (string, math, array, etc.) use Web Standard
// APIs and are handled directly in host-functions.ts.

/**
 * Platform-specific host operations that vary across runtimes.
 *
 * Implementations exist for:
 * - Node.js (`NodeHostAdapter`) — full-featured, uses node:crypto, node:fs, etc.
 * - Browser (`BrowserHostAdapter`) — pure-JS crypto, sync XHR, sandboxed IO
 *
 * All methods are synchronous — called from WASM host import callbacks.
 * All methods operate on plain JS types — no WASM pointers or RuntimeState.
 */
export interface EdictHostAdapter {
    // ── Crypto ──────────────────────────────────────────────────────────
    /** SHA-256 hash of `data`, returned as hex string. */
    sha256(data: string): string;
    /** MD5 hash of `data`, returned as hex string. */
    md5(data: string): string;
    /** HMAC of `data` using `algo` and `key`, returned as hex string. */
    hmac(algo: string, key: string, data: string): string;

    // ── HTTP ────────────────────────────────────────────────────────────
    /** Synchronous HTTP request. Returns ok=true for 2xx, ok=false for errors. */
    fetch(url: string, method: string, body?: string): { ok: boolean; data: string };

    // ── IO ──────────────────────────────────────────────────────────────
    /** Read a file, returning its content or an error. */
    readFile(path: string): { ok: true; data: string } | { ok: false; error: string };
    /** Write content to a file, returning success or an error. */
    writeFile(path: string, content: string): { ok: true } | { ok: false; error: string };
    /** Read an environment variable. Returns "" if not set. */
    env(name: string): string;
    /** Return command-line arguments (excluding runtime and script path). */
    args(): string[];
    /** Terminate execution with the given exit code. */
    exit(code: number): never;
}
