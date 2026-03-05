import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import { runDirect } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers (same pattern as runner.test.ts)
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
    if (!compiled.ok) throw new Error("compile failed");
    return runDirect(compiled.wasm, "main");
}

// ---------------------------------------------------------------------------
// Option construction helpers
// ---------------------------------------------------------------------------

function mkSome(value: Expression, id = "ec-some"): Expression {
    return {
        kind: "enum_constructor",
        id,
        enumName: "Option",
        variant: "Some",
        fields: [{ kind: "field_init", name: "value", value }],
    };
}

function mkNone(id = "ec-none"): Expression {
    return {
        kind: "enum_constructor",
        id,
        enumName: "Option",
        variant: "None",
        fields: [],
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Option runtime — construction", () => {
    it("Some(42) returns a valid heap pointer", async () => {
        const mod = mkModule([
            mkFn("main", [mkSome(mkLiteral(42, "l-v"))]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBeGreaterThan(0);
    });

    it("None returns a valid heap pointer", async () => {
        const mod = mkModule([
            mkFn("main", [mkNone()]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBeGreaterThan(0);
    });
});

describe("Option runtime — match", () => {
    it("matches Some and extracts the value", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-opt", name: "opt",
                    type: { kind: "named", name: "Option" },
                    value: mkSome(mkLiteral(42, "l-v")),
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-opt", name: "opt" },
                    arms: [
                        {
                            id: "arm-some",
                            pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "val" }] },
                            body: [{ kind: "ident", id: "i-val", name: "val" }],
                        },
                        {
                            id: "arm-none",
                            pattern: { kind: "constructor", name: "None", fields: [] },
                            body: [mkLiteral(0, "l-0")],
                        },
                    ],
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(42);
    });

    it("matches None and returns default", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-opt", name: "opt",
                    type: { kind: "named", name: "Option" },
                    value: mkNone(),
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-opt", name: "opt" },
                    arms: [
                        {
                            id: "arm-some",
                            pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "val" }] },
                            body: [{ kind: "ident", id: "i-val", name: "val" }],
                        },
                        {
                            id: "arm-none",
                            pattern: { kind: "constructor", name: "None", fields: [] },
                            body: [mkLiteral(-1, "l-neg")],
                        },
                    ],
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(-1);
    });

    it("match with wildcard on Option", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-opt", name: "opt",
                    type: { kind: "named", name: "Option" },
                    value: mkSome(mkLiteral(10, "l-10")),
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-opt", name: "opt" },
                    arms: [
                        {
                            id: "arm-some",
                            pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "val" }] },
                            body: [{ kind: "ident", id: "i-val", name: "val" }],
                        },
                        {
                            id: "arm-wild",
                            pattern: { kind: "wildcard" },
                            body: [mkLiteral(0, "l-0")],
                        },
                    ],
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(10);
    });
});

describe("Option runtime — utility builtins", () => {
    it("isSome(Some(42)) returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-isSome", name: "isSome" },
                    args: [mkSome(mkLiteral(42, "l-v"))],
                },
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("isSome(None) returns 0", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-isSome", name: "isSome" },
                    args: [mkNone()],
                },
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(0);
    });

    it("isNone(None) returns 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-isNone", name: "isNone" },
                    args: [mkNone()],
                },
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("isNone(Some(42)) returns 0", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-isNone", name: "isNone" },
                    args: [mkSome(mkLiteral(42, "l-v"))],
                },
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(0);
    });

    it("unwrapOr(Some(42), 0) returns 42", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-unwrapOr", name: "unwrapOr" },
                    args: [mkSome(mkLiteral(42, "l-v")), mkLiteral(0, "l-def")],
                },
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(42);
    });

    it("unwrapOr(None, 99) returns 99", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-unwrapOr", name: "unwrapOr" },
                    args: [mkNone(), mkLiteral(99, "l-def")],
                },
            ], { effects: ["pure"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(99);
    });

    it("unwrap(Some(42)) returns 42", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-unwrap", name: "unwrap" },
                    args: [mkSome(mkLiteral(42, "l-v"))],
                },
            ], { effects: ["fails"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(42);
    });

    it("unwrap(None) traps with exitCode 1", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-unwrap", name: "unwrap" },
                    args: [mkNone()],
                },
            ], { effects: ["fails"] }),
        ]);
        const result = await compileAndRun(mod);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("unwrap called on None");
    });
});

describe("Option runtime — function return", () => {
    it("function returns Some via enum_constructor", async () => {
        const mod = mkModule([
            mkFn("wrapValue", [
                mkSome({ kind: "ident", id: "i-x", name: "x" }, "ec-wrap"),
            ], {
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                returnType: { kind: "named", name: "Option" },
            }),
            mkFn("main", [
                {
                    kind: "let", id: "let-opt", name: "opt",
                    type: { kind: "named", name: "Option" },
                    value: {
                        kind: "call", id: "c-wrap",
                        fn: { kind: "ident", id: "i-wrap", name: "wrapValue" },
                        args: [mkLiteral(77, "l-77")],
                    },
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-opt", name: "opt" },
                    arms: [
                        {
                            id: "arm-some",
                            pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "v" }] },
                            body: [{ kind: "ident", id: "i-v", name: "v" }],
                        },
                        {
                            id: "arm-none",
                            pattern: { kind: "constructor", name: "None", fields: [] },
                            body: [mkLiteral(0, "l-0")],
                        },
                    ],
                },
            ]),
        ]);
        const result = await compileAndRun(mod);
        expect(result.returnValue).toBe(77);
    });
});
