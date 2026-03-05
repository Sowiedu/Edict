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
});
