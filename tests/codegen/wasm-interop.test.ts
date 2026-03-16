// =============================================================================
// WASM Module Interop — End-to-End Tests (Issue #38)
// =============================================================================
// Tests that Edict programs can import functions from external WASM modules at
// runtime via the `externalModules` option in RunLimits.

import { describe, it, expect } from "vitest";
import * as binaryen from "../../src/codegen/wasm-encoder.js";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, Import, FunctionDef, Expression } from "../../src/ast/nodes.js";
import type { TypeExpr, FunctionType } from "../../src/ast/types.js";

// =============================================================================
// Helpers
// =============================================================================

const INT_TYPE: TypeExpr = { kind: "basic", name: "Int" };

function fnType(params: TypeExpr[], returnType: TypeExpr, effects: string[] = ["pure"]): FunctionType {
    return { kind: "fn_type", params, effects: effects as FunctionType["effects"], returnType };
}

function mod(
    defs: EdictModule["definitions"],
    imports: EdictModule["imports"] = [],
): EdictModule {
    return { kind: "module", id: "mod-test-001", name: "test", imports, definitions: defs };
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

// =============================================================================
// Build external WASM modules using binaryen
// =============================================================================

/** Build a minimal WASM module that exports `add(i32, i32) → i32` */
function buildExternalAddModule(): Uint8Array {
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

/** Build a minimal WASM module that exports `multiply(i32, i32) → i32` */
function buildExternalMultiplyModule(): Uint8Array {
    const m = new binaryen.Module();
    m.setMemory(1, 1, "memory");

    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    m.addFunction(
        "multiply", paramType, binaryen.i32, [],
        m.i32.mul(m.local.get(0, binaryen.i32), m.local.get(1, binaryen.i32)),
    );
    m.addFunctionExport("multiply", "multiply");

    m.validate();
    m.optimize();
    const binary = m.emitBinary();
    m.dispose();
    return binary;
}

function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
}

// =============================================================================
// Tests
// =============================================================================

describe("WASM module interop — external module imports", () => {
    it("calls external module function and gets correct result", async () => {
        const extWasm = buildExternalAddModule();
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

    it("calls multiple external modules", async () => {
        const addWasm = buildExternalAddModule();
        const mulWasm = buildExternalMultiplyModule();

        // main() returns multiply(add(2, 3), 4) → 5 * 4 = 20
        const edictModule = mod(
            [fn("main", [], [
                call("multiply", [
                    call("add", [literal(2, "lit-2"), literal(3, "lit-3")], "call-add-001"),
                    literal(4, "lit-4"),
                ], "call-mul-001"),
            ], ["pure"], INT_TYPE)],
            [
                typedImport("ext_math", ["add"], {
                    add: fnType([INT_TYPE, INT_TYPE], INT_TYPE),
                }, "imp-001"),
                typedImport("ext_arith", ["multiply"], {
                    multiply: fnType([INT_TYPE, INT_TYPE], INT_TYPE),
                }, "imp-002"),
            ],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: {
                ext_math: toBase64(addWasm),
                ext_arith: toBase64(mulWasm),
            },
        });

        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(20);
    });

    it("returns error for missing external module", async () => {
        // Edict program imports from "no_such_module"
        const edictModule = mod(
            [fn("main", [], [
                call("someFn", [literal(1, "lit-1")]),
            ], ["pure"], INT_TYPE)],
            [typedImport("no_such_module", ["someFn"], {
                someFn: fnType([INT_TYPE], INT_TYPE),
            })],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        // Run without providing the module — should error
        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: {},
        });

        expect(runResult.exitCode).toBe(1);
        // Output should contain the module name in the error
        expect(runResult.output).toContain("no_such_module");
    });

    it("reserved namespace cannot be overridden by external module", async () => {
        const extWasm = buildExternalAddModule();

        // Simple Edict program using builtins — returns 42
        const edictModule = mod(
            [fn("main", [], [literal(42, "lit-42")], ["pure"], INT_TYPE)],
            [],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        // Attempt to override "env" namespace — should be silently ignored
        const runResult = await runDirect(compileResult.wasm, "main", {
            externalModules: { env: toBase64(extWasm) },
        });

        // Builtins still work — returns 42
        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(42);
    });

    it("works without externalModules (backwards compat)", async () => {
        const edictModule = mod(
            [fn("main", [], [literal(99, "lit-99")], ["pure"], INT_TYPE)],
            [],
        );

        const compileResult = compile(edictModule);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        // No externalModules — should work normally
        const runResult = await runDirect(compileResult.wasm, "main");
        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(99);
    });

    it("external function with print side effect", async () => {
        const extWasm = buildExternalAddModule();
        const extBase64 = toBase64(extWasm);

        // Edict program: let result = add(10, 20); print(intToString(result)); result
        const edictModule = mod(
            [fn("main", [], [
                {
                    kind: "let", id: "let-r", name: "result",
                    value: call("add", [literal(10, "lit-10"), literal(20, "lit-20")]),
                } as Expression,
                call("print", [
                    call("intToString", [ident("result", "id-result-001")], "call-its-001"),
                ], "call-print-001"),
                ident("result", "id-result-002"),
            ], ["io"], INT_TYPE)],
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
        expect(runResult.returnValue).toBe(30);
        expect(runResult.output).toBe("30");
    });
});
