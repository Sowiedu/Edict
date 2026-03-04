// =============================================================================
// WASM Runner — Execute compiled Edict WASM binaries
// =============================================================================
// Instantiates WASM via Node's WebAssembly API, provides host imports
// (e.g. print), captures output, and returns the result.

/* eslint-disable @typescript-eslint/no-namespace */
// Minimal WebAssembly type declarations for Node.js runtime
declare namespace WebAssembly {
    interface Memory {
        readonly buffer: ArrayBuffer;
    }
    interface Exports {
        [key: string]: unknown;
        memory?: Memory;
    }
    interface Instance {
        readonly exports: Exports;
    }
    interface InstantiateResult {
        instance: Instance;
    }
    function instantiate(
        bufferSource: Uint8Array,
        importObject?: Record<string, Record<string, unknown>>,
    ): Promise<InstantiateResult>;
}

export interface RunResult {
    /** Captured stdout output */
    output: string;
    /** Exit code (0 = success) */
    exitCode: number;
    /** Return value from main (if any) */
    returnValue?: number;
}

/**
 * Run a compiled Edict WASM binary.
 *
 * @param wasm - The WASM binary (Uint8Array from codegen)
 * @param entryFn - Name of the function to call (default: "main")
 */
export async function run(
    wasm: Uint8Array,
    entryFn: string = "main",
): Promise<RunResult> {
    const outputParts: string[] = [];

    // Late-bound references — set after instantiation
    let instance: WebAssembly.Instance;

    /**
     * Write a string result into WASM memory at __heap_ptr,
     * advance __heap_ptr (8-byte aligned), set __str_ret_len, and return ptr.
     */
    function writeStringResult(str: string, encoder: TextEncoder): number {
        const encoded = encoder.encode(str);
        const memoryBuffer = (instance.exports.memory as WebAssembly.Memory).buffer;
        const getHeapPtr = instance.exports.__get_heap_ptr as () => number;
        const setHeapPtr = instance.exports.__set_heap_ptr as (v: number) => void;
        const setStrRetLen = instance.exports.__set_str_ret_len as (v: number) => void;

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
    function writeArrayResult(elements: number[]): number {
        const memoryBuffer = (instance.exports.memory as WebAssembly.Memory).buffer;
        const getHeapPtr = instance.exports.__get_heap_ptr as () => number;
        const setHeapPtr = instance.exports.__set_heap_ptr as (v: number) => void;

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

    const importObject = {
        host: {
            /**
             * print(ptr: i32, len: i32) → i32
             * Reads `len` bytes from WASM memory at `ptr`, decodes as UTF-8,
             * appends to output, and returns the pointer for passthrough.
             */
            print: (ptr: number, len: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const bytes = new Uint8Array(memoryBuffer, ptr, len);
                const text = new TextDecoder().decode(bytes);
                outputParts.push(text);
                return ptr;
            },
            /**
             * string_replace(hayPtr, hayLen, needlePtr, needleLen, replPtr, replLen) → i32
             * Reads three strings from WASM memory, performs replaceAll,
             * writes the result into WASM memory at __heap_ptr,
             * advances __heap_ptr, sets __str_ret_len, and returns result ptr.
             */
            string_replace: (
                hayPtr: number, hayLen: number,
                needlePtr: number, needleLen: number,
                replPtr: number, replLen: number,
            ): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const decoder = new TextDecoder();
                const encoder = new TextEncoder();

                const haystack = decoder.decode(new Uint8Array(memoryBuffer, hayPtr, hayLen));
                const needle = decoder.decode(new Uint8Array(memoryBuffer, needlePtr, needleLen));
                const replacement = decoder.decode(new Uint8Array(memoryBuffer, replPtr, replLen));

                const result = haystack.replaceAll(needle, replacement);
                return writeStringResult(result, encoder);
            },
            // =================================================================
            // String builtins
            // =================================================================
            string_length: (ptr: number, len: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const str = new TextDecoder().decode(new Uint8Array(memoryBuffer, ptr, len));
                return str.length;
            },
            substring: (ptr: number, len: number, start: number, end: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const str = new TextDecoder().decode(new Uint8Array(memoryBuffer, ptr, len));
                const result = str.substring(start, end);
                return writeStringResult(result, new TextEncoder());
            },
            string_concat: (
                aPtr: number, aLen: number,
                bPtr: number, bLen: number,
            ): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const decoder = new TextDecoder();
                const a = decoder.decode(new Uint8Array(memoryBuffer, aPtr, aLen));
                const b = decoder.decode(new Uint8Array(memoryBuffer, bPtr, bLen));
                return writeStringResult(a + b, new TextEncoder());
            },
            string_indexOf: (
                hayPtr: number, hayLen: number,
                needlePtr: number, needleLen: number,
            ): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const decoder = new TextDecoder();
                const haystack = decoder.decode(new Uint8Array(memoryBuffer, hayPtr, hayLen));
                const needle = decoder.decode(new Uint8Array(memoryBuffer, needlePtr, needleLen));
                return haystack.indexOf(needle);
            },
            toUpperCase: (ptr: number, len: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const str = new TextDecoder().decode(new Uint8Array(memoryBuffer, ptr, len));
                return writeStringResult(str.toUpperCase(), new TextEncoder());
            },
            toLowerCase: (ptr: number, len: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const str = new TextDecoder().decode(new Uint8Array(memoryBuffer, ptr, len));
                return writeStringResult(str.toLowerCase(), new TextEncoder());
            },
            string_trim: (ptr: number, len: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const str = new TextDecoder().decode(new Uint8Array(memoryBuffer, ptr, len));
                return writeStringResult(str.trim(), new TextEncoder());
            },
            string_startsWith: (
                strPtr: number, strLen: number,
                prefixPtr: number, prefixLen: number,
            ): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const decoder = new TextDecoder();
                const str = decoder.decode(new Uint8Array(memoryBuffer, strPtr, strLen));
                const prefix = decoder.decode(new Uint8Array(memoryBuffer, prefixPtr, prefixLen));
                return str.startsWith(prefix) ? 1 : 0;
            },
            string_endsWith: (
                strPtr: number, strLen: number,
                suffixPtr: number, suffixLen: number,
            ): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const decoder = new TextDecoder();
                const str = decoder.decode(new Uint8Array(memoryBuffer, strPtr, strLen));
                const suffix = decoder.decode(new Uint8Array(memoryBuffer, suffixPtr, suffixLen));
                return str.endsWith(suffix) ? 1 : 0;
            },
            string_contains: (
                hayPtr: number, hayLen: number,
                needlePtr: number, needleLen: number,
            ): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const decoder = new TextDecoder();
                const haystack = decoder.decode(new Uint8Array(memoryBuffer, hayPtr, hayLen));
                const needle = decoder.decode(new Uint8Array(memoryBuffer, needlePtr, needleLen));
                return haystack.includes(needle) ? 1 : 0;
            },
            string_repeat: (ptr: number, len: number, count: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const str = new TextDecoder().decode(new Uint8Array(memoryBuffer, ptr, len));
                return writeStringResult(str.repeat(count), new TextEncoder());
            },
            // =================================================================
            // Math builtins
            // =================================================================
            abs: (x: number): number => Math.abs(x),
            min: (a: number, b: number): number => Math.min(a, b),
            max: (a: number, b: number): number => Math.max(a, b),
            pow: (base: number, exp: number): number => (Math.pow(base, exp) | 0),
            sqrt: (x: number): number => Math.sqrt(x),
            floor: (x: number): number => (Math.floor(x) | 0),
            ceil: (x: number): number => (Math.ceil(x) | 0),
            round: (x: number): number => (Math.round(x) | 0),
            // =================================================================
            // Type conversion builtins
            // =================================================================
            intToString: (value: number): number => {
                return writeStringResult(String(value), new TextEncoder());
            },
            floatToString: (value: number): number => {
                return writeStringResult(String(value), new TextEncoder());
            },
            boolToString: (value: number): number => {
                return writeStringResult(value ? "true" : "false", new TextEncoder());
            },
            floatToInt: (value: number): number => (Math.trunc(value) | 0),
            intToFloat: (value: number): number => value,
            // =================================================================
            // Array builtins — operate on [length: i32][elem0: i32][elem1: i32]...
            // =================================================================
            array_length: (arrPtr: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                return view.getInt32(arrPtr, true);
            },
            array_get: (arrPtr: number, index: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                if (index < 0 || index >= length) return 0; // safe default for OOB
                return view.getInt32(arrPtr + 4 + index * 4, true);
            },
            array_set: (arrPtr: number, index: number, value: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                // Copy all elements into a new array with the updated value
                const elems: number[] = [];
                for (let i = 0; i < length; i++) {
                    elems.push(i === index ? value : view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(elems);
            },
            array_push: (arrPtr: number, value: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                const elems: number[] = [];
                for (let i = 0; i < length; i++) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                elems.push(value);
                return writeArrayResult(elems);
            },
            array_pop: (arrPtr: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                if (length === 0) return writeArrayResult([]);
                const elems: number[] = [];
                for (let i = 0; i < length - 1; i++) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(elems);
            },
            array_concat: (aPtr: number, bPtr: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const aLen = view.getInt32(aPtr, true);
                const bLen = view.getInt32(bPtr, true);
                const elems: number[] = [];
                for (let i = 0; i < aLen; i++) {
                    elems.push(view.getInt32(aPtr + 4 + i * 4, true));
                }
                for (let i = 0; i < bLen; i++) {
                    elems.push(view.getInt32(bPtr + 4 + i * 4, true));
                }
                return writeArrayResult(elems);
            },
            array_slice: (arrPtr: number, start: number, end: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                // Clamp indices to [0, length]
                const s = Math.max(0, Math.min(start, length));
                const e = Math.max(s, Math.min(end, length));
                const elems: number[] = [];
                for (let i = s; i < e; i++) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(elems);
            },
            array_isEmpty: (arrPtr: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                return view.getInt32(arrPtr, true) === 0 ? 1 : 0;
            },
            array_contains: (arrPtr: number, value: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                for (let i = 0; i < length; i++) {
                    if (view.getInt32(arrPtr + 4 + i * 4, true) === value) return 1;
                }
                return 0;
            },
            array_reverse: (arrPtr: number): number => {
                const memoryBuffer = (
                    instance.exports.memory as WebAssembly.Memory
                ).buffer;
                const view = new DataView(memoryBuffer);
                const length = view.getInt32(arrPtr, true);
                const elems: number[] = [];
                for (let i = length - 1; i >= 0; i--) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(elems);
            },
        },
    };

    ({ instance } = await WebAssembly.instantiate(wasm, importObject));

    let returnValue: number | undefined;
    let exitCode = 0;

    try {
        const mainFn = instance.exports[entryFn] as
            | ((...args: unknown[]) => number)
            | undefined;

        if (!mainFn || typeof mainFn !== "function") {
            return {
                output: "",
                exitCode: 1,
            };
        }

        returnValue = mainFn();
    } catch (e) {
        outputParts.push(
            `Runtime error: ${e instanceof Error ? e.message : String(e)}`,
        );
        exitCode = 1;
    }

    return {
        output: outputParts.join(""),
        exitCode,
        returnValue,
    };
}
