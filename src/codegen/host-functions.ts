// =============================================================================
// Host Function Imports — WASM ↔ Host bridge for Edict runtime
// =============================================================================
// All host functions that WASM modules import are defined here.
// The runner calls `createHostImports()` and passes the result as the
// import object to `WebAssembly.instantiate()`.
//
// Groups: print, string ops, math, type conversions, arrays, Option, Result.

// =============================================================================
// Shared runtime state — passed between host functions via closure
// =============================================================================

/** Mutable runtime state shared by all host functions during one execution. */
export interface RuntimeState {
    /** Captured stdout output parts. */
    outputParts: string[];
    /** Late-bound WASM instance — set after instantiation. */
    instance: WasmInstance | null;
}

interface WasmInstance {
    readonly exports: {
        [key: string]: unknown;
        memory?: { readonly buffer: ArrayBuffer };
    };
}

// =============================================================================
// Memory helpers
// =============================================================================

function getMemoryBuffer(state: RuntimeState): ArrayBuffer {
    return (state.instance!.exports.memory as { buffer: ArrayBuffer }).buffer;
}

/**
 * Write a string result into WASM memory at __heap_ptr,
 * advance __heap_ptr (8-byte aligned), set __str_ret_len, and return ptr.
 */
function writeStringResult(state: RuntimeState, str: string, encoder: TextEncoder): number {
    const encoded = encoder.encode(str);
    const memoryBuffer = getMemoryBuffer(state);
    const getHeapPtr = state.instance!.exports.__get_heap_ptr as () => number;
    const setHeapPtr = state.instance!.exports.__set_heap_ptr as (v: number) => void;
    const setStrRetLen = state.instance!.exports.__set_str_ret_len as (v: number) => void;

    const resultPtr = getHeapPtr();
    const dest = new Uint8Array(memoryBuffer, resultPtr, encoded.length);
    dest.set(encoded);
    setHeapPtr(resultPtr + Math.ceil(encoded.length / 8) * 8);
    setStrRetLen(encoded.length);
    return resultPtr;
}

/**
 * Allocate a new array on the WASM heap: [length: i32][elem0: i32]...
 * Advances __heap_ptr (8-byte aligned) and returns the new array pointer.
 */
function writeArrayResult(state: RuntimeState, elements: number[]): number {
    const memoryBuffer = getMemoryBuffer(state);
    const getHeapPtr = state.instance!.exports.__get_heap_ptr as () => number;
    const setHeapPtr = state.instance!.exports.__set_heap_ptr as (v: number) => void;

    const totalSize = 4 + elements.length * 4; // header + elements
    const resultPtr = getHeapPtr();
    const view = new DataView(memoryBuffer);
    view.setInt32(resultPtr, elements.length, true); // write length
    for (let i = 0; i < elements.length; i++) {
        view.setInt32(resultPtr + 4 + i * 4, elements[i]!, true);
    }
    setHeapPtr(resultPtr + Math.ceil(totalSize / 8) * 8);
    return resultPtr;
}

/**
 * Allocate a Result value on the WASM heap: [tag: i32][pad(4)][value: i32][pad(4)]
 * tag=0 means Ok, tag=1 means Err. Total size = 16 bytes (matches enum layout).
 * Returns the pointer to the Result pair.
 */
function writeResultValue(state: RuntimeState, tag: number, value: number): number {
    const memoryBuffer = getMemoryBuffer(state);
    const getHeapPtr = state.instance!.exports.__get_heap_ptr as () => number;
    const setHeapPtr = state.instance!.exports.__set_heap_ptr as (v: number) => void;

    const ptr = getHeapPtr();
    const view = new DataView(memoryBuffer);
    view.setInt32(ptr, tag, true);      // tag at offset 0
    view.setInt32(ptr + 8, value, true); // value at offset 8 (matches EnumVariantLayout)
    setHeapPtr(ptr + 16);               // 16 bytes total
    return ptr;
}

// =============================================================================
// Core host functions (print, string_replace)
// =============================================================================

function createCoreImports(state: RuntimeState): Record<string, Function> {
    return {
        print: (ptr: number, len: number): number => {
            const bytes = new Uint8Array(getMemoryBuffer(state), ptr, len);
            const text = new TextDecoder().decode(bytes);
            state.outputParts.push(text);
            return ptr;
        },
        string_replace: (
            hayPtr: number, hayLen: number,
            needlePtr: number, needleLen: number,
            replPtr: number, replLen: number,
        ): number => {
            const memoryBuffer = getMemoryBuffer(state);
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const haystack = decoder.decode(new Uint8Array(memoryBuffer, hayPtr, hayLen));
            const needle = decoder.decode(new Uint8Array(memoryBuffer, needlePtr, needleLen));
            const replacement = decoder.decode(new Uint8Array(memoryBuffer, replPtr, replLen));
            return writeStringResult(state, haystack.replaceAll(needle, replacement), encoder);
        },
    };
}

// =============================================================================
// String builtins
// =============================================================================

function createStringImports(state: RuntimeState): Record<string, Function> {
    return {
        string_length: (ptr: number, len: number): number => {
            const str = new TextDecoder().decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            return str.length;
        },
        substring: (ptr: number, len: number, start: number, end: number): number => {
            const str = new TextDecoder().decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            return writeStringResult(state, str.substring(start, end), new TextEncoder());
        },
        string_concat: (aPtr: number, aLen: number, bPtr: number, bLen: number): number => {
            const decoder = new TextDecoder();
            const buf = getMemoryBuffer(state);
            const a = decoder.decode(new Uint8Array(buf, aPtr, aLen));
            const b = decoder.decode(new Uint8Array(buf, bPtr, bLen));
            return writeStringResult(state, a + b, new TextEncoder());
        },
        string_indexOf: (hayPtr: number, hayLen: number, needlePtr: number, needleLen: number): number => {
            const decoder = new TextDecoder();
            const buf = getMemoryBuffer(state);
            const haystack = decoder.decode(new Uint8Array(buf, hayPtr, hayLen));
            const needle = decoder.decode(new Uint8Array(buf, needlePtr, needleLen));
            return haystack.indexOf(needle);
        },
        toUpperCase: (ptr: number, len: number): number => {
            const str = new TextDecoder().decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            return writeStringResult(state, str.toUpperCase(), new TextEncoder());
        },
        toLowerCase: (ptr: number, len: number): number => {
            const str = new TextDecoder().decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            return writeStringResult(state, str.toLowerCase(), new TextEncoder());
        },
        string_trim: (ptr: number, len: number): number => {
            const str = new TextDecoder().decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            return writeStringResult(state, str.trim(), new TextEncoder());
        },
        string_startsWith: (strPtr: number, strLen: number, prefixPtr: number, prefixLen: number): number => {
            const decoder = new TextDecoder();
            const buf = getMemoryBuffer(state);
            const str = decoder.decode(new Uint8Array(buf, strPtr, strLen));
            const prefix = decoder.decode(new Uint8Array(buf, prefixPtr, prefixLen));
            return str.startsWith(prefix) ? 1 : 0;
        },
        string_endsWith: (strPtr: number, strLen: number, suffixPtr: number, suffixLen: number): number => {
            const decoder = new TextDecoder();
            const buf = getMemoryBuffer(state);
            const str = decoder.decode(new Uint8Array(buf, strPtr, strLen));
            const suffix = decoder.decode(new Uint8Array(buf, suffixPtr, suffixLen));
            return str.endsWith(suffix) ? 1 : 0;
        },
        string_contains: (hayPtr: number, hayLen: number, needlePtr: number, needleLen: number): number => {
            const decoder = new TextDecoder();
            const buf = getMemoryBuffer(state);
            const haystack = decoder.decode(new Uint8Array(buf, hayPtr, hayLen));
            const needle = decoder.decode(new Uint8Array(buf, needlePtr, needleLen));
            return haystack.includes(needle) ? 1 : 0;
        },
        string_repeat: (ptr: number, len: number, count: number): number => {
            const str = new TextDecoder().decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            return writeStringResult(state, str.repeat(count), new TextEncoder());
        },
    };
}

// =============================================================================
// Math builtins
// =============================================================================

function createMathImports(): Record<string, Function> {
    return {
        abs: (x: number): number => Math.abs(x),
        min: (a: number, b: number): number => Math.min(a, b),
        max: (a: number, b: number): number => Math.max(a, b),
        pow: (base: number, exp: number): number => (Math.pow(base, exp) | 0),
        sqrt: (x: number): number => Math.sqrt(x),
        floor: (x: number): number => (Math.floor(x) | 0),
        ceil: (x: number): number => (Math.ceil(x) | 0),
        round: (x: number): number => (Math.round(x) | 0),
    };
}

// =============================================================================
// Type conversion builtins
// =============================================================================

function createTypeConversionImports(state: RuntimeState): Record<string, Function> {
    return {
        intToString: (value: number): number => writeStringResult(state, String(value), new TextEncoder()),
        floatToString: (value: number): number => writeStringResult(state, String(value), new TextEncoder()),
        boolToString: (value: number): number => writeStringResult(state, value ? "true" : "false", new TextEncoder()),
        floatToInt: (value: number): number => (Math.trunc(value) | 0),
        intToFloat: (value: number): number => value,
    };
}

// =============================================================================
// Array builtins — operate on [length: i32][elem0: i32][elem1: i32]...
// =============================================================================

function createArrayImports(state: RuntimeState): Record<string, Function> {
    return {
        array_length: (arrPtr: number): number => {
            return new DataView(getMemoryBuffer(state)).getInt32(arrPtr, true);
        },
        array_get: (arrPtr: number, index: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            if (index < 0 || index >= length) return 0;
            return view.getInt32(arrPtr + 4 + index * 4, true);
        },
        array_set: (arrPtr: number, index: number, value: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            const elems: number[] = [];
            for (let i = 0; i < length; i++) {
                elems.push(i === index ? value : view.getInt32(arrPtr + 4 + i * 4, true));
            }
            return writeArrayResult(state, elems);
        },
        array_push: (arrPtr: number, value: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            const elems: number[] = [];
            for (let i = 0; i < length; i++) {
                elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
            }
            elems.push(value);
            return writeArrayResult(state, elems);
        },
        array_pop: (arrPtr: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            if (length === 0) return writeArrayResult(state, []);
            const elems: number[] = [];
            for (let i = 0; i < length - 1; i++) {
                elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
            }
            return writeArrayResult(state, elems);
        },
        array_concat: (aPtr: number, bPtr: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const aLen = view.getInt32(aPtr, true);
            const bLen = view.getInt32(bPtr, true);
            const elems: number[] = [];
            for (let i = 0; i < aLen; i++) {
                elems.push(view.getInt32(aPtr + 4 + i * 4, true));
            }
            for (let i = 0; i < bLen; i++) {
                elems.push(view.getInt32(bPtr + 4 + i * 4, true));
            }
            return writeArrayResult(state, elems);
        },
        array_slice: (arrPtr: number, start: number, end: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            const s = Math.max(0, Math.min(start, length));
            const e = Math.max(s, Math.min(end, length));
            const elems: number[] = [];
            for (let i = s; i < e; i++) {
                elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
            }
            return writeArrayResult(state, elems);
        },
        array_isEmpty: (arrPtr: number): number => {
            return new DataView(getMemoryBuffer(state)).getInt32(arrPtr, true) === 0 ? 1 : 0;
        },
        array_contains: (arrPtr: number, value: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            for (let i = 0; i < length; i++) {
                if (view.getInt32(arrPtr + 4 + i * 4, true) === value) return 1;
            }
            return 0;
        },
        array_reverse: (arrPtr: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const length = view.getInt32(arrPtr, true);
            const elems: number[] = [];
            for (let i = length - 1; i >= 0; i--) {
                elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
            }
            return writeArrayResult(state, elems);
        },
    };
}

// =============================================================================
// Option builtins — [tag: i32][value: i32] at 8-byte slots
// =============================================================================

function createOptionImports(state: RuntimeState): Record<string, Function> {
    return {
        isSome: (ptr: number): number => {
            return new DataView(getMemoryBuffer(state)).getInt32(ptr, true) === 1 ? 1 : 0;
        },
        isNone: (ptr: number): number => {
            return new DataView(getMemoryBuffer(state)).getInt32(ptr, true) === 0 ? 1 : 0;
        },
        unwrap: (ptr: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const tag = view.getInt32(ptr, true);
            if (tag === 1) return view.getInt32(ptr + 8, true);
            throw new Error("unwrap called on None");
        },
        unwrapOr: (ptr: number, defaultVal: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const tag = view.getInt32(ptr, true);
            if (tag === 1) return view.getInt32(ptr + 8, true);
            return defaultVal;
        },
    };
}

// =============================================================================
// Result builtins — [tag: i32][value_or_error: i32] at 8-byte slots
// Ok = tag 0, Err = tag 1
// =============================================================================

function createResultImports(state: RuntimeState): Record<string, Function> {
    return {
        isOk: (ptr: number): number => {
            return new DataView(getMemoryBuffer(state)).getInt32(ptr, true) === 0 ? 1 : 0;
        },
        isErr: (ptr: number): number => {
            return new DataView(getMemoryBuffer(state)).getInt32(ptr, true) === 1 ? 1 : 0;
        },
        unwrapOk: (ptr: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const tag = view.getInt32(ptr, true);
            if (tag === 0) return view.getInt32(ptr + 8, true);
            throw new Error("unwrapOk called on Err");
        },
        unwrapErr: (ptr: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const tag = view.getInt32(ptr, true);
            if (tag === 1) return view.getInt32(ptr + 8, true);
            throw new Error("unwrapErr called on Ok");
        },
        unwrapOkOr: (ptr: number, defaultVal: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const tag = view.getInt32(ptr, true);
            if (tag === 0) return view.getInt32(ptr + 8, true);
            return defaultVal;
        },
        unwrapErrOr: (ptr: number, defaultVal: number): number => {
            const view = new DataView(getMemoryBuffer(state));
            const tag = view.getInt32(ptr, true);
            if (tag === 1) return view.getInt32(ptr + 8, true);
            return defaultVal;
        },
    };
}

// =============================================================================
// JSON builtins — jsonParse validates JSON, jsonStringify normalizes
// =============================================================================

function createJsonImports(state: RuntimeState): Record<string, Function> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    return {
        jsonParse: (ptr: number, len: number): number => {
            const str = decoder.decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            try {
                JSON.parse(str);
                // Valid JSON — return Ok(strPtr) with original string
                const strPtr = writeStringResult(state, str, encoder);
                return writeResultValue(state, 0, strPtr); // Ok
            } catch (e) {
                const msg = e instanceof Error ? e.message : "Invalid JSON";
                const errPtr = writeStringResult(state, msg, encoder);
                return writeResultValue(state, 1, errPtr); // Err
            }
        },
        jsonStringify: (ptr: number, len: number): number => {
            const str = decoder.decode(new Uint8Array(getMemoryBuffer(state), ptr, len));
            try {
                const parsed = JSON.parse(str);
                return writeStringResult(state, JSON.stringify(parsed), encoder);
            } catch {
                // If input is not valid JSON, return it unchanged
                return writeStringResult(state, str, encoder);
            }
        },
    };
}

// =============================================================================
// Random builtins — randomInt, randomFloat, randomUuid
// =============================================================================

function createRandomImports(state: RuntimeState): Record<string, Function> {
    const encoder = new TextEncoder();
    return {
        randomInt: (min: number, max: number): number => {
            // Inclusive range [min, max] with rejection sampling to avoid modulo bias
            const range = max - min + 1;
            const limit = 0x100000000 - (0x100000000 % range); // largest multiple of range ≤ 2^32
            const array = new Uint32Array(1);
            let val: number;
            do {
                crypto.getRandomValues(array);
                val = array[0]!;
            } while (val >= limit);
            return min + (val % range);
        },
        randomFloat: (): number => {
            const array = new Uint32Array(1);
            crypto.getRandomValues(array);
            return array[0]! / 0x100000000; // [0, 1) — divide by 2^32
        },
        randomUuid: (): number => {
            const uuid = crypto.randomUUID();
            return writeStringResult(state, uuid, encoder);
        },
    };
}

// =============================================================================
// Int64 conversion builtins — widen/narrow between Int and Int64
// =============================================================================

function createInt64Imports(state: RuntimeState): Record<string, Function> {
    const encoder = new TextEncoder();
    return {
        intToInt64: (x: number): bigint => BigInt(x),
        int64ToInt: (x: bigint): number => Number(BigInt.asIntN(32, x)),
        int64ToFloat: (x: bigint): number => Number(x),
        int64ToString: (x: bigint): number => writeStringResult(state, x.toString(), encoder),
    };
}

// =============================================================================
// Factory — combines all groups into one import object
// =============================================================================

/**
 * Create the complete host import object for WASM instantiation.
 *
 * @param state — mutable runtime state shared across all host functions.
 *                `state.instance` must be set after `WebAssembly.instantiate()`
 *                but before calling any exported WASM function.
 */
export function createHostImports(
    state: RuntimeState,
): Record<string, Record<string, unknown>> {
    return {
        host: {
            ...createCoreImports(state),
            ...createStringImports(state),
            ...createMathImports(),
            ...createTypeConversionImports(state),
            ...createInt64Imports(state),
            ...createArrayImports(state),
            ...createOptionImports(state),
            ...createResultImports(state),
            ...createJsonImports(state),
            ...createRandomImports(state),
        },
    };
}
