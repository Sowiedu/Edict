// =============================================================================
// Host Helpers — shared WASM memory utilities for builtin domain factories
// =============================================================================
// Extracted from host-functions.ts. These helpers are used by domain factory
// functions to interact with WASM linear memory (read/write strings, arrays,
// Result values, allocate heap space).

import type { EdictHostAdapter } from "../codegen/host-adapter.js";

// =============================================================================
// Shared runtime state — passed between host functions via closure
// =============================================================================

/** Mutable runtime state shared by all host functions during one execution. */
export interface RuntimeState {
    /** Captured stdout output parts. */
    outputParts: string[];
    /** Late-bound WASM instance — set after instantiation. */
    instance: WasmInstance | null;
    /** Optional sandbox directory for file IO. If unset, readFile/writeFile return Err. */
    sandboxDir?: string;
}

interface WasmInstance {
    readonly exports: {
        [key: string]: unknown;
        memory?: { readonly buffer: ArrayBuffer };
    };
}

/** Typed error thrown when a host-side heap allocation exceeds WASM memory bounds. */
export class EdictOomError extends Error {
    constructor(public heapUsed: number, public heapLimit: number) {
        super("edict_oom: heap exhausted");
    }
}

// =============================================================================
// Host context — unified context passed to domain factory functions
// =============================================================================

/**
 * Context passed to every host builtin factory function.
 * Bundles state, adapter, and shared encoder/decoder so each domain
 * doesn't need to create its own or take a different arg signature.
 */
export interface HostContext {
    state: RuntimeState;
    adapter: EdictHostAdapter;
    encoder: TextEncoder;
    decoder: TextDecoder;
}

// =============================================================================
// Memory helpers
// =============================================================================

export function getMemoryBuffer(state: RuntimeState): ArrayBuffer {
    return (state.instance!.exports.memory as { buffer: ArrayBuffer }).buffer;
}

/**
 * Centralized heap allocator with bounds checking.
 * Allocates `size` bytes (8-byte aligned) from the bump allocator,
 * throwing EdictOomError if the allocation would exceed WASM memory.
 */
export function allocateHeap(state: RuntimeState, size: number): number {
    const getHeapPtr = state.instance!.exports.__get_heap_ptr as () => number;
    const setHeapPtr = state.instance!.exports.__set_heap_ptr as (v: number) => void;
    const ptr = getHeapPtr();
    const aligned = Math.ceil(size / 8) * 8;
    const newPtr = ptr + aligned;
    const memorySize = getMemoryBuffer(state).byteLength;
    if (newPtr > memorySize) {
        throw new EdictOomError(ptr, memorySize);
    }
    setHeapPtr(newPtr);
    return ptr;
}

/**
 * Read a length-prefixed string from WASM memory.
 * Memory format: [len:i32][data:bytes] at the given pointer.
 * Returns the decoded JS string.
 */
export function readString(state: RuntimeState, ptr: number, decoder: TextDecoder): string {
    const buf = getMemoryBuffer(state);
    const view = new DataView(buf);
    const len = view.getInt32(ptr, true); // little-endian
    const bytes = new Uint8Array(buf, ptr + 4, len);
    return decoder.decode(bytes);
}

/**
 * Write a string result into WASM memory as length-prefixed format:
 * [len:i32][data:bytes]. Advances __heap_ptr (8-byte aligned).
 * Returns ptr to the length header.
 */
export function writeStringResult(state: RuntimeState, str: string, encoder: TextEncoder): number {
    const encoded = encoder.encode(str);
    const totalSize = 4 + encoded.length; // 4-byte header + data
    const resultPtr = allocateHeap(state, totalSize);
    const buf = getMemoryBuffer(state);
    const view = new DataView(buf);
    view.setInt32(resultPtr, encoded.length, true); // write length header
    const dest = new Uint8Array(buf, resultPtr + 4, encoded.length);
    dest.set(encoded);
    return resultPtr;
}

/**
 * Allocate a new array on the WASM heap: [length: i32][elem0: i32]...
 * Advances __heap_ptr (8-byte aligned) and returns the new array pointer.
 */
export function writeArrayResult(state: RuntimeState, elements: number[]): number {
    const totalSize = 4 + elements.length * 4; // header + elements
    const resultPtr = allocateHeap(state, totalSize);
    const view = new DataView(getMemoryBuffer(state));
    view.setInt32(resultPtr, elements.length, true); // write length
    for (let i = 0; i < elements.length; i++) {
        view.setInt32(resultPtr + 4 + i * 4, elements[i]!, true);
    }
    return resultPtr;
}

/**
 * Allocate a Result value on the WASM heap: [tag: i32][pad(4)][value: i32][pad(4)]
 * tag=0 means Ok, tag=1 means Err. Total size = 16 bytes (matches enum layout).
 * Returns the pointer to the Result pair.
 */
export function writeResultValue(state: RuntimeState, tag: number, value: number): number {
    const ptr = allocateHeap(state, 16);
    const view = new DataView(getMemoryBuffer(state));
    view.setInt32(ptr, tag, true);      // tag at offset 0
    view.setInt32(ptr + 8, value, true); // value at offset 8 (matches EnumVariantLayout)
    return ptr;
}

/**
 * Format a Date using strftime-style tokens.
 * Supported: %Y (year), %m (month 01-12), %d (day 01-31),
 *            %H (hour 00-23), %M (min 00-59), %S (sec 00-59), %% (literal %)
 */
export function formatDateString(date: Date, fmt: string): string {
    const pad2 = (n: number): string => String(n).padStart(2, "0");
    let result = "";
    let i = 0;
    while (i < fmt.length) {
        if (fmt[i] === "%" && i + 1 < fmt.length) {
            const token = fmt[i + 1];
            switch (token) {
                case "Y": result += String(date.getUTCFullYear()); break;
                case "m": result += pad2(date.getUTCMonth() + 1); break;
                case "d": result += pad2(date.getUTCDate()); break;
                case "H": result += pad2(date.getUTCHours()); break;
                case "M": result += pad2(date.getUTCMinutes()); break;
                case "S": result += pad2(date.getUTCSeconds()); break;
                case "%": result += "%"; break;
                default: result += "%" + token; break; // unknown token → pass through
            }
            i += 2;
        } else {
            result += fmt[i];
            i++;
        }
    }
    return result;
}
