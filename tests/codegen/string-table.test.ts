import { describe, it, expect } from "vitest";
import { StringTable } from "../../src/codegen/string-table.js";
import binaryen from "binaryen";

describe("StringTable", () => {
    it("interns a string with correct offset and length", () => {
        const table = new StringTable();
        const result = table.intern("hello");

        expect(result.offset).toBe(0);
        expect(result.length).toBe(5); // "hello" = 5 UTF-8 bytes
        expect(table.totalBytes).toBe(9); // 4-byte header + 5 data bytes
        expect(table.size).toBe(1);
    });

    it("deduplicates identical strings", () => {
        const table = new StringTable();
        const first = table.intern("hello");
        const second = table.intern("hello");

        expect(first).toBe(second); // same reference
        expect(table.size).toBe(1);
        expect(table.totalBytes).toBe(9); // 4 + 5
    });

    it("assigns sequential offsets for different strings", () => {
        const table = new StringTable();
        const a = table.intern("abc"); // [4-byte header + 3 data] = 7 bytes at offset 0
        const b = table.intern("xyz"); // [4-byte header + 3 data] = 7 bytes at offset 7

        expect(a.offset).toBe(0);
        expect(a.length).toBe(3);
        expect(b.offset).toBe(7);  // 4 + 3 = 7
        expect(b.length).toBe(3);
        expect(table.totalBytes).toBe(14); // 7 + 7
        expect(table.size).toBe(2);
    });

    it("handles multi-byte UTF-8 strings correctly", () => {
        const table = new StringTable();
        const result = table.intern("héllo"); // é = 2 bytes in UTF-8

        expect(result.offset).toBe(0);
        expect(result.length).toBe(6); // h(1) + é(2) + l(1) + l(1) + o(1)
        expect(table.totalBytes).toBe(10); // 4-byte header + 6 data bytes
    });

    it("handles empty string", () => {
        const table = new StringTable();
        const result = table.intern("");

        expect(result.offset).toBe(0);
        expect(result.length).toBe(0);
        expect(table.totalBytes).toBe(4); // 4-byte header, 0 data bytes
        expect(table.size).toBe(1);
    });

    it("respects baseOffset constructor parameter", () => {
        const table = new StringTable(100);
        const result = table.intern("hi");

        expect(result.offset).toBe(100);
        expect(result.length).toBe(2);
        expect(table.totalBytes).toBe(106); // 100 base + 4 header + 2 data
    });

    it("generates correct memory segments", () => {
        const mod = new binaryen.Module();
        const table = new StringTable();
        table.intern("abc");
        table.intern("xyz");

        const segments = table.toMemorySegments(mod);
        expect(segments).toHaveLength(2);

        // First segment: [len=3, "abc"] at offset 0
        const expected0 = new Uint8Array([3, 0, 0, 0, 97, 98, 99]); // LE i32(3) + "abc"
        expect(segments[0]!.data).toEqual(expected0);
        expect(segments[0]!.passive).toBe(false);

        // Second segment: [len=3, "xyz"] at offset 7
        const expected1 = new Uint8Array([3, 0, 0, 0, 120, 121, 122]); // LE i32(3) + "xyz"
        expect(segments[1]!.data).toEqual(expected1);
        expect(segments[1]!.passive).toBe(false);

        mod.dispose();
    });
});
