// =============================================================================
// String Table — Linear memory string interning for WASM codegen
// =============================================================================
// Collects all string literals at compile time, deduplicates them, and
// produces binaryen MemorySegment entries for the data section.
//
// Memory format: each string is stored as [len:i32][data:bytes]
// The returned offset points to the length header.
// To read the string data, add 4 to the offset.

import binaryen from "binaryen";

export interface InternedString {
    /** Byte offset in linear memory (points to the 4-byte length header) */
    offset: number;
    /** Byte length (UTF-8) of the string data (NOT including the 4-byte header) */
    length: number;
}

export class StringTable {
    private strings: Map<string, InternedString> = new Map();
    private nextOffset: number;

    /**
     * @param baseOffset Starting byte offset in linear memory (default 0).
     *                   Reserve space for other data before strings if needed.
     */
    constructor(baseOffset: number = 0) {
        this.nextOffset = baseOffset;
    }

    /**
     * Intern a string. Returns the (offset, length) pair.
     * Deduplicates: identical strings share the same memory.
     * The offset points to the 4-byte length header; data starts at offset+4.
     */
    intern(str: string): InternedString {
        const existing = this.strings.get(str);
        if (existing) return existing;

        const encoded = new TextEncoder().encode(str);
        const entry: InternedString = {
            offset: this.nextOffset,
            length: encoded.length,
        };
        this.strings.set(str, entry);
        this.nextOffset += 4 + encoded.length; // 4-byte header + data
        return entry;
    }

    /**
     * Total bytes used by all interned strings (including length headers).
     */
    get totalBytes(): number {
        return this.nextOffset;
    }

    /**
     * Number of unique strings interned.
     */
    get size(): number {
        return this.strings.size;
    }

    /**
     * Produce binaryen MemorySegment[] for setMemory.
     * Each string gets its own segment: [len:i32][data:bytes].
     */
    toMemorySegments(mod: binaryen.Module): binaryen.MemorySegment[] {
        const segments: binaryen.MemorySegment[] = [];
        for (const [str, info] of this.strings) {
            const encoded = new TextEncoder().encode(str);
            // Build [len:i32 LE][data:bytes]
            const buf = new Uint8Array(4 + encoded.length);
            const view = new DataView(buf.buffer);
            view.setInt32(0, encoded.length, true); // little-endian length header
            buf.set(encoded, 4);
            segments.push({
                offset: mod.i32.const(info.offset),
                data: buf,
                passive: false,
            });
        }
        return segments;
    }
}
