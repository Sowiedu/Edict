import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkLiteral(value: number | string | boolean, id = "l-1"): Expression {
    return { kind: "literal", id, value };
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
        effects: ["reads"],
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
    if (!compiled.ok) throw new Error("compile failed");
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
// Tests — now
// ---------------------------------------------------------------------------

describe("now builtin", () => {
    it("compiles and runs successfully", async () => {
        // now() returns Int64, convert to Int for return
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [mkCall("now", [], "c-now")], "c-conv"),
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        // int64ToInt truncates epoch millis to i32 — may overflow to negative.
        // Just verify it ran successfully and returned a number.
        expect(result.returnValue).toBeDefined();
        expect(typeof result.returnValue).toBe("number");
    });

    it("compiles without errors", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [mkCall("now", [], "c-now")], "c-conv"),
            ]),
        ]);
        const compiled = compile(mod);
        expect(compiled.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Tests — formatDate
// ---------------------------------------------------------------------------

describe("formatDate builtin", () => {
    it("formats epoch 0 as 1970-01-01", async () => {
        // formatDate(intToInt64(0), "%Y-%m-%d")
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("formatDate", [
                        mkCall("intToInt64", [mkLiteral(0, "l-0")], "c-conv"),
                        mkLiteral("%Y-%m-%d", "l-fmt"),
                    ], "c-fmt"),
                },
                mkCall("string_length", [
                    { kind: "ident", id: "i-s", name: "s" },
                ], "c-len"),
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        // "1970-01-01" is 10 characters
        expect(result.returnValue).toBe(10);
    });

    it("formats and prints a known date", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("formatDate", [
                        mkCall("intToInt64", [mkLiteral(0, "l-0")], "c-conv"),
                        mkLiteral("%Y-%m-%d", "l-fmt"),
                    ], "c-fmt"),
                },
                {
                    kind: "let", id: "let-p", name: "_p",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("print", [
                        { kind: "ident", id: "i-s", name: "s" },
                    ], "c-print"),
                },
                mkLiteral(0, "l-ret"),
            ], { effects: ["pure", "io"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe("1970-01-01");
    });

    it("formats time components correctly", async () => {
        // 1000 * 60 * 60 * 12 + 1000 * 60 * 30 + 1000 * 45 = 45045000 ms
        // = 12:30:45 UTC
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("formatDate", [
                        mkCall("intToInt64", [mkLiteral(45045000, "l-ts")], "c-conv"),
                        mkLiteral("%H:%M:%S", "l-fmt"),
                    ], "c-fmt"),
                },
                {
                    kind: "let", id: "let-p", name: "_p",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("print", [
                        { kind: "ident", id: "i-s", name: "s" },
                    ], "c-print"),
                },
                mkLiteral(0, "l-ret"),
            ], { effects: ["pure", "io"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe("12:30:45");
    });

    it("handles literal percent in format", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("formatDate", [
                        mkCall("intToInt64", [mkLiteral(0, "l-0")], "c-conv"),
                        mkLiteral("100%%", "l-fmt"),
                    ], "c-fmt"),
                },
                {
                    kind: "let", id: "let-p", name: "_p",
                    type: { kind: "basic", name: "String" },
                    value: mkCall("print", [
                        { kind: "ident", id: "i-s", name: "s" },
                    ], "c-print"),
                },
                mkLiteral(0, "l-ret"),
            ], { effects: ["pure", "io"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe("100%");
    });
});

// ---------------------------------------------------------------------------
// Tests — parseDate
// ---------------------------------------------------------------------------

describe("parseDate builtin", () => {
    it("parses a valid ISO date string", async () => {
        // parseDate("1970-01-01T00:00:00Z", "") should return 0 as Int64
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("parseDate", [
                        mkLiteral("1970-01-01T00:00:00Z", "l-s"),
                        mkLiteral("", "l-fmt"),
                    ], "c-parse"),
                ], "c-conv"),
            ], { effects: ["fails"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(0);
    });

    it("parses a date with specific timestamp", async () => {
        // 2024-01-01T00:00:00Z is 1704067200000 ms from epoch
        // int64ToInt truncates to i32 — so we just verify no crash
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("parseDate", [
                        mkLiteral("2024-01-01T00:00:00Z", "l-s"),
                        mkLiteral("", "l-fmt"),
                    ], "c-parse"),
                ], "c-conv"),
            ], { effects: ["fails"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        // Value will be truncated, just verify it ran
        expect(result.returnValue).toBeDefined();
    });

    it("throws on invalid date string", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("parseDate", [
                        mkLiteral("not-a-date", "l-s"),
                        mkLiteral("", "l-fmt"),
                    ], "c-parse"),
                ], "c-conv"),
            ], { effects: ["fails"] }),
        ]);
        const result = await compileAndRun(mod);
        // Should fail at runtime
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("parseDate");
    });
});

// ---------------------------------------------------------------------------
// Tests — diffMs
// ---------------------------------------------------------------------------

describe("diffMs builtin", () => {
    it("computes difference of two timestamps", async () => {
        // diffMs(intToInt64(1000), intToInt64(300)) = 700
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("diffMs", [
                        mkCall("intToInt64", [mkLiteral(1000, "l-a")], "c-a"),
                        mkCall("intToInt64", [mkLiteral(300, "l-b")], "c-b"),
                    ], "c-diff"),
                ], "c-conv"),
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(700);
    });

    it("returns negative for reversed order", async () => {
        // diffMs(intToInt64(100), intToInt64(500)) = -400
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("diffMs", [
                        mkCall("intToInt64", [mkLiteral(100, "l-a")], "c-a"),
                        mkCall("intToInt64", [mkLiteral(500, "l-b")], "c-b"),
                    ], "c-diff"),
                ], "c-conv"),
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(-400);
    });

    it("returns zero for equal timestamps", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("diffMs", [
                        mkCall("intToInt64", [mkLiteral(42, "l-a")], "c-a"),
                        mkCall("intToInt64", [mkLiteral(42, "l-b")], "c-b"),
                    ], "c-diff"),
                ], "c-conv"),
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests — effect safety
// ---------------------------------------------------------------------------

describe("datetime builtins — effect safety", () => {
    it("now compiles when function has reads effect", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [mkCall("now", [], "c-now")], "c-conv"),
            ], { effects: ["reads"] }),
        ]);
        const compiled = compile(mod);
        expect(compiled.ok).toBe(true);
    });

    it("parseDate compiles when function has fails effect", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("parseDate", [
                        mkLiteral("2024-01-01", "l-s"),
                        mkLiteral("", "l-fmt"),
                    ], "c-parse"),
                ], "c-conv"),
            ], { effects: ["fails"] }),
        ]);
        const compiled = compile(mod);
        expect(compiled.ok).toBe(true);
    });

    it("diffMs compiles as pure", async () => {
        const mod = mkModule([
            mkFn("main", [
                mkCall("int64ToInt", [
                    mkCall("diffMs", [
                        mkCall("intToInt64", [mkLiteral(0, "l-a")], "c-a"),
                        mkCall("intToInt64", [mkLiteral(0, "l-b")], "c-b"),
                    ], "c-diff"),
                ], "c-conv"),
            ], { effects: ["pure"] }),
        ]);
        const compiled = compile(mod);
        expect(compiled.ok).toBe(true);
    });
});
