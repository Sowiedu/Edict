// =============================================================================
// String Table — Linear memory string interning for WASM codegen
// =============================================================================
// Collects all string literals at compile time, deduplicates them, and
// produces binaryen MemorySegment entries for the data section.

import binaryen from "binaryen";

export interface InternedString {
    /** Byte offset in linear memory */
    offset: number;
    /** Byte length (UTF-8) */
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
        this.nextOffset += encoded.length;
        return entry;
    }

    /**
     * Total bytes used by all interned strings.
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
     * Each string gets its own segment at a fixed offset.
     */
    toMemorySegments(mod: binaryen.Module): binaryen.MemorySegment[] {
        const segments: binaryen.MemorySegment[] = [];
        for (const [str, info] of this.strings) {
            const data = new TextEncoder().encode(str);
            segments.push({
                offset: mod.i32.const(info.offset),
                data,
                passive: false,
            });
        }
        return segments;
    }
}
