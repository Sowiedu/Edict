// =============================================================================
// Compact AST Expansion Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    expandCompact,
    isCompactAst,
    KIND_MAP,
    KEY_MAP,
    compactSchemaReference,
} from "../../src/compact/expand.js";
import {
    handleValidate,
    handleCompile,
    handleSchema,
    handleVersion,
    handleLint,
} from "../../src/mcp/handlers.js";
import { runDirect } from "../../src/codegen/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(__dirname, "..", "..", "examples");

function loadExample(name: string): unknown {
    return JSON.parse(readFileSync(resolve(examplesDir, `${name}.edict.json`), "utf-8"));
}

// =============================================================================
// isCompactAst detection
// =============================================================================

describe("isCompactAst", () => {
    it("detects compact format (has 'k', no 'kind')", () => {
        expect(isCompactAst({ k: "mod", i: "m1", n: "test", im: [], ds: [] })).toBe(true);
    });

    it("rejects full format", () => {
        expect(isCompactAst({ kind: "module", id: "m1", name: "test" })).toBe(false);
    });

    it("rejects non-objects", () => {
        expect(isCompactAst(null)).toBe(false);
        expect(isCompactAst(42)).toBe(false);
        expect(isCompactAst("hello")).toBe(false);
        expect(isCompactAst([1, 2])).toBe(false);
    });

    it("rejects object with both 'k' and 'kind' (kind wins)", () => {
        expect(isCompactAst({ k: "mod", kind: "module" })).toBe(false);
    });
});

// =============================================================================
// expandCompact — basic expansion
// =============================================================================

describe("expandCompact — basics", () => {
    it("passes through null/undefined", () => {
        expect(expandCompact(null)).toBe(null);
        expect(expandCompact(undefined)).toBe(undefined);
    });

    it("passes through primitives", () => {
        expect(expandCompact(42)).toBe(42);
        expect(expandCompact("hello")).toBe("hello");
        expect(expandCompact(true)).toBe(true);
    });

    it("passes through full-format AST unchanged", () => {
        const full = loadExample("hello");
        const expanded = expandCompact(full);
        expect(expanded).toEqual(full);
    });

    it("expands a compact literal", () => {
        const compact = { k: "lit", i: "l1", v: 42 };
        const expected = { kind: "literal", id: "l1", value: 42 };
        expect(expandCompact(compact)).toEqual(expected);
    });

    it("expands a compact identifier", () => {
        const compact = { k: "id", i: "i1", n: "x" };
        const expected = { kind: "ident", id: "i1", name: "x" };
        expect(expandCompact(compact)).toEqual(expected);
    });

    it("expands a compact binary operation", () => {
        const compact = {
            k: "bin",
            i: "b1",
            op: "+",
            l: { k: "id", i: "i1", n: "a" },
            r: { k: "id", i: "i2", n: "b" },
        };
        const expected = {
            kind: "binop",
            id: "b1",
            op: "+",
            left: { kind: "ident", id: "i1", name: "a" },
            right: { kind: "ident", id: "i2", name: "b" },
        };
        expect(expandCompact(compact)).toEqual(expected);
    });

    it("expands a compact unary operation", () => {
        const compact = {
            k: "un",
            i: "u1",
            op: "-",
            od: { k: "id", i: "i1", n: "x" },
        };
        const expected = {
            kind: "unop",
            id: "u1",
            op: "-",
            operand: { kind: "ident", id: "i1", name: "x" },
        };
        expect(expandCompact(compact)).toEqual(expected);
    });

    it("unknown compact kinds pass through for validator to catch", () => {
        const compact = { k: "xyz_invalid", i: "x1" };
        const expanded = expandCompact(compact) as Record<string, unknown>;
        expect(expanded.kind).toBe("xyz_invalid");
    });
});

// =============================================================================
// expandCompact — type expressions
// =============================================================================

describe("expandCompact — type expressions", () => {
    it("expands basic type", () => {
        const compact = { k: "b", n: "Int" };
        expect(expandCompact(compact)).toEqual({ kind: "basic", name: "Int" });
    });

    it("expands array type", () => {
        const compact = { k: "arr", es: [{ k: "lit", i: "l1", v: 1 }] };
        expect(expandCompact(compact)).toEqual({
            kind: "array",
            elements: [{ kind: "literal", id: "l1", value: 1 }],
        });
    });

    it("expands option type", () => {
        const compact = { k: "opt", in: { k: "b", n: "Int" } };
        expect(expandCompact(compact)).toEqual({
            kind: "option",
            inner: { kind: "basic", name: "Int" },
        });
    });

    it("expands result type", () => {
        const compact = {
            k: "res",
            ok: { k: "b", n: "Int" },
            er: { k: "b", n: "String" },
        };
        expect(expandCompact(compact)).toEqual({
            kind: "result",
            ok: { kind: "basic", name: "Int" },
            err: { kind: "basic", name: "String" },
        });
    });

    it("expands function type", () => {
        const compact = {
            k: "ft",
            ps: [{ k: "b", n: "Int" }],
            fx: ["pure"],
            rt: { k: "b", n: "Bool" },
        };
        expect(expandCompact(compact)).toEqual({
            kind: "fn_type",
            params: [{ kind: "basic", name: "Int" }],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Bool" },
        });
    });

    it("expands named type", () => {
        const compact = { k: "n", n: "Point" };
        expect(expandCompact(compact)).toEqual({ kind: "named", name: "Point" });
    });
});

// =============================================================================
// expandCompact — pattern kinds
// =============================================================================

describe("expandCompact — patterns", () => {
    it("expands wildcard pattern", () => {
        expect(expandCompact({ k: "w" })).toEqual({ kind: "wildcard" });
    });

    it("expands binding pattern", () => {
        expect(expandCompact({ k: "bd", n: "x" })).toEqual({ kind: "binding", name: "x" });
    });

    it("expands literal pattern", () => {
        expect(expandCompact({ k: "lp", v: 42 })).toEqual({ kind: "literal_pattern", value: 42 });
    });

    it("expands constructor pattern", () => {
        const compact = { k: "ct", n: "Some", fs: [{ k: "bd", n: "val" }] };
        expect(expandCompact(compact)).toEqual({
            kind: "constructor",
            name: "Some",
            fields: [{ kind: "binding", name: "val" }],
        });
    });
});

// =============================================================================
// expandCompact — full Hello World roundtrip
// =============================================================================

describe("expandCompact — Hello World roundtrip", () => {
    it("compact hello world expands to canonical full format", () => {
        const compactHello = {
            k: "mod",
            i: "mod-hello-001",
            n: "hello",
            im: [],
            ds: [
                {
                    k: "fn",
                    i: "fn-main-001",
                    n: "main",
                    ps: [],
                    rt: { k: "b", n: "Int" },
                    fx: ["io"],
                    ct: [],
                    b: [
                        {
                            k: "c",
                            i: "call-print-001",
                            fn: { k: "id", i: "ident-print-001", n: "print" },
                            as: [{ k: "lit", i: "lit-hello-001", v: "Hello, World!" }],
                        },
                        { k: "lit", i: "lit-zero-001", v: 0 },
                    ],
                },
            ],
        };

        const fullHello = loadExample("hello");
        const expanded = expandCompact(compactHello);
        expect(expanded).toEqual(fullHello);
    });
});

// =============================================================================
// expandCompact — nested deep structures
// =============================================================================

describe("expandCompact — nested structures", () => {
    it("expands match expression with arms and constructor patterns", () => {
        const compact = {
            k: "m",
            i: "m1",
            tg: { k: "id", i: "i1", n: "opt" },
            am: [
                {
                    k: "a",
                    i: "a1",
                    pt: { k: "ct", n: "Some", fs: [{ k: "bd", n: "val" }] },
                    b: [{ k: "id", i: "i2", n: "val" }],
                },
                {
                    k: "a",
                    i: "a2",
                    pt: { k: "w" },
                    b: [{ k: "lit", i: "l1", v: 0 }],
                },
            ],
        };

        const expected = {
            kind: "match",
            id: "m1",
            target: { kind: "ident", id: "i1", name: "opt" },
            arms: [
                {
                    kind: "arm",
                    id: "a1",
                    pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "val" }] },
                    body: [{ kind: "ident", id: "i2", name: "val" }],
                },
                {
                    kind: "arm",
                    id: "a2",
                    pattern: { kind: "wildcard" },
                    body: [{ kind: "literal", id: "l1", value: 0 }],
                },
            ],
        };
        expect(expandCompact(compact)).toEqual(expected);
    });

    it("expands enum constructor with field inits", () => {
        const compact = {
            k: "ec",
            i: "ec1",
            en: "Option",
            vr: "Some",
            fs: [{ k: "fi", n: "value", v: { k: "lit", i: "l1", v: 42 } }],
        };
        const expected = {
            kind: "enum_constructor",
            id: "ec1",
            enumName: "Option",
            variant: "Some",
            fields: [{ kind: "field_init", name: "value", value: { kind: "literal", id: "l1", value: 42 } }],
        };
        expect(expandCompact(compact)).toEqual(expected);
    });

    it("expands record definition with fields", () => {
        const compact = {
            k: "rec",
            i: "r1",
            n: "Point",
            fs: [
                { k: "f", i: "f1", n: "x", t: { k: "b", n: "Int" } },
                { k: "f", i: "f2", n: "y", t: { k: "b", n: "Int" } },
            ],
        };
        const expected = {
            kind: "record",
            id: "r1",
            name: "Point",
            fields: [
                { kind: "field", id: "f1", name: "x", type: { kind: "basic", name: "Int" } },
                { kind: "field", id: "f2", name: "y", type: { kind: "basic", name: "Int" } },
            ],
        };
        expect(expandCompact(compact)).toEqual(expected);
    });
});

// =============================================================================
// E2E: compact AST through compile + run pipeline
// =============================================================================

describe("E2E — compact AST through pipeline", () => {
    it("compact hello world compiles and runs", async () => {
        const compactHello = {
            k: "mod",
            i: "mod-hello-001",
            n: "hello",
            im: [],
            ds: [
                {
                    k: "fn",
                    i: "fn-main-001",
                    n: "main",
                    ps: [],
                    rt: { k: "b", n: "Int" },
                    fx: ["io"],
                    ct: [],
                    b: [
                        {
                            k: "c",
                            i: "call-print-001",
                            fn: { k: "id", i: "ident-print-001", n: "print" },
                            as: [{ k: "lit", i: "lit-hello-001", v: "Hello, World!" }],
                        },
                        { k: "lit", i: "lit-zero-001", v: 0 },
                    ],
                },
            ],
        };

        const compileResult = await handleCompile(compactHello);
        expect(compileResult.ok).toBe(true);
        expect(compileResult.wasm).toBeDefined();

        const wasmBytes = new Uint8Array(Buffer.from(compileResult.wasm!, "base64"));
        const runResult = await runDirect(wasmBytes);
        expect(runResult.exitCode).toBe(0);
        expect(runResult.output).toContain("Hello, World!");
    });

    it("compact arithmetic program compiles and returns correct result", async () => {
        const compactArith = {
            k: "mod",
            i: "mod-arith-001",
            n: "arith",
            im: [],
            ds: [
                {
                    k: "fn",
                    i: "fn-main-001",
                    n: "main",
                    ps: [],
                    rt: { k: "b", n: "Int" },
                    fx: ["pure"],
                    ct: [],
                    b: [
                        {
                            k: "bin",
                            i: "b1",
                            op: "+",
                            l: { k: "lit", i: "l1", v: 3 },
                            r: { k: "lit", i: "l2", v: 4 },
                        },
                    ],
                },
            ],
        };

        const compileResult = await handleCompile(compactArith);
        expect(compileResult.ok).toBe(true);

        const wasmBytes = new Uint8Array(Buffer.from(compileResult.wasm!, "base64"));
        const runResult = await runDirect(wasmBytes);
        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(7);
    });

    it("compact validate works", () => {
        const compact = {
            k: "mod",
            i: "m1",
            n: "test",
            im: [],
            ds: [
                {
                    k: "fn",
                    i: "fn1",
                    n: "main",
                    ps: [],
                    fx: ["pure"],
                    rt: { k: "b", n: "Int" },
                    ct: [],
                    b: [{ k: "lit", i: "l1", v: 0 }],
                },
            ],
        };

        const result = handleValidate(compact);
        expect(result.ok).toBe(true);
    });

    it("compact lint works", () => {
        const compact = {
            k: "mod",
            i: "m1",
            n: "test",
            im: [],
            ds: [
                {
                    k: "fn",
                    i: "fn1",
                    n: "main",
                    ps: [],
                    fx: ["pure"],
                    rt: { k: "b", n: "Int" },
                    ct: [],
                    b: [{ k: "lit", i: "l1", v: 0 }],
                },
            ],
        };

        const result = handleLint(compact);
        expect(result.ok).toBe(true);
    });
});

// =============================================================================
// Token reduction measurement
// =============================================================================

describe("token reduction measurement", () => {
    it("compact format is significantly smaller than full format", () => {
        const fullHello = loadExample("hello");
        const compactHello = {
            k: "mod",
            i: "mod-hello-001",
            n: "hello",
            im: [],
            ds: [
                {
                    k: "fn",
                    i: "fn-main-001",
                    n: "main",
                    ps: [],
                    rt: { k: "b", n: "Int" },
                    fx: ["io"],
                    ct: [],
                    b: [
                        {
                            k: "c",
                            i: "call-print-001",
                            fn: { k: "id", i: "ident-print-001", n: "print" },
                            as: [{ k: "lit", i: "lit-hello-001", v: "Hello, World!" }],
                        },
                        { k: "lit", i: "lit-zero-001", v: 0 },
                    ],
                },
            ],
        };

        const fullChars = JSON.stringify(fullHello).length;
        const compactChars = JSON.stringify(compactHello).length;
        const reduction = ((fullChars - compactChars) / fullChars) * 100;

        // Hello world is small — IDs and string values dominate.
        // On larger programs, reduction is typically 40-60%.
        // Here we expect at least 20% on this tiny program.
        expect(reduction).toBeGreaterThan(20);
    });
});

// =============================================================================
// handleSchema compact format
// =============================================================================

describe("handleSchema compact format", () => {
    it("returns compact reference with kind and key maps", () => {
        const result = handleSchema("compact");
        expect(result.format).toBe("compact");
        expect(result.tokenEstimate).toBeGreaterThan(0);

        const schema = result.schema as { kindMap: Record<string, string>; keyMap: Record<string, string> };
        expect(schema.kindMap).toBeDefined();
        expect(schema.keyMap).toBeDefined();
        expect(schema.kindMap.lit).toBe("literal");
        expect(schema.keyMap.k).toBe("kind");
    });
});

// =============================================================================
// handleVersion reports compactAst
// =============================================================================

describe("handleVersion compactAst feature", () => {
    it("reports compactAst as true", () => {
        const result = handleVersion();
        expect(result.features.compactAst).toBe(true);
    });
});

// =============================================================================
// compactSchemaReference
// =============================================================================

describe("compactSchemaReference", () => {
    it("returns complete kind and key maps", () => {
        const ref = compactSchemaReference();
        expect(ref.kindMap).toEqual(KIND_MAP);
        expect(ref.keyMap).toEqual(KEY_MAP);
        expect(ref.description).toContain("Compact AST");
    });
});
