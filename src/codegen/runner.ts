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
        },
    };

    const { instance } = await WebAssembly.instantiate(wasm, importObject);

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
