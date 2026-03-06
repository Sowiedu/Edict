import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression } from "../../src/ast/nodes.js";
import type { TypeExpr } from "../../src/ast/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INT64: TypeExpr = { kind: "basic", name: "Int64" };
const INT: TypeExpr = { kind: "basic", name: "Int" };
const FLOAT: TypeExpr = { kind: "basic", name: "Float" };
const STRING: TypeExpr = { kind: "basic", name: "String" };

function mkLiteral(value: number | string | boolean, id = "l-1", type?: TypeExpr): Expression {
    return type ? { kind: "literal", id, value, type } : { kind: "literal", id, value };
}

function mkInt64(value: string | number, id = "l-1"): Expression {
    return { kind: "literal", id, value: typeof value === "number" ? value : value, type: INT64 };
}

function mkFn(
    name: string,
    body: Expression[],
    overrides: Partial<FunctionDef> = {},
): FunctionDef {
    return {
        kind: "fn",
        id: `fn-${name}`,
        name,
        params: [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [],
        body,
        ...overrides,
    };
}

function mkModule(
    defs: EdictModule["definitions"],
    imports: EdictModule["imports"] = [],
): EdictModule {
    return {
        kind: "module",
        id: "mod-test",
        name: "test",
        imports,
        definitions: defs,
    };
}

async function compileAndRun(mod: EdictModule) {
    const compiled = compile(mod);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("compile failed: " + JSON.stringify(compiled.errors));
    return runDirect(compiled.wasm, "main");
}

function mkCall(fn: string, args: Expression[], id = "c-1"): Expression {
    return {
        kind: "call", id,
        fn: { kind: "ident", id: `i-${fn}`, name: fn },
        args,
    };
}

// ---------------------------------------------------------------------------
// Tests — Int64 literals
// ---------------------------------------------------------------------------

describe("Int64 literals", () => {
    it("small positive Int64 value (42)", async () => {
        const mod = mkModule([
            mkFn("main", [
                // Convert Int64 to Int for return
                mkCall("int64ToInt", [mkInt64(42)]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(42);
    });

    it("string-encoded large Int64 value", async () => {
        // Value beyond i32 range but within i64
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-big", name: "big",
                    type: INT64,
                    value: mkInt64("5000000000"), // > 2^32
                },
                // Verify it's greater than max i32 by checking int64ToInt wraps
                mkCall("int64ToInt", [{ kind: "ident", id: "i-big", name: "big" }]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        // 5000000000 truncated to i32 signed: 5000000000 - 2^32 = 705032704
        expect(result.returnValue).toBe(705032704);
    });

    it("negative Int64 value (-1)", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [mkInt64(-1)]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(-1);
    });

    it("zero Int64 value", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [mkInt64(0)]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests — Int64 arithmetic
// ---------------------------------------------------------------------------

describe("Int64 arithmetic", () => {
    it("addition", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    {
                        kind: "binop", id: "b-add", op: "+",
                        left: mkInt64(10, "l-a"),
                        right: mkInt64(20, "l-b"),
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(30);
    });

    it("subtraction", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    {
                        kind: "binop", id: "b-sub", op: "-",
                        left: mkInt64(50, "l-a"),
                        right: mkInt64(20, "l-b"),
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(30);
    });

    it("multiplication", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    {
                        kind: "binop", id: "b-mul", op: "*",
                        left: mkInt64(6, "l-a"),
                        right: mkInt64(7, "l-b"),
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(42);
    });

    it("division", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    {
                        kind: "binop", id: "b-div", op: "/",
                        left: mkInt64(100, "l-a"),
                        right: mkInt64(4, "l-b"),
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(25);
    });

    it("modulo", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    {
                        kind: "binop", id: "b-mod", op: "%",
                        left: mkInt64(17, "l-a"),
                        right: mkInt64(5, "l-b"),
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(2);
    });

    it("negation (unary minus)", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    {
                        kind: "unop", id: "u-neg", op: "-",
                        operand: mkInt64(42),
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(-42);
    });
});

// ---------------------------------------------------------------------------
// Tests — Int64 comparisons
// ---------------------------------------------------------------------------

describe("Int64 comparisons", () => {
    it("equal (==) returns Bool (i32)", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-eq", op: "==",
                    left: mkInt64(42, "l-a"),
                    right: mkInt64(42, "l-b"),
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("not equal (!=)", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-ne", op: "!=",
                    left: mkInt64(42, "l-a"),
                    right: mkInt64(99, "l-b"),
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("less than (<)", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-lt", op: "<",
                    left: mkInt64(10, "l-a"),
                    right: mkInt64(20, "l-b"),
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("greater than (>)", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-gt", op: ">",
                    left: mkInt64(20, "l-a"),
                    right: mkInt64(10, "l-b"),
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tests — Conversion builtins
// ---------------------------------------------------------------------------

describe("Int64 conversion builtins", () => {
    it("intToInt64 widens correctly", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("intToInt64", [mkLiteral(99, "l-99")], "c-widen"),
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(99);
    });

    it("int64ToFloat converts correctly", async () => {
        const mod = mkModule([
            mkFn("main", [
                // floor(int64ToFloat(42L)) should be 42
                mkCall("floor", [
                    mkCall("int64ToFloat", [mkInt64(42)], "c-to-f"),
                ], "c-floor"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(42);
    });

    it("int64ToString converts correctly", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s",
                    type: STRING,
                    value: mkCall("int64ToString", [mkInt64(12345)], "c-to-s"),
                },
                mkCall("string_length", [
                    { kind: "ident", id: "i-s", name: "s" },
                ], "c-len"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        // "12345" has 5 characters
        expect(result.returnValue).toBe(5);
    });

    it("int64ToString prints large value", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s",
                    type: STRING,
                    value: mkCall("int64ToString", [mkInt64("1000000000000")], "c-to-s"),
                },
                {
                    kind: "let", id: "let-p", name: "_p",
                    type: STRING,
                    value: mkCall("print", [
                        { kind: "ident", id: "i-s", name: "s" },
                    ], "c-print"),
                },
                mkLiteral(0, "l-0"),
            ], { effects: ["io"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.output).toBe("1000000000000");
    });
});

// ---------------------------------------------------------------------------
// Tests — Let bindings with Int64
// ---------------------------------------------------------------------------

describe("Int64 let bindings", () => {
    it("let binding with Int64 type", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-x", name: "x",
                    type: INT64,
                    value: mkInt64(100),
                },
                mkCall("int64ToInt", [
                    { kind: "ident", id: "i-x", name: "x" },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(100);
    });

    it("Int64 arithmetic through let bindings", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-a", name: "a",
                    type: INT64,
                    value: mkInt64(30, "l-30"),
                },
                {
                    kind: "let", id: "let-b", name: "b",
                    type: INT64,
                    value: mkInt64(12, "l-12"),
                },
                mkCall("int64ToInt", [
                    {
                        kind: "binop", id: "b-add", op: "+",
                        left: { kind: "ident", id: "i-a", name: "a" },
                        right: { kind: "ident", id: "i-b", name: "b" },
                    },
                ]),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(42);
    });
});

// ---------------------------------------------------------------------------
// Tests — Compilation pipeline
// ---------------------------------------------------------------------------

describe("Int64 — compilation pipeline", () => {
    it("Int64 literal compiles without errors", () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [mkInt64(42)]),
            ]),
        ]);
        const compiled = compile(mod);
        expect(compiled.ok).toBe(true);
    });

    it("Int64 const compiles as global", () => {
        const mod = mkModule([
            {
                kind: "const" as const,
                id: "const-big",
                name: "BIG",
                type: INT64,
                value: mkInt64("999999999999"),
            },
            mkFn("main", [
                mkCall("int64ToInt", [
                    { kind: "ident", id: "i-big", name: "BIG" },
                ]),
            ]),
        ]);
        const compiled = compile(mod);
        expect(compiled.ok).toBe(true);
    });
});
