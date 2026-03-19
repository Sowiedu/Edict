// =============================================================================
// WASM Interpreter Tests — pure-JS WASM MVP execution
// =============================================================================
// Tests for the wasm-interpreter.ts module. Uses two strategies:
//   1. Hand-crafted minimal WASM binaries (test individual opcodes)
//   2. Real Edict-compiled WASM binaries (integration with encoder)

import { describe, it, expect } from "vitest";
import { wasmInstantiate } from "../../src/codegen/wasm-interpreter.js";
import { Module, i32, f64, none, createType } from "../../src/codegen/wasm-encoder.js";

// ---------------------------------------------------------------------------
// Helper: build a Edict-style WASM module with the encoder, then interpret it
// ---------------------------------------------------------------------------
function buildAndRun(setup: (mod: Module) => void, entryFn = "test"): unknown {
    const mod = new Module();
    setup(mod);
    const bytes = mod.emitBinary();
    const result = wasmInstantiate(bytes);
    const fn = result.instance.exports[entryFn] as Function;
    return fn();
}

// ===========================================================================
// Basic arithmetic
// ===========================================================================

describe("WASM interpreter — i32 arithmetic", () => {
    it("returns constant", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [], mod.i32.const(42));
            mod.addFunctionExport("test", "test");
        })).toBe(42);
    });

    it("adds two constants", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.add(mod.i32.const(3), mod.i32.const(4)));
            mod.addFunctionExport("test", "test");
        })).toBe(7);
    });

    it("subtracts", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.sub(mod.i32.const(10), mod.i32.const(3)));
            mod.addFunctionExport("test", "test");
        })).toBe(7);
    });

    it("multiplies", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.mul(mod.i32.const(6), mod.i32.const(7)));
            mod.addFunctionExport("test", "test");
        })).toBe(42);
    });

    it("divides", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.div_s(mod.i32.const(20), mod.i32.const(4)));
            mod.addFunctionExport("test", "test");
        })).toBe(5);
    });

    it("remainder", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.rem_s(mod.i32.const(17), mod.i32.const(5)));
            mod.addFunctionExport("test", "test");
        })).toBe(2);
    });

    it("division by zero traps", () => {
        expect(() => buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.div_s(mod.i32.const(1), mod.i32.const(0)));
            mod.addFunctionExport("test", "test");
        })).toThrow("integer divide by zero");
    });
});

// ===========================================================================
// i32 comparisons
// ===========================================================================

describe("WASM interpreter — i32 comparisons", () => {
    it("eq: true", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.eq(mod.i32.const(5), mod.i32.const(5)));
            mod.addFunctionExport("test", "test");
        })).toBe(1);
    });

    it("eq: false", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.eq(mod.i32.const(5), mod.i32.const(6)));
            mod.addFunctionExport("test", "test");
        })).toBe(0);
    });

    it("lt_s", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.lt_s(mod.i32.const(3), mod.i32.const(5)));
            mod.addFunctionExport("test", "test");
        })).toBe(1);
    });

    it("eqz: zero", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.eqz(mod.i32.const(0)));
            mod.addFunctionExport("test", "test");
        })).toBe(1);
    });

    it("eqz: nonzero", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.eqz(mod.i32.const(42)));
            mod.addFunctionExport("test", "test");
        })).toBe(0);
    });
});

// ===========================================================================
// f64 arithmetic
// ===========================================================================

describe("WASM interpreter — f64 arithmetic", () => {
    it("adds floats", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, f64, [],
                mod.f64.add(mod.f64.const(1.5), mod.f64.const(2.5)));
            mod.addFunctionExport("test", "test");
        })).toBeCloseTo(4.0);
    });

    it("divides floats", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, f64, [],
                mod.f64.div(mod.f64.const(10.0), mod.f64.const(3.0)));
            mod.addFunctionExport("test", "test");
        })).toBeCloseTo(3.333333);
    });

    it("negates", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, f64, [],
                mod.f64.neg(mod.f64.const(7.5)));
            mod.addFunctionExport("test", "test");
        })).toBeCloseTo(-7.5);
    });
});

// ===========================================================================
// Control flow
// ===========================================================================

describe("WASM interpreter — control flow", () => {
    it("if-then (true branch)", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.if(mod.i32.const(1),
                    mod.block(null, [mod.i32.const(10)], i32),
                    mod.block(null, [mod.i32.const(20)], i32),
                ));
            mod.addFunctionExport("test", "test");
        })).toBe(10);
    });

    it("if-then (false branch)", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.if(mod.i32.const(0),
                    mod.block(null, [mod.i32.const(10)], i32),
                    mod.block(null, [mod.i32.const(20)], i32),
                ));
            mod.addFunctionExport("test", "test");
        })).toBe(20);
    });

    it("function call", () => {
        expect(buildAndRun(mod => {
            const paramType = createType([i32, i32]);
            mod.addFunction("add", paramType, i32, [],
                mod.i32.add(mod.local.get(0, i32), mod.local.get(1, i32)));
            mod.addFunction("test", none, i32, [],
                mod.call("add", [mod.i32.const(3), mod.i32.const(4)], i32));
            mod.addFunctionExport("test", "test");
        })).toBe(7);
    });

    it("recursive function (factorial 5)", () => {
        expect(buildAndRun(mod => {
            // factorial(n) = n <= 1 ? 1 : n * factorial(n - 1)
            mod.addFunction("factorial", i32, i32, [],
                mod.if(
                    mod.i32.le_s(mod.local.get(0, i32), mod.i32.const(1)),
                    mod.block(null, [mod.i32.const(1)], i32),
                    mod.block(null, [
                        mod.i32.mul(
                            mod.local.get(0, i32),
                            mod.call("factorial", [
                                mod.i32.sub(mod.local.get(0, i32), mod.i32.const(1))
                            ], i32)
                        ),
                    ], i32),
                ));
            mod.addFunction("test", none, i32, [],
                mod.call("factorial", [mod.i32.const(5)], i32));
            mod.addFunctionExport("test", "test");
        })).toBe(120);
    });
});

// ===========================================================================
// Host function imports
// ===========================================================================

describe("WASM interpreter — host imports", () => {
    it("calls imported function", () => {
        let captured = 0;
        const mod = new Module();
        const paramType = createType([i32]);
        mod.addFunctionImport("addTen", "host", "addTen", paramType, i32);
        mod.addFunction("test", none, i32, [],
            mod.call("addTen", [mod.i32.const(5)], i32));
        mod.addFunctionExport("test", "test");
        const bytes = mod.emitBinary();
        const result = wasmInstantiate(bytes, {
            host: { addTen: (x: number) => { captured = x; return x + 10; } },
        });
        const fn = result.instance.exports.test as Function;
        expect(fn()).toBe(15);
        expect(captured).toBe(5);
    });

    it("throws on missing import", () => {
        const mod = new Module();
        mod.addFunctionImport("missing", "host", "missing", none, i32);
        mod.addFunction("test", none, i32, [],
            mod.call("missing", [], i32));
        mod.addFunctionExport("test", "test");
        const bytes = mod.emitBinary();
        expect(() => wasmInstantiate(bytes, {}))
            .toThrow("wasm_link: missing import host.missing");
    });
});

// ===========================================================================
// Memory operations
// ===========================================================================

describe("WASM interpreter — memory", () => {
    it("i32.store + i32.load roundtrip", () => {
        expect(buildAndRun(mod => {
            mod.setMemory(1, 1, "memory");
            mod.addFunction("test", none, i32, [],
                mod.block(null, [
                    mod.i32.store(0, 2, mod.i32.const(0), mod.i32.const(42)),
                    mod.i32.load(0, 2, mod.i32.const(0)),
                ], i32));
            mod.addFunctionExport("test", "test");
        })).toBe(42);
    });

    it("f64.store + f64.load roundtrip", () => {
        expect(buildAndRun(mod => {
            mod.setMemory(1, 1, "memory");
            mod.addFunction("test", none, f64, [],
                mod.block(null, [
                    mod.f64.store(0, 3, mod.i32.const(0), mod.f64.const(3.14)),
                    mod.f64.load(0, 3, mod.i32.const(0)),
                ], f64));
            mod.addFunctionExport("test", "test");
        })).toBeCloseTo(3.14);
    });

    it("data segments initialized", () => {
        const mod = new Module();
        const data = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
        mod.setMemory(1, 1, "memory", [
            { offset: mod.i32.const(100), data, passive: false },
        ]);
        mod.addFunction("test", none, i32, [],
            mod.i32.load8_u(0, 0, mod.i32.const(100)));
        mod.addFunctionExport("test", "test");
        const bytes = mod.emitBinary();
        const result = wasmInstantiate(bytes);
        const fn = result.instance.exports.test as Function;
        expect(fn()).toBe(0x48); // 'H'
    });
});

// ===========================================================================
// Globals
// ===========================================================================

describe("WASM interpreter — globals", () => {
    it("global.get returns initialized value", () => {
        expect(buildAndRun(mod => {
            mod.addGlobal("counter", i32, true, mod.i32.const(99));
            mod.addFunction("test", none, i32, [],
                mod.global.get("counter", i32));
            mod.addFunctionExport("test", "test");
        })).toBe(99);
    });

    it("global.set + global.get roundtrip", () => {
        expect(buildAndRun(mod => {
            mod.addGlobal("counter", i32, true, mod.i32.const(0));
            mod.addFunction("test", none, i32, [],
                mod.block(null, [
                    mod.global.set("counter", mod.i32.const(42)),
                    mod.global.get("counter", i32),
                ], i32));
            mod.addFunctionExport("test", "test");
        })).toBe(42);
    });
});

// ===========================================================================
// Table + call_indirect
// ===========================================================================

describe("WASM interpreter — table + call_indirect", () => {
    it("call_indirect dispatches correctly", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("double", i32, i32, [],
                mod.i32.mul(mod.local.get(0, i32), mod.i32.const(2)));
            mod.addFunction("triple", i32, i32, [],
                mod.i32.mul(mod.local.get(0, i32), mod.i32.const(3)));
            mod.addTable("tbl", 2, 2);
            mod.addActiveElementSegment("tbl", "seg0", ["double", "triple"], mod.i32.const(0));
            // Call table index 1 (triple) with arg 5
            mod.addFunction("test", none, i32, [],
                mod.call_indirect("tbl", mod.i32.const(1), [mod.i32.const(5)], i32, i32));
            mod.addFunctionExport("test", "test");
        })).toBe(15);
    });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("WASM interpreter — edge cases", () => {
    it("unreachable traps", () => {
        expect(() => buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.block(null, [mod.unreachable(), mod.i32.const(42)], i32));
            mod.addFunctionExport("test", "test");
        })).toThrow("wasm_trap: unreachable");
    });

    it("step limit prevents infinite loops", () => {
        const mod = new Module();
        // Loop forever: loop { br 0 }
        mod.addFunction("test", none, none, [],
            mod.loop("forever", mod.br("forever")));
        mod.addFunctionExport("test", "test");
        const bytes = mod.emitBinary();
        const result = wasmInstantiate(bytes, {}, { maxSteps: 1000 });
        const fn = result.instance.exports.test as Function;
        expect(() => fn()).toThrow("wasm_step_limit");
    });

    it("invalid WASM binary (bad magic)", () => {
        expect(() => wasmInstantiate(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0])))
            .toThrow("wasm_invalid: bad magic number");
    });

    it("negative i32 constants preserved", () => {
        expect(buildAndRun(mod => {
            mod.addFunction("test", none, i32, [],
                mod.i32.const(-1));
            mod.addFunctionExport("test", "test");
        })).toBe(-1);
    });
});

// ===========================================================================
// Integration: use real Edict-compiled WASM
// ===========================================================================

describe("WASM interpreter — Edict integration", () => {
    it("executes arithmetic.edict.json compiled WASM", async () => {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const { compileBrowser } = await import("../../src/browser-full.js");
        const { createHostImports } = await import("../../src/builtins/registry.js");
        const ast = JSON.parse(readFileSync(resolve("examples/arithmetic.edict.json"), "utf-8"));
        const compiled = compileBrowser(ast);
        expect(compiled.ok).toBe(true);
        expect(compiled.wasm).toBeInstanceOf(Uint8Array);

        // Use real host imports from registry
        const state = { outputParts: [] as string[], instance: null as any };
        const importObject = createHostImports(state);

        const { instance } = wasmInstantiate(compiled.wasm!, importObject);
        state.instance = instance;
        const main = instance.exports.main as () => number;
        expect(main()).toBe(7); // add(3, 4) = 7
    });
});

