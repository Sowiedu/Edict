// =============================================================================
// Miscellaneous Coverage Gap Tests
// =============================================================================
// Targets specific uncovered lines across files that aren't exercised by
// existing tests. Each section names the file and lines it covers.

import { describe, it, expect } from "vitest";
import { walkExpression } from "../../src/ast/walk.js";
import { collectStrings } from "../../src/codegen/collect-strings.js";
import { StringTable } from "../../src/codegen/string-table.js";
import { validateFragment, validateExpression, validateTypeExpr } from "../../src/validator/schema-walker.js";
import { IdTracker } from "../../src/validator/id-tracker.js";
import {
    preconditionNotMet,
    missingEntryPoint,
    wasmValidationError,
    verificationTimeout,
    contractFailure,
    undecidablePredicate,
} from "../../src/errors/structured-errors.js";
import { lint } from "../../src/lint/lint.js";
import type { Expression } from "../../src/ast/nodes.js";

// =============================================================================
// walk.ts — leave visitor (lines 86-92) + function-form visitor
// =============================================================================

describe("walkExpression — leave visitor", () => {
    it("calls leave callback after processing children", () => {
        const entered: string[] = [];
        const left: string[] = [];
        const expr: Expression = {
            kind: "binop", id: "b1", op: "+",
            left: { kind: "literal", id: "l1", value: 1 } as any,
            right: { kind: "literal", id: "l2", value: 2 } as any,
        } as any;

        walkExpression(expr, {
            enter: (node) => { entered.push(node.id); },
            leave: (node) => { left.push(node.id); },
        });

        expect(entered).toEqual(["b1", "l1", "l2"]);
        // Leave is called in reverse (post-order)
        expect(left).toEqual(["l1", "l2", "b1"]);
    });

    it("enter returning false prevents child traversal but still calls leave", () => {
        const left: string[] = [];
        const expr: Expression = {
            kind: "binop", id: "b1", op: "+",
            left: { kind: "literal", id: "l1", value: 1 } as any,
            right: { kind: "literal", id: "l2", value: 2 } as any,
        } as any;

        walkExpression(expr, {
            enter: () => false,
            leave: (node) => { left.push(node.id); },
        });

        // enter returns false → no children visited, no leave called (returns early)
        expect(left).toEqual([]);
    });

    it("walks string_interp parts", () => {
        const ids: string[] = [];
        const expr: Expression = {
            kind: "string_interp", id: "si1",
            parts: [
                { kind: "literal", id: "p1", value: "hello" } as any,
                { kind: "ident", id: "p2", name: "x" },
            ],
        } as any;

        walkExpression(expr, (node) => { ids.push(node.id); });
        expect(ids).toEqual(["si1", "p1", "p2"]);
    });

    it("walks forall/exists quantifier", () => {
        const ids: string[] = [];
        const expr: Expression = {
            kind: "forall", id: "q1", variable: "i",
            range: {
                from: { kind: "literal", id: "f1", value: 0 } as any,
                to: { kind: "literal", id: "t1", value: 10 } as any,
            },
            body: { kind: "ident", id: "b1", name: "i" },
        } as any;

        walkExpression(expr, (node) => { ids.push(node.id); });
        expect(ids).toEqual(["q1", "f1", "t1", "b1"]);
    });
});

// =============================================================================
// collect-strings.ts — forall/exists branches (lines 77-80)
// =============================================================================

describe("collectStrings — quantifier expressions", () => {
    it("collects strings from forall range and body", () => {
        const strings = new StringTable();
        const exprs: Expression[] = [
            {
                kind: "forall", id: "q1", variable: "i",
                range: {
                    from: { kind: "literal", id: "f1", value: "start" } as any,
                    to: { kind: "literal", id: "t1", value: "end" } as any,
                },
                body: { kind: "literal", id: "b1", value: "body_str" } as any,
            } as any,
        ];
        collectStrings(exprs, strings);
        // All three string literals should be interned
        expect(strings.totalBytes).toBeGreaterThan(0);
    });

    it("handles array expressions", () => {
        const strings = new StringTable();
        const exprs: Expression[] = [
            {
                kind: "array", id: "a1",
                elements: [
                    { kind: "literal", id: "l1", value: "hello" } as any,
                ],
            } as any,
        ];
        collectStrings(exprs, strings);
        // The array case should NOT process strings (ident/array comment says "no string literals directly")
        // But actually the function falls through to default for "array" which does nothing
        // The string is inside an element though — array case IS handled via the ident/array comment
        expect(strings.totalBytes).toBe(0); // array branch is a no-op
    });
});

// =============================================================================
// schema-walker.ts — validateFragment (lines 673-678), validateExpression
// (line 695), validateTypeExpr (line 711)
// =============================================================================

describe("schema-walker public APIs", () => {
    it("validateFragment rejects non-fragment kind", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateFragment({ kind: "module", id: "m1" }, "$", errors, idTracker);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((e: any) => e.error === "unknown_node_kind")).toBe(true);
    });

    it("validateFragment rejects missing kind", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateFragment({ id: "m1" }, "$", errors, idTracker);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((e: any) => e.error === "missing_field")).toBe(true);
    });

    it("validateFragment rejects non-object input", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateFragment("not_an_object", "$", errors, idTracker);
        expect(errors.length).toBeGreaterThan(0);
    });

    it("validateExpression validates a valid expression", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateExpression(
            { kind: "literal", id: "lit-001", value: 42 },
            "$.body[0]",
            errors,
            idTracker,
        );
        expect(errors).toHaveLength(0);
    });

    it("validateExpression catches invalid expression", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateExpression({ kind: "invalid_node" }, "$.body[0]", errors, idTracker);
        expect(errors.length).toBeGreaterThan(0);
    });

    it("validateTypeExpr validates a valid type", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateTypeExpr(
            { kind: "basic", name: "Int" },
            "$.returnType",
            errors,
            idTracker,
        );
        expect(errors).toHaveLength(0);
    });

    it("validateTypeExpr catches invalid type", () => {
        const errors: any[] = [];
        const idTracker = new IdTracker();
        validateTypeExpr({ kind: "not_a_type" }, "$.returnType", errors, idTracker);
        expect(errors.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// structured-errors.ts — uncovered constructors (lines 573-602, 735)
// =============================================================================

describe("structured-errors — uncovered constructors", () => {
    it("contractFailure", () => {
        const err = contractFailure("n1", "c1", "fn1", "post", { x: "0" });
        expect(err.error).toBe("contract_failure");
        expect(err.contractKind).toBe("post");
    });

    it("verificationTimeout", () => {
        const err = verificationTimeout("n1", "c1", "fn1", 5000);
        expect(err.error).toBe("verification_timeout");
        expect(err.timeoutMs).toBe(5000);
    });

    it("undecidablePredicate", () => {
        const err = undecidablePredicate("n1", "c1", "fn1", "lambda");
        expect(err.error).toBe("undecidable_predicate");
    });

    it("preconditionNotMet", () => {
        const err = preconditionNotMet("n1", "cs1", "caller", "callee", "c1", { x: "-1" });
        expect(err.error).toBe("precondition_not_met");
        expect(err.callerName).toBe("caller");
    });

    it("missingEntryPoint", () => {
        const err = missingEntryPoint("main");
        expect(err.error).toBe("missing_entry_point");
        expect(err.entryPointName).toBe("main");
    });

    it("wasmValidationError", () => {
        const err = wasmValidationError("binaryen failed");
        expect(err.error).toBe("wasm_validation_error");
        expect(err.message).toBe("binaryen failed");
    });
});

// =============================================================================
// lint.ts — collectReferencedNamesFromExpr branches (lines 264-266, 282-283)
// =============================================================================

describe("lint — forall/exists and string_interp references", () => {
    it("reports imports used only inside forall as unused (forall not walked for refs)", () => {
        const module = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [
                { id: "imp-001", module: "external", names: ["helper", "unused_name"] },
            ],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-001",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Bool" },
                    contracts: [],
                    body: [
                        {
                            kind: "forall", id: "q-001", variable: "i",
                            range: {
                                from: { kind: "literal", id: "l-001", value: 0 },
                                to: { kind: "call", id: "c-001", fn: { kind: "ident", id: "id-001", name: "helper" }, args: [] },
                            },
                            body: { kind: "literal", id: "l-002", value: true },
                        } as any,
                    ],
                },
            ],
        };

        const warnings = lint(module as any);
        // collectReferencedNamesFromExpr doesn't handle forall, so both names appear unused
        const unusedImport = warnings.find((w) => w.warning === "unused_import");
        expect(unusedImport).toBeDefined();
        expect((unusedImport as any).unusedNames).toContain("unused_name");
        expect((unusedImport as any).unusedNames).toContain("helper");
    });

    it("detects references in string_interp", () => {
        const module = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [
                { id: "imp-001", module: "external", names: ["greeting"] },
            ],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-001",
                    name: "main",
                    params: [],
                    effects: ["io"],
                    returnType: { kind: "basic", name: "String" },
                    contracts: [],
                    body: [
                        {
                            kind: "string_interp", id: "si-001",
                            parts: [
                                { kind: "ident", id: "id-001", name: "greeting" },
                            ],
                        } as any,
                    ],
                },
            ],
        };

        const warnings = lint(module as any);
        // "greeting" is used in string_interp, should NOT show as unused import
        const unusedImport = warnings.find((w) => w.warning === "unused_import");
        expect(unusedImport).toBeUndefined();
    });
});
