// =============================================================================
// Lint Engine Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { lint } from "../../src/lint/lint.js";
import type { EdictModule } from "../../src/ast/nodes.js";

// =============================================================================
// Helpers — minimal valid module builder
// =============================================================================

function mod(defs: EdictModule["definitions"], imports: EdictModule["imports"] = []): EdictModule {
    return { kind: "module", id: "mod-001", name: "test", imports, definitions: defs };
}

const INT = { kind: "basic" as const, name: "Int" as const };

// =============================================================================
// Tests
// =============================================================================

describe("lint", () => {
    // -------------------------------------------------------------------------
    // unused_variable
    // -------------------------------------------------------------------------
    describe("unused_variable", () => {
        it("warns on an unused let binding", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [
                    { kind: "let", id: "let-001", name: "unused", type: INT, value: { kind: "literal", id: "lit-001", value: 42 } },
                    { kind: "literal", id: "lit-002", value: 0 },
                ],
            }]);
            const warnings = lint(m);
            const unused = warnings.filter(w => w.warning === "unused_variable");
            expect(unused).toHaveLength(1);
            expect(unused[0]).toMatchObject({ warning: "unused_variable", nodeId: "let-001", name: "unused" });
        });

        it("does not warn when let binding is referenced in subsequent expression", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [
                    { kind: "let", id: "let-001", name: "x", type: INT, value: { kind: "literal", id: "lit-001", value: 42 } },
                    { kind: "ident", id: "id-001", name: "x" },
                ],
            }]);
            const warnings = lint(m);
            const unused = warnings.filter(w => w.warning === "unused_variable");
            expect(unused).toHaveLength(0);
        });

        it("does not warn when referenced inside a nested if.then", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [
                    { kind: "let", id: "let-001", name: "x", type: INT, value: { kind: "literal", id: "lit-001", value: 42 } },
                    {
                        kind: "if", id: "if-001",
                        condition: { kind: "literal", id: "lit-cond", value: true },
                        then: [{ kind: "ident", id: "id-001", name: "x" }],
                        else: [{ kind: "literal", id: "lit-002", value: 0 }],
                    },
                ],
            }]);
            const warnings = lint(m);
            const unused = warnings.filter(w => w.warning === "unused_variable");
            expect(unused).toHaveLength(0);
        });
    });

    // -------------------------------------------------------------------------
    // unused_import
    // -------------------------------------------------------------------------
    describe("unused_import", () => {
        it("warns on unused import names", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                [{ kind: "import", id: "imp-001", module: "std", names: ["map", "filter"] }],
            );
            const warnings = lint(m);
            const unused = warnings.filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(1);
            expect(unused[0]).toMatchObject({
                warning: "unused_import",
                nodeId: "imp-001",
                importModule: "std",
                unusedNames: ["map", "filter"],
            });
        });

        it("does not warn when import is used", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["io"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "call", id: "call-001",
                        fn: { kind: "ident", id: "id-fn", name: "map" },
                        args: [{ kind: "literal", id: "lit-001", value: 0 }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "std", names: ["map"] }],
            );
            const warnings = lint(m);
            const unused = warnings.filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });
    });

    // -------------------------------------------------------------------------
    // missing_contract
    // -------------------------------------------------------------------------
    describe("missing_contract", () => {
        it("warns on function with no contracts", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "helper", params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                effects: ["pure"], returnType: INT, contracts: [],
                body: [{ kind: "ident", id: "id-001", name: "x" }],
            }]);
            const warnings = lint(m);
            const missing = warnings.filter(w => w.warning === "missing_contract");
            expect(missing).toHaveLength(1);
            expect(missing[0]).toMatchObject({ warning: "missing_contract", nodeId: "fn-001", functionName: "helper" });
        });

        it("does not warn on main", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const missing = warnings.filter(w => w.warning === "missing_contract");
            expect(missing).toHaveLength(0);
        });

        it("does not warn when contracts exist", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "abs", params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                effects: ["pure"], returnType: INT,
                contracts: [{
                    kind: "post", id: "post-001",
                    condition: { kind: "binop", id: "cmp-001", op: ">=", left: { kind: "ident", id: "id-r", name: "result" }, right: { kind: "literal", id: "lit-z", value: 0 } },
                }],
                body: [{ kind: "ident", id: "id-001", name: "x" }],
            }]);
            const warnings = lint(m);
            const missing = warnings.filter(w => w.warning === "missing_contract");
            expect(missing).toHaveLength(0);
        });
    });

    // -------------------------------------------------------------------------
    // oversized_function
    // -------------------------------------------------------------------------
    describe("oversized_function", () => {
        it("warns when function exceeds 50 expression nodes", () => {
            // Create a body with many expressions (>50 nodes via nesting)
            const body = [];
            for (let i = 0; i < 26; i++) {
                body.push({
                    kind: "binop" as const, id: `bin-${i}`, op: "+" as const,
                    left: { kind: "literal" as const, id: `l-${i}`, value: i },
                    right: { kind: "literal" as const, id: `r-${i}`, value: i + 1 },
                });
            }
            // 26 binops × 3 nodes each = 78 nodes total
            const m = mod([{
                kind: "fn", id: "fn-001", name: "big", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body,
            }]);
            const warnings = lint(m);
            const oversized = warnings.filter(w => w.warning === "oversized_function");
            expect(oversized).toHaveLength(1);
            expect(oversized[0]).toMatchObject({ warning: "oversized_function", functionName: "big" });
            expect((oversized[0] as any).expressionCount).toBeGreaterThan(50);
        });
    });

    // -------------------------------------------------------------------------
    // empty_body
    // -------------------------------------------------------------------------
    describe("empty_body", () => {
        it("warns on function with empty body", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "stub", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [],
            }]);
            const warnings = lint(m);
            const empty = warnings.filter(w => w.warning === "empty_body");
            expect(empty).toHaveLength(1);
            expect(empty[0]).toMatchObject({ warning: "empty_body", nodeId: "fn-001", functionName: "stub" });
        });
    });

    // -------------------------------------------------------------------------
    // redundant_effect
    // -------------------------------------------------------------------------
    describe("redundant_effect", () => {
        it("warns when function declares io but only calls pure functions", () => {
            const m = mod([
                {
                    kind: "fn", id: "fn-001", name: "helper", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 42 }],
                },
                {
                    kind: "fn", id: "fn-002", name: "caller", params: [], effects: ["io"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "call", id: "call-001",
                        fn: { kind: "ident", id: "id-fn", name: "helper" },
                        args: [],
                    }],
                },
            ]);
            const warnings = lint(m);
            const redundant = warnings.filter(w => w.warning === "redundant_effect");
            expect(redundant).toHaveLength(1);
            expect(redundant[0]).toMatchObject({
                warning: "redundant_effect",
                functionName: "caller",
                redundantEffects: ["io"],
            });
            expect(redundant[0].suggestion).toBeDefined();
        });

        it("does not warn when io is needed (calls print)", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "greet", params: [], effects: ["io"],
                returnType: INT, contracts: [],
                body: [{
                    kind: "call", id: "call-001",
                    fn: { kind: "ident", id: "id-fn", name: "print" },
                    args: [{ kind: "literal", id: "lit-001", value: "hello" }],
                }],
            }]);
            const warnings = lint(m);
            const redundant = warnings.filter(w => w.warning === "redundant_effect");
            expect(redundant).toHaveLength(0);
        });
    });

    // -------------------------------------------------------------------------
    // Clean program — no warnings
    // -------------------------------------------------------------------------
    it("returns no warnings for a clean program", () => {
        const m = mod([{
            kind: "fn", id: "fn-001", name: "main", params: [],
            effects: ["io"], returnType: INT,
            contracts: [],
            body: [{
                kind: "call", id: "call-001",
                fn: { kind: "ident", id: "id-fn", name: "print" },
                args: [{ kind: "literal", id: "lit-001", value: "hello" }],
            }],
        }]);
        const warnings = lint(m);
        expect(warnings).toHaveLength(0);
    });

    // =========================================================================
    // Expression branch coverage — collectReferencedNamesFromExpr
    // =========================================================================
    // These tests exercise branches in the switch statement that checks
    // whether imported names are used across all expression kinds.

    describe("expression branch coverage — unused imports", () => {
        it("detects import used in unop expression", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "unop", id: "un-001", op: "-",
                        operand: { kind: "ident", id: "id-001", name: "negate" },
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "math", names: ["negate"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in array expression", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "array", id: "arr-001",
                        elements: [{ kind: "ident", id: "id-001", name: "val" }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "data", names: ["val"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in tuple_expr", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "tuple_expr", id: "tup-001",
                        elements: [{ kind: "ident", id: "id-001", name: "x" }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "data", names: ["x"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in record_expr", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "record_expr", id: "rec-001",
                        recordName: "Point",
                        fields: [{ name: "x", value: { kind: "ident", id: "id-001", name: "origin" } }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "geo", names: ["origin"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in enum_constructor", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "enum_constructor", id: "ec-001",
                        enumName: "Color", variant: "RGB",
                        fields: [{ name: "r", value: { kind: "ident", id: "id-001", name: "red" } }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "colors", names: ["red"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in access expression", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "access", id: "acc-001", field: "x",
                        target: { kind: "ident", id: "id-001", name: "point" },
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "geo", names: ["point"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in lambda body", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "lambda", id: "lam-001",
                        params: [{ kind: "param", id: "p-001", name: "y", type: INT }],
                        returnType: INT,
                        body: [{ kind: "ident", id: "id-001", name: "helper" }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "utils", names: ["helper"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in block expression", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "block", id: "blk-001",
                        body: [{ kind: "ident", id: "id-001", name: "compute" }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "utils", names: ["compute"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in string_interp", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "string_interp", id: "si-001",
                        parts: [{ kind: "ident", id: "id-001", name: "name" }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "data", names: ["name"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in match expression (target and arm bodies)", () => {
            const m = mod(
                [{
                    kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                    returnType: INT, contracts: [],
                    body: [{
                        kind: "match", id: "match-001",
                        target: { kind: "ident", id: "id-001", name: "val" },
                        arms: [{
                            pattern: { kind: "literal", value: 0 },
                            body: [{ kind: "ident", id: "id-002", name: "zero_handler" }],
                        }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "handlers", names: ["val", "zero_handler"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });
    });

    // =========================================================================
    // Expression branch coverage — unused imports in non-fn definitions
    // =========================================================================

    describe("unused imports in const/record/enum definitions", () => {
        it("detects import used in const definition value", () => {
            const m = mod(
                [{
                    kind: "const", id: "const-001", name: "PI",
                    type: INT,
                    value: { kind: "ident", id: "id-001", name: "pi_value" },
                }],
                [{ kind: "import", id: "imp-001", module: "math", names: ["pi_value"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in record field default", () => {
            const m = mod(
                [{
                    kind: "record", id: "rec-001", name: "Config",
                    fields: [{
                        name: "timeout", type: INT,
                        defaultValue: { kind: "ident", id: "id-001", name: "default_timeout" },
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "defaults", names: ["default_timeout"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });

        it("detects import used in enum variant field default", () => {
            const m = mod(
                [{
                    kind: "enum", id: "enum-001", name: "Shape",
                    variants: [{
                        name: "Circle",
                        fields: [{
                            name: "radius", type: INT,
                            defaultValue: { kind: "ident", id: "id-001", name: "unit_radius" },
                        }],
                    }],
                }],
                [{ kind: "import", id: "imp-001", module: "geometry", names: ["unit_radius"] }],
            );
            const unused = lint(m).filter(w => w.warning === "unused_import");
            expect(unused).toHaveLength(0);
        });
    });

    // =========================================================================
    // Expression branch coverage — recurseIntoExprForUnused
    // =========================================================================

    describe("unused variable detection in nested constructs", () => {
        it("detects unused variable inside match arm body", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [{
                    kind: "match", id: "match-001",
                    target: { kind: "literal", id: "lit-t", value: 1 },
                    arms: [{
                        pattern: { kind: "literal", value: 1 },
                        body: [
                            { kind: "let", id: "let-001", name: "unused", type: INT, value: { kind: "literal", id: "lit-001", value: 42 } },
                            { kind: "literal", id: "lit-002", value: 0 },
                        ],
                    }],
                }],
            }]);
            const unused = lint(m).filter(w => w.warning === "unused_variable");
            expect(unused).toHaveLength(1);
            expect(unused[0]).toMatchObject({ nodeId: "let-001", name: "unused" });
        });

        it("detects unused variable inside lambda body", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [{
                    kind: "lambda", id: "lam-001",
                    params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                    returnType: INT,
                    body: [
                        { kind: "let", id: "let-001", name: "unused", type: INT, value: { kind: "literal", id: "lit-001", value: 42 } },
                        { kind: "ident", id: "id-001", name: "x" },
                    ],
                }],
            }]);
            const unused = lint(m).filter(w => w.warning === "unused_variable");
            expect(unused).toHaveLength(1);
            expect(unused[0]).toMatchObject({ nodeId: "let-001", name: "unused" });
        });

        it("detects unused variable inside block body", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [{
                    kind: "block", id: "blk-001",
                    body: [
                        { kind: "let", id: "let-001", name: "unused", type: INT, value: { kind: "literal", id: "lit-001", value: 42 } },
                        { kind: "literal", id: "lit-002", value: 0 },
                    ],
                }],
            }]);
            const unused = lint(m).filter(w => w.warning === "unused_variable");
            expect(unused).toHaveLength(1);
            expect(unused[0]).toMatchObject({ nodeId: "let-001", name: "unused" });
        });
    });

    // =========================================================================
    // Expression branch coverage — countExprNode
    // =========================================================================

    describe("oversized_function with diverse expression types", () => {
        it("counts nodes across all expression kinds", () => {
            // Build a body with diverse expression types that in total exceed 50 nodes
            const body: any[] = [];
            // Each entry contributes nodes: unop=2, array=N+1, tuple=N+1, record_expr=N+1,
            // enum_constructor=N+1, access=2, lambda=body+1, block=body+1, string_interp=N+1, match=target+arms+1
            for (let i = 0; i < 5; i++) {
                body.push(
                    { kind: "unop", id: `un-${i}`, op: "-", operand: { kind: "literal", id: `unlit-${i}`, value: i } },
                    { kind: "array", id: `arr-${i}`, elements: [{ kind: "literal", id: `ael-${i}`, value: i }] },
                    { kind: "tuple_expr", id: `tup-${i}`, elements: [{ kind: "literal", id: `tel-${i}`, value: i }] },
                    { kind: "record_expr", id: `rec-${i}`, recordName: "R", fields: [{ name: "f", value: { kind: "literal", id: `rfl-${i}`, value: i } }] },
                    { kind: "enum_constructor", id: `ec-${i}`, enumName: "E", variant: "V", fields: [{ name: "f", value: { kind: "literal", id: `efl-${i}`, value: i } }] },
                    { kind: "access", id: `acc-${i}`, field: "x", target: { kind: "literal", id: `atgt-${i}`, value: i } },
                    { kind: "string_interp", id: `si-${i}`, parts: [{ kind: "literal", id: `sip-${i}`, value: "hi" }] },
                );
            }
            // Add lambda and block for those branches
            body.push(
                { kind: "lambda", id: "lam-big", params: [], returnType: INT, body: [{ kind: "literal", id: "lam-lit", value: 0 }] },
                { kind: "block", id: "blk-big", body: [{ kind: "literal", id: "blk-lit", value: 0 }] },
                { kind: "match", id: "match-big", target: { kind: "literal", id: "mt", value: 0 }, arms: [{ pattern: { kind: "literal", value: 0 }, body: [{ kind: "literal", id: "mb", value: 0 }] }] },
            );

            const m = mod([{
                kind: "fn", id: "fn-001", name: "big", params: [], effects: ["pure"],
                returnType: INT, contracts: [],
                body,
            }]);
            const warnings = lint(m);
            const oversized = warnings.filter(w => w.warning === "oversized_function");
            expect(oversized).toHaveLength(1);
            expect((oversized[0] as any).expressionCount).toBeGreaterThan(50);
        });
    });

    // =========================================================================
    // decomposition_suggested — reach-pointer segmentation
    // =========================================================================

    describe("decomposition_suggested", () => {
        // Helper: build N independent let+use pairs as body expressions.
        // Each pair defines a name and uses it, sharing no deps with other pairs.
        function independentPairs(count: number, nodesPerPair: number): any[] {
            const body: any[] = [];
            for (let p = 0; p < count; p++) {
                // Pad each pair to have enough nodes to exceed threshold overall
                const exprs: any[] = [];
                const name = `var_${p}`;
                exprs.push({
                    kind: "let", id: `let-${p}`, name,
                    type: INT,
                    value: { kind: "literal", id: `lit-val-${p}`, value: p },
                });
                // Add padding binops that reference the let-bound name
                for (let n = 0; n < nodesPerPair - 2; n++) {
                    exprs.push({
                        kind: "binop", id: `bin-${p}-${n}`, op: "+",
                        left: { kind: "ident", id: `id-${p}-${n}`, name },
                        right: { kind: "literal", id: `pad-${p}-${n}`, value: n },
                    });
                }
                body.push(...exprs);
            }
            return body;
        }

        it("suggests decomposition for function with 3 independent segments", () => {
            // 3 groups of ~20 nodes each → ~60 nodes total (>50 threshold)
            // Each group defines and uses its own variable, no cross-group deps
            const body = independentPairs(3, 8);
            const m = mod([{
                kind: "fn", id: "fn-big", name: "process",
                params: [], effects: ["pure"], returnType: INT, contracts: [],
                body,
            }]);
            const warnings = lint(m);
            const decomp = warnings.filter(w => w.warning === "decomposition_suggested");
            expect(decomp).toHaveLength(1);
            const w = decomp[0] as any;
            expect(w.functionName).toBe("process");
            expect(w.reason).toBe("function_has_3_independent_segments");
            expect(w.suggestedSplit).toHaveLength(3);
            // Verify node ranges reference actual node IDs from the body
            expect(w.suggestedSplit[0].nodeRange[0]).toBe("let-0");
            expect(w.suggestedSplit[1].nodeRange[0]).toBe("let-1");
            expect(w.suggestedSplit[2].nodeRange[0]).toBe("let-2");
        });

        it("does not suggest decomposition for tightly coupled function", () => {
            // All expressions reference the same chain of let-bindings
            const body: any[] = [];
            for (let i = 0; i < 20; i++) {
                const prevName = i > 0 ? `v_${i - 1}` : undefined;
                body.push({
                    kind: "let", id: `let-${i}`, name: `v_${i}`,
                    type: INT,
                    value: prevName
                        ? { kind: "ident", id: `ref-${i}`, name: prevName }
                        : { kind: "literal", id: `lit-${i}`, value: i },
                });
            }
            // Use the last variable to pad nodes
            for (let i = 0; i < 15; i++) {
                body.push({
                    kind: "binop", id: `bin-${i}`, op: "+",
                    left: { kind: "ident", id: `use-${i}`, name: "v_19" },
                    right: { kind: "literal", id: `pad-${i}`, value: i },
                });
            }
            const m = mod([{
                kind: "fn", id: "fn-coupled", name: "coupled",
                params: [], effects: ["pure"], returnType: INT, contracts: [],
                body,
            }]);
            const warnings = lint(m);
            const decomp = warnings.filter(w => w.warning === "decomposition_suggested");
            expect(decomp).toHaveLength(0);
        });

        it("suggests 2 splits for two independent phases", () => {
            const body = independentPairs(2, 10);
            const m = mod([{
                kind: "fn", id: "fn-two", name: "two_phase",
                params: [], effects: ["pure"], returnType: INT, contracts: [],
                body,
            }]);
            const warnings = lint(m);
            const decomp = warnings.filter(w => w.warning === "decomposition_suggested");
            expect(decomp).toHaveLength(1);
            expect((decomp[0] as any).suggestedSplit).toHaveLength(2);
            expect((decomp[0] as any).reason).toBe("function_has_2_independent_segments");
        });

        it("does not fire on small functions below threshold", () => {
            // 2 independent segments but only ~10 nodes total
            const body = [
                { kind: "let", id: "let-a", name: "a", type: INT, value: { kind: "literal", id: "lit-a", value: 1 } },
                { kind: "ident", id: "id-a", name: "a" },
                { kind: "let", id: "let-b", name: "b", type: INT, value: { kind: "literal", id: "lit-b", value: 2 } },
                { kind: "ident", id: "id-b", name: "b" },
            ];
            const m = mod([{
                kind: "fn", id: "fn-small", name: "small",
                params: [], effects: ["pure"], returnType: INT, contracts: [],
                body,
            }]);
            const warnings = lint(m);
            const decomp = warnings.filter(w => w.warning === "decomposition_suggested");
            expect(decomp).toHaveLength(0);
        });

        it("does not fire on single-expression functions", () => {
            // A big single expression — cannot be split
            const bigExpr: any = { kind: "literal", id: "lit-root", value: 0 };
            const m = mod([{
                kind: "fn", id: "fn-one", name: "monolith",
                params: [], effects: ["pure"], returnType: INT, contracts: [],
                body: [bigExpr],
            }]);
            const warnings = lint(m);
            const decomp = warnings.filter(w => w.warning === "decomposition_suggested");
            expect(decomp).toHaveLength(0);
        });
    });

    // =========================================================================
    // intent_unverified_invariant — intent-contract consistency
    // =========================================================================

    describe("intent_unverified_invariant", () => {
        const resultGe0Expr = {
            kind: "binop" as const, id: "cmp-inv", op: ">=" as const,
            left: { kind: "ident" as const, id: "id-r", name: "result" },
            right: { kind: "literal" as const, id: "lit-z", value: 0 },
        };

        it("warns when expression invariant has no matching postcondition", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "abs",
                params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                effects: ["pure"], returnType: INT, contracts: [],
                intent: {
                    goal: "compute_absolute_value",
                    inputs: ["x"],
                    outputs: ["result"],
                    invariants: [{ kind: "expression", expression: resultGe0Expr }],
                },
                body: [{ kind: "ident", id: "id-001", name: "x" }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(1);
            expect(intent[0]).toMatchObject({
                warning: "intent_unverified_invariant",
                nodeId: "fn-001",
                functionName: "abs",
            });
            expect((intent[0] as any).unverifiedInvariant.kind).toBe("expression");
        });

        it("no warning when expression invariant has matching postcondition", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "abs",
                params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                effects: ["pure"], returnType: INT,
                contracts: [{
                    kind: "post", id: "post-001",
                    condition: resultGe0Expr,
                }],
                intent: {
                    goal: "compute_absolute_value",
                    inputs: ["x"],
                    outputs: ["result"],
                    invariants: [{ kind: "expression", expression: resultGe0Expr }],
                },
                body: [{ kind: "ident", id: "id-001", name: "x" }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(0);
        });

        it("no warning when function has no intent", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "helper",
                params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                effects: ["pure"], returnType: INT,
                contracts: [{
                    kind: "post", id: "post-001",
                    condition: resultGe0Expr,
                }],
                body: [{ kind: "ident", id: "id-001", name: "x" }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(0);
        });

        it("warns on multiple unmatched invariants", () => {
            const inv2 = {
                kind: "binop" as const, id: "cmp-2", op: "<=" as const,
                left: { kind: "ident" as const, id: "id-r2", name: "result" },
                right: { kind: "literal" as const, id: "lit-100", value: 100 },
            };
            const inv3 = {
                kind: "binop" as const, id: "cmp-3", op: "!=" as const,
                left: { kind: "ident" as const, id: "id-r3", name: "result" },
                right: { kind: "literal" as const, id: "lit-neg", value: -1 },
            };
            const m = mod([{
                kind: "fn", id: "fn-001", name: "clamp",
                params: [{ kind: "param", id: "p-001", name: "x", type: INT }],
                effects: ["pure"], returnType: INT,
                contracts: [{
                    kind: "post", id: "post-001",
                    condition: resultGe0Expr,
                }],
                intent: {
                    goal: "clamp_to_range",
                    inputs: ["x"],
                    outputs: ["result"],
                    invariants: [
                        { kind: "expression", expression: resultGe0Expr }, // covered
                        { kind: "expression", expression: inv2 },         // not covered
                        { kind: "expression", expression: inv3 },         // not covered
                    ],
                },
                body: [{ kind: "ident", id: "id-001", name: "x" }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(2);
        });

        it("empty invariants array produces no warnings", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "noop",
                params: [], effects: ["pure"], returnType: INT, contracts: [],
                intent: {
                    goal: "do_nothing",
                    inputs: [],
                    outputs: ["result"],
                    invariants: [],
                },
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(0);
        });

        it("semantic invariant covered by semantic postcondition produces no warning", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "sort",
                params: [{ kind: "param", id: "p-001", name: "arr", type: { kind: "array", elementType: INT } }],
                effects: ["pure"], returnType: { kind: "array", elementType: INT },
                contracts: [{
                    kind: "post", id: "post-001",
                    semantic: { assertion: "sorted", target: "result" },
                }],
                intent: {
                    goal: "sort_ascending",
                    inputs: ["arr"],
                    outputs: ["result"],
                    invariants: [{ kind: "semantic", assertion: "sorted", target: "result" }],
                },
                body: [{ kind: "ident", id: "id-001", name: "arr" }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(0);
        });

        it("unmatched semantic invariant produces warning", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "sort",
                params: [{ kind: "param", id: "p-001", name: "arr", type: { kind: "array", elementType: INT } }],
                effects: ["pure"], returnType: { kind: "array", elementType: INT },
                contracts: [], // no contracts at all
                intent: {
                    goal: "sort_ascending",
                    inputs: ["arr"],
                    outputs: ["result"],
                    invariants: [{ kind: "semantic", assertion: "sorted", target: "result" }],
                },
                body: [{ kind: "ident", id: "id-001", name: "arr" }],
            }]);
            const warnings = lint(m);
            const intent = warnings.filter(w => w.warning === "intent_unverified_invariant");
            expect(intent).toHaveLength(1);
            expect((intent[0] as any).unverifiedInvariant).toMatchObject({
                kind: "semantic", assertion: "sorted", target: "result",
            });
        });
    });

    // =========================================================================
    // confidence_below_threshold — blame confidence enforcement
    // =========================================================================

    describe("confidence_below_threshold", () => {
        it("warns when function blame confidence is below module minConfidence", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "test",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "process",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    blame: {
                        author: "agent://weak-model",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.5,
                    },
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                minConfidence: 0.85,
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(1);
            expect(conf[0]).toMatchObject({
                warning: "confidence_below_threshold",
                nodeId: "fn-001",
                name: "process",
                actual: 0.5,
                required: 0.85,
            });
        });

        it("warns when module blame confidence is below minConfidence", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "low_confidence_module",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "main",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                blame: {
                    author: "agent://general-purpose",
                    generatedAt: "2026-03-10T00:00:00Z",
                    confidence: 0.6,
                },
                minConfidence: 0.85,
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(1);
            expect(conf[0]).toMatchObject({
                warning: "confidence_below_threshold",
                nodeId: "mod-001",
                name: "low_confidence_module",
                actual: 0.6,
                required: 0.85,
            });
        });

        it("no warning when confidence meets threshold", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "test",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "process",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    blame: {
                        author: "agent://specialist",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.95,
                    },
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                blame: {
                    author: "agent://orchestrator",
                    generatedAt: "2026-03-10T00:00:00Z",
                    confidence: 0.90,
                },
                minConfidence: 0.85,
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(0);
        });

        it("no warning when no minConfidence is set", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "test",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "process",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    blame: {
                        author: "agent://weak-model",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.1,
                    },
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(0);
        });

        it("no warning when blame exists without confidence below threshold", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "test",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "process",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    blame: {
                        author: "agent://specialist",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.85,
                    },
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                minConfidence: 0.85,
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(0);
        });

        it("warns on both module and function when both are below threshold", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "weak_module",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "weak_fn",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    blame: {
                        author: "agent://general",
                        generatedAt: "2026-03-10T00:00:00Z",
                        confidence: 0.3,
                    },
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                blame: {
                    author: "agent://orchestrator",
                    generatedAt: "2026-03-10T00:00:00Z",
                    confidence: 0.4,
                },
                minConfidence: 0.85,
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(2);
            expect(conf[0]).toMatchObject({ nodeId: "mod-001", name: "weak_module", actual: 0.4 });
            expect(conf[1]).toMatchObject({ nodeId: "fn-001", name: "weak_fn", actual: 0.3 });
        });

        it("does not warn on functions without blame even if minConfidence is set", () => {
            const m: EdictModule = {
                kind: "module", id: "mod-001", name: "test",
                imports: [], definitions: [{
                    kind: "fn", id: "fn-001", name: "no_blame",
                    params: [], effects: ["pure"], returnType: INT, contracts: [],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
                minConfidence: 0.85,
            };
            const warnings = lint(m);
            const conf = warnings.filter(w => w.warning === "confidence_below_threshold");
            expect(conf).toHaveLength(0);
        });
    });

    // =========================================================================
    // unsupported_container — monomorphic container warnings
    // =========================================================================

    describe("unsupported_container", () => {
        const STRING = { kind: "basic" as const, name: "String" as const };
        const FLOAT = { kind: "basic" as const, name: "Float" as const };
        const BOOL = { kind: "basic" as const, name: "Bool" as const };
        const ARRAY_STRING = { kind: "array" as const, element: STRING };
        const ARRAY_INT_T = { kind: "array" as const, element: INT };
        const OPTION_FLOAT = { kind: "option" as const, inner: FLOAT };
        const OPTION_INT_T = { kind: "option" as const, inner: INT };
        const RESULT_INT_INT = { kind: "result" as const, ok: INT, err: INT };
        const RESULT_STRING_STRING = { kind: "result" as const, ok: STRING, err: STRING };

        it("warns on Array<String> param type", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [
                    { kind: "param", id: "p-001", name: "data", type: ARRAY_STRING },
                ], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(1);
            expect(uc[0]).toMatchObject({
                warning: "unsupported_container",
                nodeId: "fn-001",
                location: "param data",
                containerKind: "array",
            });
            expect((uc[0] as any).supportedTypes.length).toBeGreaterThan(0);
        });

        it("warns on Option<Float> return type", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["pure"],
                returnType: OPTION_FLOAT, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(1);
            expect(uc[0]).toMatchObject({
                warning: "unsupported_container",
                containerKind: "option",
                location: "returnType",
            });
        });

        it("warns on Array<Bool> in record field", () => {
            const m = mod([{
                kind: "record", id: "rec-001", name: "Config",
                fields: [{ name: "flags", type: { kind: "array" as const, element: BOOL } }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(1);
            expect(uc[0]).toMatchObject({
                containerKind: "array",
                location: "field flags",
            });
        });

        it("does not warn on Array<Int>", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [
                    { kind: "param", id: "p-001", name: "nums", type: ARRAY_INT_T },
                ], effects: ["pure"],
                returnType: INT, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(0);
        });

        it("does not warn on Option<Int>", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["pure"],
                returnType: OPTION_INT_T, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(0);
        });

        it("does not warn on Result<String, String> (supported by HTTP builtins)", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["io"],
                returnType: RESULT_STRING_STRING, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(0);
        });

        it("does not warn on Result<Int, Int>", () => {
            const m = mod([{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["pure"],
                returnType: RESULT_INT_INT, contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }]);
            const warnings = lint(m);
            const uc = warnings.filter(w => w.warning === "unsupported_container");
            expect(uc).toHaveLength(0);
        });
    });
});
