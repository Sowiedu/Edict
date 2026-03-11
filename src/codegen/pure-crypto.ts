// =============================================================================
// Pure-JS Crypto — SHA-256, MD5, HMAC (no native dependencies)
// =============================================================================
// Synchronous, platform-agnostic implementations for use in environments
// where node:crypto is unavailable (browsers, edge runtimes).
//
// Standards:  SHA-256 (FIPS 180-4), MD5 (RFC 1321), HMAC (RFC 2104)
// All functions operate on Uint8Array and return Uint8Array.

// =============================================================================
// SHA-256 — FIPS 180-4
// =============================================================================

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

/** SHA-256 on raw bytes. Returns 32-byte Uint8Array. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
    // Pre-processing: pad to 512-bit blocks
    const bitLen = data.length * 8;
    const totalLen = data.length + 1 + 8;
    const paddedLen = Math.ceil(totalLen / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 4, bitLen, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);

    for (let offset = 0; offset < paddedLen; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
            const s1 = rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
            w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
        }

        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

        for (let i = 0; i < 64; i++) {
            const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) | 0;
            const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) | 0;

            h = g; g = f; f = e;
            e = (d + temp1) | 0;
            d = c; c = b; b = a;
            a = (temp1 + temp2) | 0;
        }

        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0;
        h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    const result = new Uint8Array(32);
    const rv = new DataView(result.buffer);
    rv.setUint32(0, h0, false);  rv.setUint32(4, h1, false);
    rv.setUint32(8, h2, false);  rv.setUint32(12, h3, false);
    rv.setUint32(16, h4, false); rv.setUint32(20, h5, false);
    rv.setUint32(24, h6, false); rv.setUint32(28, h7, false);
    return result;
}

// =============================================================================
// MD5 — RFC 1321
// =============================================================================

// Per-round shift amounts
const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// Pre-computed T[i] = floor(2^32 × abs(sin(i + 1)))
const MD5_T = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

/** MD5 on raw bytes. Returns 16-byte Uint8Array. */
export function md5Bytes(data: Uint8Array): Uint8Array {
    const bitLen = data.length * 8;
    const totalLen = data.length + 1 + 8;
    const paddedLen = Math.ceil(totalLen / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(data);
    padded[data.length] = 0x80;
    const pv = new DataView(padded.buffer);
    pv.setUint32(paddedLen - 8, bitLen, true); // little-endian

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < paddedLen; offset += 64) {
        const M = new Uint32Array(16);
        for (let j = 0; j < 16; j++) {
            M[j] = pv.getUint32(offset + j * 4, true);
        }

        let A = a0, B = b0, C = c0, D = d0;

        for (let i = 0; i < 64; i++) {
            let F: number, g: number;
            if (i < 16) {
                F = (B & C) | (~B & D); g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C); g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D; g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D); g = (7 * i) % 16;
            }

            F = (F + A + MD5_T[i]! + M[g]!) | 0;
            A = D; D = C; C = B;
            B = (B + ((F << MD5_S[i]!) | (F >>> (32 - MD5_S[i]!)))) | 0;
        }

        a0 = (a0 + A) | 0; b0 = (b0 + B) | 0;
        c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }

    const result = new Uint8Array(16);
    const rv = new DataView(result.buffer);
    rv.setUint32(0, a0, true);  rv.setUint32(4, b0, true);
    rv.setUint32(8, c0, true);  rv.setUint32(12, d0, true);
    return result;
}

// =============================================================================
// HMAC — RFC 2104
// =============================================================================

type HashFn = (data: Uint8Array) => Uint8Array;

/** Supported hash algorithms for HMAC. */
const HASH_ALGORITHMS: Record<string, { fn: HashFn; blockSize: number }> = {
    sha256: { fn: sha256Bytes, blockSize: 64 },
    md5:    { fn: md5Bytes,    blockSize: 64 },
};

/**
 * HMAC per RFC 2104.
 * Returns null for unsupported algorithms.
 */
export function hmacBytes(
    algo: string,
    key: Uint8Array,
    data: Uint8Array,
): Uint8Array | null {
    const alg = Object.hasOwn(HASH_ALGORITHMS, algo) ? HASH_ALGORITHMS[algo]! : null;
    if (!alg) return null;

    const { fn: hashFn, blockSize } = alg;

    // If key is longer than block size, hash it first
    const keyBlock = new Uint8Array(blockSize);
    keyBlock.set(key.length > blockSize ? hashFn(key) : key);

    // XOR key with ipad (0x36) and opad (0x5c)
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
        ipad[i] = keyBlock[i]! ^ 0x36;
        opad[i] = keyBlock[i]! ^ 0x5c;
    }

    // inner = hash(ipad || data)
    const inner = new Uint8Array(blockSize + data.length);
    inner.set(ipad);
    inner.set(data, blockSize);
    const innerHash = hashFn(inner);

    // outer = hash(opad || innerHash)
    const outer = new Uint8Array(blockSize + innerHash.length);
    outer.set(opad);
    outer.set(innerHash, blockSize);
    return hashFn(outer);
}

// =============================================================================
// Utilities
// =============================================================================

/** Convert Uint8Array to lowercase hex string. */
export function toHex(bytes: Uint8Array): string {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
        hex += (bytes[i]! < 16 ? "0" : "") + bytes[i]!.toString(16);
    }
    return hex;
}
