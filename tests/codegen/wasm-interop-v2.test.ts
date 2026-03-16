// =============================================================================
// WASM Module Interop v2 — Shared Memory Tests (Issue #114)
// =============================================================================
// Tests that external WASM modules can share linear memory with the Edict module,
// enabling String return values from external functions. External modules import
// env.memory + env.__get_heap_ptr + env.__set_heap_ptr to participate in Edict's
// heap allocation and string ABI ([len:i32][data:bytes]).

import { describe, it, expect } from "vitest";
import * as binaryen from "../../src/codegen/wasm-encoder.js";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, Import, FunctionDef, Expression } from "../../src/ast/nodes.js";
import type { TypeExpr, FunctionType } from "../../src/ast/types.js";

// =============================================================================
// Helpers — shared with wasm-interop.test.ts pattern
// =============================================================================

const INT_TYPE: TypeExpr = { kind: "basic", name: "Int" };
const STRING_TYPE: TypeExpr = { kind: "basic", name: "String" };

function fnType(params: TypeExpr[], returnType: TypeExpr, effects: string[] = ["pure"]): FunctionType {
    return { kind: "fn_type", params, effects: effects as FunctionType["effects"], returnType };
}

function mod(
    defs: EdictModule["definitions"],
    imports: EdictModule["imports"] = [],
): EdictModule {
    return { kind: "module", id: "mod-test-v2-001", name: "test", imports, definitions: defs };
}

function ident(name: string, id = `id-${name}-001`): Expression {
    return { kind: "ident", id, name };
}

function literal(value: number | string | boolean, id = "lit-001"): Expression {
    return { kind: "literal", id, value };
}

function call(fnName: string, args: Expression[], id = `call-${fnName}-001`): Expression {
    return { kind: "call", id, fn: ident(fnName), args };
}

function fn(
    name: string,
    params: FunctionDef["params"],
    body: Expression[],
    effects: FunctionDef["effects"] = ["pure"],
    returnType?: TypeExpr,
): FunctionDef {
    return {
        kind: "fn", id: `fn-${name}-001`, name, params, effects,
        returnType, contracts: [], body,
    };
}

function typedImport(
    moduleName: string,
    names: string[],
    types: Record<string, TypeExpr>,
    id = "imp-001",
): Import {
    return { kind: "import", id, module: moduleName, names, types };
}

function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
}

// =============================================================================
// External WASM module builders — shared memory variants
// =============================================================================

/**
 * Build an external WASM module that imports env.memory + heap allocator,
 * and exports `makeGreeting() → i32` (returns a pointer to a length-prefixed
 * string "hello" written to the shared heap).
 *
 * WASM pseudocode:
 *   func makeGreeting() → i32:
 *     ptr = __get_heap_ptr()
 *     store i32 at ptr = 5  (length of "hello")
 *     store bytes at ptr+4 = [104, 101, 108, 108, 111]  ("hello")
 *     __set_heap_ptr(ptr + 16)  // 5+4=9 bytes, 8-byte aligned → 16
 *     return ptr
 */
function buildSharedMemoryStringModule(): Uint8Array {
    const m = new binaryen.Module();

    // Import memory and heap allocator from Edict
    m.addMemoryImport("0", "env", "memory");
    m.addFunctionImport("__get_heap_ptr", "env", "__get_heap_ptr", binaryen.none, binaryen.i32);
    m.addFunctionImport("__set_heap_ptr", "env", "__set_heap_ptr", binaryen.i32, binaryen.none);

    // makeGreeting() → i32
    m.addFunction(
        "makeGreeting", binaryen.none, binaryen.i32,
        [binaryen.i32], // local 0: ptr
        m.block(null, [
            // ptr = __get_heap_ptr()
            m.local.set(0, m.call("__get_heap_ptr", [], binaryen.i32)),
            // store length = 5 at ptr
            m.i32.store(0, 4, m.local.get(0, binaryen.i32), m.i32.const(5)),
            // store 'h' at ptr+4
            m.i32.store8(4, 1, m.local.get(0, binaryen.i32), m.i32.const(104)),
            // store 'e' at ptr+5
            m.i32.store8(5, 1, m.local.get(0, binaryen.i32), m.i32.const(101)),
            // store 'l' at ptr+6
            m.i32.store8(6, 1, m.local.get(0, binaryen.i32), m.i32.const(108)),
            // store 'l' at ptr+7
            m.i32.store8(7, 1, m.local.get(0, binaryen.i32), m.i32.const(108)),
            // store 'o' at ptr+8
            m.i32.store8(8, 1, m.local.get(0, binaryen.i32), m.i32.const(111)),
            // __set_heap_ptr(ptr + 16)  (8-byte aligned: 4+5=9, ceil(9/8)*8=16)
            m.call("__set_heap_ptr", [
                m.i32.add(m.local.get(0, binaryen.i32), m.i32.const(16)),
            ], binaryen.none),
            // return ptr
            m.local.get(0, binaryen.i32),
        ], binaryen.i32),
    );
    m.addFunctionExport("makeGreeting", "makeGreeting");

    if (!m.validate()) throw new Error("Invalid shared memory module");
    const binary = m.emitBinary();
    m.dispose();
    return binary;
}

/**
 * Build an external WASM module that imports env.memory and exports
 * `stringLength(ptr: i32) → i32` — reads the length prefix of an
 * Edict string and returns it.
 *
 * WASM pseudocode:
 *   func stringLength(ptr: i32) → i32:
 *     return i32.load(ptr)  // read the 4-byte length header
 */
function buildStringLengthModule(): Uint8Array {
    const m = new binaryen.Module();

    m.addMemoryImport("0", "env", "memory");
    m.addFunctionImport("__get_heap_ptr", "env", "__get_heap_ptr", binaryen.none, binaryen.i32);
    m.addFunctionImport("__set_heap_ptr", "env", "__set_heap_ptr", binaryen.i32, binaryen.none);

    m.addFunction(
        "stringLength", binaryen.i32, binaryen.i32, [],
        // Read i32 at ptr (little-endian) — this is the string length
        m.i32.load(0, 4, m.local.get(0, binaryen.i32)),
    );
    m.addFunctionExport("stringLength", "stringLength");

    if (!m.validate()) throw new Error("Invalid string length module");
    const binary = m.emitBinary();
    m.dispose();
    return binary;
}

/**
 * Build an external WASM module that imports env.memory + heap allocator,
 * and exports `exclaim(ptr: i32) → i32` — reads an Edict string,
 * appends "!" to it, and returns a new string pointer.
 *
 * Uses a manual byte-copy loop (no BulkMemory dependency).
 */
function buildExclaimModule(): Uint8Array {
    const m = new binaryen.Module();

    m.addMemoryImport("0", "env", "memory");
    m.addFunctionImport("__get_heap_ptr", "env", "__get_heap_ptr", binaryen.none, binaryen.i32);
    m.addFunctionImport("__set_heap_ptr", "env", "__set_heap_ptr", binaryen.i32, binaryen.none);

    // locals: 0=srcPtr (param), 1=srcLen, 2=dstPtr, 3=newLen, 4=i (loop counter)
    m.addFunction(
        "exclaim", binaryen.i32, binaryen.i32,
        [binaryen.i32, binaryen.i32, binaryen.i32, binaryen.i32],
        m.block(null, [
            // srcLen = i32.load(srcPtr)
            m.local.set(1, m.i32.load(0, 4, m.local.get(0, binaryen.i32))),
            // newLen = srcLen + 1
            m.local.set(3, m.i32.add(m.local.get(1, binaryen.i32), m.i32.const(1))),
            // dstPtr = __get_heap_ptr()
            m.local.set(2, m.call("__get_heap_ptr", [], binaryen.i32)),
            // store newLen at dstPtr
            m.i32.store(0, 4, m.local.get(2, binaryen.i32), m.local.get(3, binaryen.i32)),
            // i = 0
            m.local.set(4, m.i32.const(0)),
            // Manual byte copy loop: copy srcLen bytes from srcPtr+4 to dstPtr+4
            m.block("break", [
                m.loop("copy_loop",
                    m.block(null, [
                        // if (i >= srcLen) break
                        m.br("break",
                            m.i32.ge_u(m.local.get(4, binaryen.i32), m.local.get(1, binaryen.i32)),
                        ),
                        // dst[dstPtr+4+i] = src[srcPtr+4+i]
                        m.i32.store8(0, 1,
                            m.i32.add(
                                m.i32.add(m.local.get(2, binaryen.i32), m.i32.const(4)),
                                m.local.get(4, binaryen.i32),
                            ),
                            m.i32.load8_u(0, 1,
                                m.i32.add(
                                    m.i32.add(m.local.get(0, binaryen.i32), m.i32.const(4)),
                                    m.local.get(4, binaryen.i32),
                                ),
                            ),
                        ),
                        // i++
                        m.local.set(4, m.i32.add(m.local.get(4, binaryen.i32), m.i32.const(1))),
                        // continue
                        m.br("copy_loop"),
                    ]),
                ),
            ]),
            // store '!' at dstPtr+4+srcLen
            m.i32.store8(0, 1,
                m.i32.add(
                    m.i32.add(m.local.get(2, binaryen.i32), m.i32.const(4)),
                    m.local.get(1, binaryen.i32),
                ),
                m.i32.const(33), // '!'
            ),
            // __set_heap_ptr(dstPtr + align8(4 + newLen))
            m.call("__set_heap_ptr", [
                m.i32.add(
                    m.local.get(2, binaryen.i32),
                    m.i32.and(
                        m.i32.add(
                            m.i32.add(m.i32.const(4), m.local.get(3, binaryen.i32)),
                            m.i32.const(7),
                        ),
                        m.i32.const(-8),
                    ),
                ),
            ], binaryen.none),
            // return dstPtr
            m.local.get(2, binaryen.i32),
        ], binaryen.i32),
    );
    m.addFunctionExport("exclaim", "exclaim");

    if (!m.validate()) throw new Error("Invalid exclaim module");
    const binary = m.emitBinary();
    m.dispose();
    return binary;
}

// =============================================================================
// v1 backward compat module (no memory import — scalar only)
// =============================================================================

function buildScalarAddModule(): Uint8Array {
    const m = new binaryen.Module();
    m.setMemory(1, 1, "memory");

    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    m.addFunction(
        "add", paramType, binaryen.i32, [],
        m.i32.add(m.local.get(0, binaryen.i32), m.local.get(1, binaryen.i32)),
    );
    m.addFunctionExport("add", "add");

    m.validate();
    m.optimize();
    const binary = m.emitBinary();
    m.dispose();
    return binary;
}

// =============================================================================
// Tests
// =============================================================================

describe("WASM module interop v2 — shared memory for strings", () => {
    it("external module returns a string via shared memory", async () => {
        const extWasm = buildSharedMemoryStringModule();
        const extBase64 = toBase64(extWasm);

        // Edict program: main() prints makeGreeting() — should print "hello"
        const edictModule = mod(
            [fn("main", [], [
                call("print", [
                    call("makeGreeting", [], "call-mg-001"),
                ], "call-print-001"),
                literal(0, "lit-0"),
            ], ["io"], INT_TYPE)],
            [typedImport("ext_strings", ["makeGreeting"], {
                makeGreeting: fnType([], STRING_TYPE),
            })],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: { ext_strings: extBase64 },
        });

        expect(runResult.exitCode).toBe(0);
        expect(runResult.output).toBe("hello");
    });

    it("external module reads a string argument via shared memory", async () => {
        const extWasm = buildStringLengthModule();
        const extBase64 = toBase64(extWasm);

        // Edict program: main() returns stringLength("test") — should be 4
        const edictModule = mod(
            [fn("main", [], [
                call("stringLength", [literal("test", "lit-test")], "call-sl-001"),
            ], ["pure"], INT_TYPE)],
            [typedImport("ext_strings", ["stringLength"], {
                stringLength: fnType([STRING_TYPE], INT_TYPE),
            })],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: { ext_strings: extBase64 },
        });

        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(4);
    });

    it("external module transforms a string (round-trip)", async () => {
        const extWasm = buildExclaimModule();
        const extBase64 = toBase64(extWasm);

        // Edict program: main() prints exclaim("wow") — should print "wow!"
        const edictModule = mod(
            [fn("main", [], [
                call("print", [
                    call("exclaim", [literal("wow", "lit-wow")], "call-exc-001"),
                ], "call-print-001"),
                literal(0, "lit-0"),
            ], ["io"], INT_TYPE)],
            [typedImport("ext_strings", ["exclaim"], {
                exclaim: fnType([STRING_TYPE], STRING_TYPE),
            })],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: { ext_strings: extBase64 },
        });

        expect(runResult.exitCode).toBe(0);
        expect(runResult.output).toBe("wow!");
    });

    it("v1 scalar-only module still works (backward compat)", async () => {
        const extWasm = buildScalarAddModule();
        const extBase64 = toBase64(extWasm);

        // Edict program: main() returns add(3, 4) — should be 7
        const edictModule = mod(
            [fn("main", [], [
                call("add", [literal(3, "lit-3"), literal(4, "lit-4")]),
            ], ["pure"], INT_TYPE)],
            [typedImport("ext_math", ["add"], {
                add: fnType([INT_TYPE, INT_TYPE], INT_TYPE),
            })],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: { ext_math: extBase64 },
        });

        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(7);
    });

    it("mixed shared-memory and scalar modules in same program", async () => {
        const stringWasm = buildSharedMemoryStringModule();
        const scalarWasm = buildScalarAddModule();

        // Edict program: let greeting = makeGreeting(); let sum = add(2, 3);
        //   print(greeting); return sum
        const edictModule = mod(
            [fn("main", [], [
                {
                    kind: "let", id: "let-g", name: "greeting",
                    value: call("makeGreeting", [], "call-mg-001"),
                } as Expression,
                {
                    kind: "let", id: "let-s", name: "sum",
                    value: call("add", [literal(2, "lit-2"), literal(3, "lit-3")], "call-add-001"),
                } as Expression,
                call("print", [ident("greeting", "id-greeting-001")], "call-print-001"),
                ident("sum", "id-sum-001"),
            ], ["io"], INT_TYPE)],
            [
                typedImport("ext_strings", ["makeGreeting"], {
                    makeGreeting: fnType([], STRING_TYPE),
                }, "imp-001"),
                typedImport("ext_math", ["add"], {
                    add: fnType([INT_TYPE, INT_TYPE], INT_TYPE),
                }, "imp-002"),
            ],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: {
                ext_strings: toBase64(stringWasm),
                ext_math: toBase64(scalarWasm),
            },
        });

        expect(runResult.exitCode).toBe(0);
        expect(runResult.output).toBe("hello");
        expect(runResult.returnValue).toBe(5);
    });
});
