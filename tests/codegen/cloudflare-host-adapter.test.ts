// =============================================================================
// CloudflareHostAdapter Tests — verify crypto, fetch, and IO implementations
// =============================================================================

import { describe, it, expect } from "vitest";
import { CloudflareHostAdapter } from "../../src/codegen/cloudflare-host-adapter.js";

// ---------------------------------------------------------------------------
// Fixtures — known test vectors from NIST / RFCs
// ---------------------------------------------------------------------------

// SHA-256 test vectors (FIPS 180-4)
const SHA256_VECTORS: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["hello", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
     "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
];

// MD5 test vectors (RFC 1321)
const MD5_VECTORS: [string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
];

// HMAC-SHA256 test vectors (RFC 4231, Test Case 2)
const HMAC_SHA256_VECTORS: { key: string; data: string; expected: string }[] = [
    {
        key: "Jefe",
        data: "what do ya want for nothing?",
        expected: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    },
];

// HMAC-MD5 test vectors (RFC 2104)
const HMAC_MD5_VECTORS: { key: string; data: string; expected: string }[] = [
    {
        key: "Jefe",
        data: "what do ya want for nothing?",
        expected: "750c783e6ab0b503eaa86e310a5db738",
    },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CloudflareHostAdapter: sha256", () => {
    const adapter = new CloudflareHostAdapter();

    for (const [input, expected] of SHA256_VECTORS) {
        it(`sha256("${input.slice(0, 30)}${input.length > 30 ? "..." : ""}")`, () => {
            expect(adapter.sha256(input)).toBe(expected);
        });
    }

    it("handles unicode input (UTF-8 encoding)", () => {
        const result = adapter.sha256("café");
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("CloudflareHostAdapter: md5", () => {
    const adapter = new CloudflareHostAdapter();

    for (const [input, expected] of MD5_VECTORS) {
        it(`md5("${input.slice(0, 30)}${input.length > 30 ? "..." : ""}")`, () => {
            expect(adapter.md5(input)).toBe(expected);
        });
    }
});

describe("CloudflareHostAdapter: hmac", () => {
    const adapter = new CloudflareHostAdapter();

    for (const { key, data, expected } of HMAC_SHA256_VECTORS) {
        it(`hmac("sha256", "${key}", "${data.slice(0, 20)}...")`, () => {
            expect(adapter.hmac("sha256", key, data)).toBe(expected);
        });
    }

    for (const { key, data, expected } of HMAC_MD5_VECTORS) {
        it(`hmac("md5", "${key}", "${data.slice(0, 20)}...")`, () => {
            expect(adapter.hmac("md5", key, data)).toBe(expected);
        });
    }

    it("returns empty string for unsupported algorithm", () => {
        expect(adapter.hmac("sha512", "key", "data")).toBe("");
        expect(adapter.hmac("unknown", "key", "data")).toBe("");
    });
});

describe("CloudflareHostAdapter: fetch", () => {
    const adapter = new CloudflareHostAdapter();

    it("returns fetch_not_available_sync error", () => {
        const result = adapter.fetch("https://example.com", "GET");
        expect(result.ok).toBe(false);
        expect(result.data).toBe("fetch_not_available_sync");
    });

    it("returns same error regardless of method or body", () => {
        const post = adapter.fetch("https://example.com", "POST", '{"key":"val"}');
        expect(post.ok).toBe(false);
        expect(post.data).toBe("fetch_not_available_sync");
    });
});

describe("CloudflareHostAdapter: readFile", () => {
    const adapter = new CloudflareHostAdapter();

    it("returns kv_not_available_sync error", () => {
        const result = adapter.readFile("/some/path");
        expect(result.ok).toBe(false);
        expect(result).toEqual({ ok: false, error: "kv_not_available_sync" });
    });
});

describe("CloudflareHostAdapter: writeFile", () => {
    const adapter = new CloudflareHostAdapter();

    it("returns kv_not_available_sync error", () => {
        const result = adapter.writeFile("/some/path", "content");
        expect(result.ok).toBe(false);
        expect(result).toEqual({ ok: false, error: "kv_not_available_sync" });
    });
});

describe("CloudflareHostAdapter: env", () => {
    it("returns empty string with no envBindings", () => {
        const adapter = new CloudflareHostAdapter();
        expect(adapter.env("HOME")).toBe("");
        expect(adapter.env("PATH")).toBe("");
    });

    it("returns configured values from envBindings", () => {
        const adapter = new CloudflareHostAdapter({
            envBindings: { API_KEY: "abc123", MODE: "production" },
        });
        expect(adapter.env("API_KEY")).toBe("abc123");
        expect(adapter.env("MODE")).toBe("production");
        expect(adapter.env("MISSING")).toBe("");
    });

    it("is prototype-safe (constructor, toString, __proto__)", () => {
        const adapter = new CloudflareHostAdapter();
        expect(adapter.env("constructor")).toBe("");
        expect(adapter.env("toString")).toBe("");
        expect(adapter.env("__proto__")).toBe("");
    });
});

describe("CloudflareHostAdapter: args", () => {
    const adapter = new CloudflareHostAdapter();

    it("returns empty array", () => {
        expect(adapter.args()).toEqual([]);
    });
});

describe("CloudflareHostAdapter: exit", () => {
    const adapter = new CloudflareHostAdapter();

    it("throws edict_exit error with code", () => {
        expect(() => adapter.exit(0)).toThrow("edict_exit:0");
        expect(() => adapter.exit(1)).toThrow("edict_exit:1");
        expect(() => adapter.exit(42)).toThrow("edict_exit:42");
    });
});

// ---------------------------------------------------------------------------
// Cross-verification: CloudflareHostAdapter crypto matches Node and Browser
// ---------------------------------------------------------------------------

describe("CloudflareHostAdapter: cross-verification with other adapters", () => {
    it("sha256 matches NodeHostAdapter", async () => {
        const { NodeHostAdapter } = await import("../../src/codegen/node-host-adapter.js");
        const cf = new CloudflareHostAdapter();
        const node = new NodeHostAdapter();

        const testCases = ["", "hello", "test data", "café", "🚀"];
        for (const input of testCases) {
            expect(cf.sha256(input)).toBe(node.sha256(input));
        }
    });

    it("md5 matches NodeHostAdapter", async () => {
        const { NodeHostAdapter } = await import("../../src/codegen/node-host-adapter.js");
        const cf = new CloudflareHostAdapter();
        const node = new NodeHostAdapter();

        const testCases = ["", "hello", "test data", "café", "🚀"];
        for (const input of testCases) {
            expect(cf.md5(input)).toBe(node.md5(input));
        }
    });

    it("hmac sha256 matches NodeHostAdapter", async () => {
        const { NodeHostAdapter } = await import("../../src/codegen/node-host-adapter.js");
        const cf = new CloudflareHostAdapter();
        const node = new NodeHostAdapter();

        expect(cf.hmac("sha256", "key", "data")).toBe(node.hmac("sha256", "key", "data"));
        expect(cf.hmac("sha256", "secret", "message")).toBe(node.hmac("sha256", "secret", "message"));
    });

    it("sha256 matches BrowserHostAdapter", async () => {
        const { BrowserHostAdapter } = await import("../../src/codegen/browser-host-adapter.js");
        const cf = new CloudflareHostAdapter();
        const browser = new BrowserHostAdapter();

        const testCases = ["", "hello", "test data"];
        for (const input of testCases) {
            expect(cf.sha256(input)).toBe(browser.sha256(input));
        }
    });
});
