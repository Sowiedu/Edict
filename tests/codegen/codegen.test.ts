import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// NOTE: We call mod.optimize() in compile(), which constant-folds expressions.
// So tests assert valid WASM output (ok === true, binary exists), not specific
// WAT instructions since the optimizer transforms them. Behavioral correctness
// is tested in runner.test.ts.

describe("compile — success cases", () => {
    it("compiles a function returning integer literal", () => {
        const mod = mkModule([mkFn("main", [mkLiteral(42)])]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wasm).toBeInstanceOf(Uint8Array);
        expect(result.wasm.length).toBeGreaterThan(0);
        // Optimizer may fold but the constant should survive
        expect(result.wat).toContain("42");
    });

    it("compiles arithmetic binop to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: mkLiteral(10, "l-a"),
                    right: mkLiteral(20, "l-b"),
                },
            ]),
        ]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer constant-folds 10+20 → 30
        expect(result.wat).toContain("30");
    });

    it("compiles boolean literal as i32", () => {
        const mod = mkModule([mkFn("main", [mkLiteral(true)])]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("i32.const 1");
    });

    it("compiles if/else expression to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "if", id: "if-1",
                    condition: mkLiteral(true, "l-c"),
                    then: [mkLiteral(1, "l-t")],
                    else: [mkLiteral(0, "l-e")],
                },
            ]),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer may fold `if(true)` to just the then-branch value
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles let binding to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-1", name: "x",
                    value: mkLiteral(5, "l-v"),
                },
                { kind: "ident", id: "i-x", name: "x" },
            ]),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer may inline the let, but output should be valid
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles unary negation to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "unop", id: "u-1", op: "-",
                    operand: mkLiteral(7, "l-v"),
                },
            ]),
        ]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer folds 0-7 → -7
        expect(result.wat).toContain("-7");
    });

    it("compiles unary not to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "unop", id: "u-1", op: "not",
                    operand: mkLiteral(true, "l-v"),
                },
            ]),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer folds eqz(1) → 0
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("exports main function", () => {
        const mod = mkModule([mkFn("main", [mkLiteral(0)])]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("(export \"main\"");
    });

    it("compiles multi-expression body to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                mkLiteral(1, "l-1"),
                mkLiteral(2, "l-2"),
                mkLiteral(3, "l-3"),
            ]),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer may fold everything, but the key thing is it compiles
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles print builtin call with string literal", () => {
        const mod = mkModule([
            mkFn(
                "main",
                [
                    {
                        kind: "call", id: "c-1",
                        fn: { kind: "ident", id: "i-print", name: "print" },
                        args: [mkLiteral("hello", "l-s")],
                    },
                ],
                { effects: ["io"] },
            ),
        ]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("call $print");
    });

    it("compiles all comparison operators", () => {
        const ops = ["==", "!=", "<", ">", "<=", ">="] as const;
        for (const op of ops) {
            const mod = mkModule([
                mkFn("main", [
                    {
                        kind: "binop", id: "b-1", op,
                        left: mkLiteral(1, "l-a"),
                        right: mkLiteral(2, "l-b"),
                    },
                ]),
            ]);
            const result = compile(mod);
            expect(result.ok).toBe(true);
        }
    });

    it("compiles block expression", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "block", id: "blk-1",
                    body: [mkLiteral(99, "l-b")],
                },
            ]),
        ]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("99");
    });

    it("exports memory", () => {
        const mod = mkModule([mkFn("main", [mkLiteral(0)])]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("(export \"memory\"");
    });
});

describe("compile — edge cases", () => {
    it("compiles function with no body as nop", () => {
        const mod = mkModule([
            mkFn("main", [], { returnType: { kind: "unit_type" } }),
        ]);
        const result = compile(mod, { emitWat: true });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("nop");
    });

    it("compiles module with non-fn definitions (ignores them)", () => {
        const mod = mkModule([
            { kind: "record", id: "r-1", name: "Point", fields: [] },
            mkFn("main", [mkLiteral(0)]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });

    it("does not export non-main functions", () => {
        const mod = mkModule([mkFn("helper", [mkLiteral(0)])]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).not.toContain("(export \"helper\"");
    });
});

describe("compile — function parameters", () => {
    it("compiles single-param function", () => {
        const mod = mkModule([
            mkFn("identity", [{ kind: "ident", id: "i-x", name: "x" }], {
                params: [{
                    kind: "param", id: "p-x", name: "x",
                    type: { kind: "basic", name: "Int" },
                }],
            }),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles multi-param function", () => {
        const mod = mkModule([
            mkFn("add", [
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                },
            ], {
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles cross-function call with arguments", () => {
        const mod = mkModule([
            mkFn("add", [
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: { kind: "ident", id: "i-a", name: "a" },
                    right: { kind: "ident", id: "i-b", name: "b" },
                },
            ], {
                params: [
                    { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                    { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
                ],
            }),
            mkFn("main", [
                {
                    kind: "call", id: "c-1",
                    fn: { kind: "ident", id: "i-add", name: "add" },
                    args: [mkLiteral(1, "l-1"), mkLiteral(2, "l-2")],
                },
            ]),
        ]);
        const result = compile(mod);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Optimizer may inline add(1,2) → 3, so just verify valid WASM
        expect(result.wasm.length).toBeGreaterThan(0);
    });
});

describe("compile — match expressions", () => {
    it("compiles match with literal patterns to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-x", name: "x",
                    value: mkLiteral(2, "l-x"),
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-x", name: "x" },
                    arms: [
                        {
                            kind: "arm", id: "a-1",
                            pattern: { kind: "literal_pattern", value: 1 },
                            body: [mkLiteral(10, "l-10")],
                        },
                        {
                            kind: "arm", id: "a-2",
                            pattern: { kind: "literal_pattern", value: 2 },
                            body: [mkLiteral(20, "l-20")],
                        },
                        {
                            kind: "arm", id: "a-3",
                            pattern: { kind: "wildcard" },
                            body: [mkLiteral(0, "l-0")],
                        },
                    ],
                },
            ]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles match with wildcard pattern to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "match", id: "m-1",
                    target: mkLiteral(5, "l-t"),
                    arms: [
                        {
                            kind: "arm", id: "a-1",
                            pattern: { kind: "wildcard" },
                            body: [mkLiteral(99, "l-99")],
                        },
                    ],
                },
            ]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wasm.length).toBeGreaterThan(0);
    });

    it("compiles match with binding pattern to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "match", id: "m-1",
                    target: mkLiteral(42, "l-t"),
                    arms: [
                        {
                            kind: "arm", id: "a-1",
                            pattern: { kind: "binding", name: "val" },
                            body: [{ kind: "ident", id: "i-val", name: "val" }],
                        },
                    ],
                },
            ]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wasm.length).toBeGreaterThan(0);
    });
});

describe("compile — float operations", () => {
    it("compiles float arithmetic to valid WASM with f64 instructions", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: mkLiteral(1.5, "l-a"),
                    right: mkLiteral(2.5, "l-b"),
                },
            ], { returnType: { kind: "basic", name: "Float" } }),
        ]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("f64");
    });

    it("compiles all float arithmetic operators", () => {
        const ops = ["+", "-", "*", "/"] as const;
        for (const op of ops) {
            const mod = mkModule([
                mkFn("main", [
                    {
                        kind: "binop", id: "b-1", op,
                        left: mkLiteral(1.5, "l-a"),
                        right: mkLiteral(2.5, "l-b"),
                    },
                ], { returnType: { kind: "basic", name: "Float" } }),
            ]);
            const result = compile(mod);
            expect(result.ok, `op=${op}`).toBe(true);
        }
    });

    it("compiles float comparison operators", () => {
        const ops = ["==", "!=", "<", ">", "<=", ">="] as const;
        for (const op of ops) {
            const mod = mkModule([
                mkFn("main", [
                    {
                        kind: "binop", id: "b-1", op,
                        left: mkLiteral(1.5, "l-a"),
                        right: mkLiteral(2.5, "l-b"),
                    },
                ]),
            ]);
            const result = compile(mod);
            expect(result.ok, `op=${op}`).toBe(true);
        }
    });

    it("compiles float negation", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "unop", id: "u-1", op: "-",
                    operand: mkLiteral(3.14, "l-v"),
                },
            ], { returnType: { kind: "basic", name: "Float" } }),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });

    it("compiles float let binding", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "let", id: "let-x", name: "x",
                    type: { kind: "basic", name: "Float" },
                    value: mkLiteral(2.71, "l-v"),
                },
                { kind: "ident", id: "i-x", name: "x" },
            ], { returnType: { kind: "basic", name: "Float" } }),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });
});

describe("compile — implies operator", () => {
    it("compiles implies to valid WASM", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "binop", id: "b-1", op: "implies",
                    left: mkLiteral(true, "l-a"),
                    right: mkLiteral(false, "l-b"),
                },
            ]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });
});

describe("compile — const definitions", () => {
    it("compiles an Int const referenced in a function", () => {
        const mod = mkModule([
            {
                kind: "const", id: "c-1", name: "MAX",
                type: { kind: "basic", name: "Int" },
                value: mkLiteral(100, "l-max"),
            },
            mkFn("main", [
                {
                    kind: "binop", id: "b-1", op: "+",
                    left: { kind: "ident", id: "i-max", name: "MAX" },
                    right: mkLiteral(1, "l-one"),
                },
            ]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });

    it("compiles a Float const", () => {
        const mod = mkModule([
            {
                kind: "const", id: "c-pi", name: "PI",
                type: { kind: "basic", name: "Float" },
                value: mkLiteral(3.14159, "l-pi"),
            },
            mkFn("main", [
                { kind: "ident", id: "i-pi", name: "PI" },
            ], { returnType: { kind: "basic", name: "Float" } }),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });

    it("compiles a Bool const", () => {
        const mod = mkModule([
            {
                kind: "const", id: "c-dbg", name: "DEBUG",
                type: { kind: "basic", name: "Bool" },
                value: mkLiteral(true, "l-dbg"),
            },
            mkFn("main", [
                {
                    kind: "if", id: "if-1",
                    condition: { kind: "ident", id: "i-dbg", name: "DEBUG" },
                    then: [mkLiteral(1, "l-y")],
                    else: [mkLiteral(0, "l-n")],
                },
            ]),
        ]);
        const result = compile(mod);
        expect(result.ok).toBe(true);
    });

    it("compiles record creation", () => {
        const mod = mkModule([
            {
                kind: "record", id: "r-1", name: "Point",
                fields: [
                    { kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-2", name: "y", type: { kind: "basic", name: "Float" } }
                ],
            },
            mkFn("main", [
                {
                    kind: "record_expr", id: "re-1", name: "Point",
                    fields: [
                        { kind: "field_init", name: "x", value: mkLiteral(10, "l-x") },
                        { kind: "field_init", name: "y", value: mkLiteral(20.5, "l-y") }
                    ]
                }
            ], { returnType: { kind: "named", name: "Point" } }),
        ]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("global.get $__heap_ptr");
        expect(result.wat).toContain("f64.store offset=8");
    });

    it("compiles tuple creation", () => {
        const mod = mkModule([
            mkFn("main", [
                {
                    kind: "tuple_expr", id: "te-1",
                    elements: [
                        mkLiteral(42, "l-42"),
                        mkLiteral(3.14, "l-pi")
                    ]
                }
            ])
        ]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("global.get $__heap_ptr");
        expect(result.wat).toContain("i32.store");
        expect(result.wat).toContain("f64.store offset=8");
    });

    it("compiles enum creation", () => {
        const mod = mkModule([
            {
                kind: "enum", id: "e-1", name: "OptionInt",
                variants: [
                    { name: "None", fields: [] },
                    { name: "Some", fields: [{ name: "value", type: { kind: "basic", name: "Int" } }] }
                ]
            },
            mkFn("main", [
                {
                    kind: "enum_constructor", id: "ec-1", enumName: "OptionInt", variant: "Some",
                    fields: [
                        { kind: "field_init", name: "value", value: mkLiteral(42, "l-v") }
                    ]
                }
            ])
        ]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("global.get $__heap_ptr");
        expect(result.wat).toContain("i32.store"); // tag store
        expect(result.wat).toContain("i32.store offset=8"); // field store
    });

    it("compiles enum pattern matching", () => {
        const mod = mkModule([
            {
                kind: "enum", id: "e-1", name: "OptionInt",
                variants: [
                    { name: "None", fields: [] },
                    { name: "Some", fields: [{ name: "value", type: { kind: "basic", name: "Int" } }] }
                ]
            },
            mkFn("main", [
                {
                    kind: "let", id: "let-1", name: "opt", type: { kind: "named", name: "OptionInt" },
                    value: {
                        kind: "enum_constructor", id: "ec-1", enumName: "OptionInt", variant: "Some",
                        fields: [{ kind: "field_init", name: "value", value: mkLiteral(42, "l-v") }]
                    }
                },
                {
                    kind: "match", id: "m-1",
                    target: { kind: "ident", id: "i-opt", name: "opt" },
                    arms: [
                        {
                            id: "a-1",
                            pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "val" }] },
                            body: [
                                {
                                    kind: "binop", id: "b-1", op: "+",
                                    left: { kind: "ident", id: "i-val", name: "val" },
                                    right: mkLiteral(1, "l-1")
                                }
                            ]
                        },
                        {
                            id: "a-2",
                            pattern: { kind: "constructor", name: "None", fields: [] },
                            body: [mkLiteral(0, "l-0")]
                        }
                    ]
                }
            ])
        ]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("i32.load"); // Load tag to match
        expect(result.wat).toContain("i32.load offset=8"); // Destructure inner value
    });

    it("compiles field access", () => {
        const mod = mkModule([
            {
                kind: "record", id: "r-1", name: "Point",
                fields: [
                    { kind: "field", id: "f-1", name: "x", type: { kind: "basic", name: "Int" } },
                ],
            },
            mkFn("main", [
                {
                    kind: "let", id: "let-1", name: "p",
                    type: { kind: "named", name: "Point" },
                    value: {
                        kind: "record_expr", id: "re-1", name: "Point",
                        fields: [
                            { kind: "field_init", name: "x", value: mkLiteral(42, "l-x") },
                        ]
                    }
                },
                {
                    kind: "access", id: "acc-1", field: "x",
                    target: { kind: "ident", id: "i-p", name: "p" }
                }
            ]),
        ]);
        const result = compile(mod, { emitWat: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wat).toContain("i32.load");
    });
});

