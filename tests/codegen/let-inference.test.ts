import { describe, it, expect } from "vitest";
import { check } from "../../src/check.js";
import { compile } from "../../src/codegen/codegen.js";
import { run } from "../../src/codegen/runner.js";
import type { EdictModule, FunctionDef, Expression, Definition } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkModule(
    defs: Definition[],
    imports: EdictModule["imports"] = [],
): EdictModule {
    return {
        kind: "module", id: "mod-test", name: "test",
        imports, definitions: defs,
    };
}

function mkFn(
    name: string,
    body: Expression[],
    overrides: Partial<FunctionDef> = {},
): FunctionDef {
    return {
        kind: "fn", id: `fn-${name}`, name,
        params: [], effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: [], body,
        ...overrides,
    };
}

/** Check + compile + run a module, asserting success at each step. */
async function checkCompileRun(mod: EdictModule) {
    const checkResult = await check(mod);
    expect(checkResult.ok, `check failed: ${JSON.stringify(checkResult.errors)}`).toBe(true);

    const compiled = compile(mod, { typeInfo: checkResult.typeInfo });
    expect(compiled.ok, `compile failed: ${JSON.stringify((compiled as any).errors)}`).toBe(true);
    if (!compiled.ok) throw new Error("compile failed");

    return run(compiled.wasm);
}

// ---------------------------------------------------------------------------
// Let binding type inference — E2E tests
// ---------------------------------------------------------------------------

describe("let binding type inference — Int", () => {
    it("infers Int from integer literal", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-x", name: "x", value: { kind: "literal", id: "l-1", value: 42 } },
                { kind: "ident", id: "i-x", name: "x" },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(42);
    });

    it("infers Int from arithmetic expression", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-a", name: "a", value: { kind: "literal", id: "l-a", value: 10 } },
                { kind: "let", id: "let-b", name: "b", value: { kind: "literal", id: "l-b", value: 20 } },
                {
                    kind: "let", id: "let-c", name: "c", value: {
                        kind: "binop", id: "b-1", op: "+",
                        left: { kind: "ident", id: "i-a", name: "a" },
                        right: { kind: "ident", id: "i-b", name: "b" },
                    }
                },
                { kind: "ident", id: "i-c", name: "c" },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(30);
    });

    it("infers Int from function call result", async () => {
        const mod = mkModule([
            mkFn("double", [{
                kind: "binop", id: "b-1", op: "*",
                left: { kind: "ident", id: "i-n", name: "n" },
                right: { kind: "literal", id: "l-2", value: 2 },
            }], {
                params: [{ kind: "param", id: "p-n", name: "n", type: { kind: "basic", name: "Int" } }],
            }),
            mkFn("main", [
                {
                    kind: "let", id: "let-r", name: "r", value: {
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-dbl", name: "double" },
                        args: [{ kind: "literal", id: "l-5", value: 5 }],
                    }
                },
                { kind: "ident", id: "i-r", name: "r" },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(10);
    });
});

describe("let binding type inference — Float", () => {
    it("infers Float from float literal", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-f", name: "f", value: { kind: "literal", id: "l-f", value: 3.14 } },
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: { kind: "ident", id: "i-f", name: "f" },
                    right: { kind: "literal", id: "l-1", value: 1.5 },
                },
            ], { returnType: { kind: "basic", name: "Float" } }),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBeCloseTo(4.64);
    });

    it("infers Float from float arithmetic", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-a", name: "a", value: { kind: "literal", id: "l-a", value: 2.5 } },
                { kind: "let", id: "let-b", name: "b", value: { kind: "literal", id: "l-b", value: 3.5 } },
                {
                    kind: "let", id: "let-c", name: "c", value: {
                        kind: "binop", id: "b-1", op: "*",
                        left: { kind: "ident", id: "i-a", name: "a" },
                        right: { kind: "ident", id: "i-b", name: "b" },
                    }
                },
                { kind: "ident", id: "i-c", name: "c" },
            ], { returnType: { kind: "basic", name: "Float" } }),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBeCloseTo(8.75);
    });
});

describe("let binding type inference — Bool", () => {
    it("infers Bool from boolean literal", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-b", name: "flag", value: { kind: "literal", id: "l-b", value: true } },
                {
                    kind: "if", id: "if-1",
                    condition: { kind: "ident", id: "i-flag", name: "flag" },
                    then: [{ kind: "literal", id: "l-1", value: 1 }],
                    else: [{ kind: "literal", id: "l-0", value: 0 }],
                },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(1);
    });

    it("infers Bool from comparison", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-cmp", name: "isPositive", value: {
                        kind: "binop", id: "b-1", op: ">",
                        left: { kind: "literal", id: "l-5", value: 5 },
                        right: { kind: "literal", id: "l-0", value: 0 },
                    }
                },
                {
                    kind: "if", id: "if-1",
                    condition: { kind: "ident", id: "i-cmp", name: "isPositive" },
                    then: [{ kind: "literal", id: "l-yes", value: 42 }],
                    else: [{ kind: "literal", id: "l-no", value: 0 }],
                },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(42);
    });
});

describe("let binding type inference — String", () => {
    it("infers String from string literal and uses in print", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-msg", name: "msg", value: { kind: "literal", id: "l-msg", value: "hello" } },
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-print", name: "print" },
                    args: [{ kind: "ident", id: "i-msg", name: "msg" }],
                },
                { kind: "literal", id: "l-ret", value: 0 },
            ], { effects: ["io"] }),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.output).toBe("hello");
    });
});

describe("let binding type inference — records and enums", () => {
    it("infers record type from record_expr", async () => {
        const mod = mkModule([
            {
                kind: "record", id: "r-1", name: "Point",
                fields: [
                    { kind: "field", id: "f-x", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
            mkFn("main", [
                {
                    kind: "let", id: "let-p", name: "p", value: {
                        kind: "record_expr", id: "re-1", name: "Point",
                        fields: [
                            { kind: "field_init", name: "x", value: { kind: "literal", id: "l-x", value: 10 } },
                            { kind: "field_init", name: "y", value: { kind: "literal", id: "l-y", value: 20 } },
                        ],
                    }
                },
                { kind: "access", id: "acc-x", target: { kind: "ident", id: "i-p", name: "p" }, field: "x" },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(10);
    });

    it("infers record type and accesses multiple fields", async () => {
        const mod = mkModule([
            {
                kind: "record", id: "r-1", name: "Pair",
                fields: [
                    { kind: "field", id: "f-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            },
            mkFn("main", [
                {
                    kind: "let", id: "let-p", name: "p", value: {
                        kind: "record_expr", id: "re-1", name: "Pair",
                        fields: [
                            { kind: "field_init", name: "a", value: { kind: "literal", id: "l-a", value: 3 } },
                            { kind: "field_init", name: "b", value: { kind: "literal", id: "l-b", value: 7 } },
                        ],
                    }
                },
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: { kind: "access", id: "acc-a", target: { kind: "ident", id: "i-p1", name: "p" }, field: "a" },
                    right: { kind: "access", id: "acc-b", target: { kind: "ident", id: "i-p2", name: "p" }, field: "b" },
                },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(10);
    });

    it("infers enum type from enum_constructor", async () => {
        const mod = mkModule([
            {
                kind: "enum", id: "e-1", name: "Shape",
                variants: [
                    { kind: "variant", id: "v-1", name: "Circle", fields: [{ kind: "field", id: "f-r", name: "radius", type: { kind: "basic", name: "Int" } }] },
                    { kind: "variant", id: "v-2", name: "Square", fields: [{ kind: "field", id: "f-s", name: "side", type: { kind: "basic", name: "Int" } }] },
                ],
            },
            mkFn("main", [
                {
                    kind: "let", id: "let-s", name: "s", value: {
                        kind: "enum_constructor", id: "ec-1",
                        enumName: "Shape", variant: "Circle",
                        fields: [{ kind: "field_init", name: "radius", value: { kind: "literal", id: "l-r", value: 5 } }],
                    }
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-s", name: "s" },
                    arms: [
                        {
                            kind: "arm", id: "a-1",
                            pattern: { kind: "constructor", name: "Circle", fields: [{ kind: "binding", name: "r" }] },
                            body: [{ kind: "ident", id: "i-r", name: "r" }],
                        },
                        {
                            kind: "arm", id: "a-2",
                            pattern: { kind: "wildcard" },
                            body: [{ kind: "literal", id: "l-0", value: 0 }],
                        },
                    ],
                },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(5);
    });
});

describe("let binding type inference — chained and nested", () => {
    it("chains inferred lets through multiple bindings", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-a", name: "a", value: { kind: "literal", id: "l-a", value: 5 } },
                {
                    kind: "let", id: "let-b", name: "b", value: {
                        kind: "binop", id: "b-1", op: "+",
                        left: { kind: "ident", id: "i-a", name: "a" },
                        right: { kind: "literal", id: "l-10", value: 10 },
                    }
                },
                {
                    kind: "let", id: "let-c", name: "c", value: {
                        kind: "binop", id: "b-2", op: "*",
                        left: { kind: "ident", id: "i-b", name: "b" },
                        right: { kind: "literal", id: "l-2", value: 2 },
                    }
                },
                { kind: "ident", id: "i-c", name: "c" },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(30); // (5+10)*2
    });

    it("infers in block expression", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "block", id: "blk-1",
                    body: [
                        { kind: "let", id: "let-x", name: "x", value: { kind: "literal", id: "l-x", value: 7 } },
                        {
                            kind: "binop", id: "b-1", op: "+",
                            left: { kind: "ident", id: "i-x", name: "x" },
                            right: { kind: "literal", id: "l-3", value: 3 },
                        },
                    ],
                },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(10);
    });
});

describe("let binding type inference — explicit type still checked", () => {
    it("explicit type annotation is still validated against value", async () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-x", name: "x",
                    type: { kind: "basic", name: "Int" },
                    value: { kind: "literal", id: "l-bad", value: "not an int" },
                },
                { kind: "ident", id: "i-x", name: "x" },
            ]),
        ]);
        const checkResult = await check(mod);
        expect(checkResult.ok).toBe(false);
        expect(checkResult.errors.some(e => e.error === "type_mismatch")).toBe(true);
    });
});

describe("let binding type inference — return type inference combo", () => {
    it("infers both let type and return type", async () => {
        const mod = mkModule([
            mkFn("main", [
                { kind: "let", id: "let-x", name: "x", value: { kind: "literal", id: "l-x", value: 42 } },
                { kind: "ident", id: "i-x", name: "x" },
            ]),
        ]);
        const result = await checkCompileRun(mod);
        expect(result.returnValue).toBe(42);
    });
});
