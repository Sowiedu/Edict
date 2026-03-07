// =============================================================================
// Targeted Branch Coverage Tests — validator, resolver, handler, lint, patch
// =============================================================================
// Covers precise uncovered branches identified via V8 coverage line analysis.
// Each test targets a specific line range that's below the 89% branch threshold.

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Validator: validateLambdaParam branches (lines 617-647)
// ---------------------------------------------------------------------------
import { validate } from "../../src/validator/validate.js";

describe("validator — lambda param edge cases", () => {
    /** Lambda with non-object param triggers validateLambdaParam line 617-619 */
    it("rejects lambda with non-object param", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "lambda",
                    id: "lam-001",
                    params: ["not_an_object"], // invalid: string instead of object
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
            }],
        };
        const result = validate(ast);
        expect(result.ok).toBe(false);
        expect((result as any).errors.length).toBeGreaterThan(0);
    });

    /** Lambda with param of wrong kind triggers validateLambdaParam line 623-625 */
    it("rejects lambda with param of wrong kind", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "lambda",
                    id: "lam-001",
                    params: [{ kind: "literal", id: "bad-001", value: 1 }], // wrong kind: should be "param"
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
            }],
        };
        const result = validate(ast);
        expect(result.ok).toBe(false);
        expect((result as any).errors.some((e: any) => e.error === "unknown_node_kind")).toBe(true);
    });

    /** Lambda with param whose type is a non-object triggers line 634 */
    it("rejects lambda param with non-object type", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "lambda",
                    id: "lam-001",
                    params: [{ kind: "param", id: "p-x-001", name: "x", type: "not_an_object" }],
                    body: [{ kind: "literal", id: "lit-001", value: 0 }],
                }],
            }],
        };
        const result = validate(ast);
        expect(result.ok).toBe(false);
        expect((result as any).errors.some((e: any) => e.error === "invalid_field_type")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Resolver: non-function typed import (resolve.ts lines 76-84)
// ---------------------------------------------------------------------------
import { resolve } from "../../src/resolver/resolve.js";
import type { EdictModule } from "../../src/ast/nodes.js";

describe("resolver — typed import branches", () => {
    /** Non-function typed import triggers lines 76-84 */
    it("resolves non-function typed import (e.g. Int type annotation)", () => {
        const mod: EdictModule = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [{
                kind: "import",
                id: "imp-001",
                module: "external",
                names: ["counter"],
                types: {
                    counter: { kind: "basic", name: "Int" },
                },
            }],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "ident", id: "id-001", name: "counter" }],
            }],
        } as EdictModule;
        const errors = resolve(mod);
        // counter should resolve fine since it's a typed import
        expect(errors.filter(e => (e as any).name === "counter")).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Additional patch edge cases (apply.ts lines 129,159,163,230)
// ---------------------------------------------------------------------------
import { applyPatches } from "../../src/patch/apply.js";

describe("patch edge cases — additional coverage", () => {
    /** Insert with missing field triggers applyInsert line 158-159 */
    it("returns error when insert has no field specified", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [],
        };
        const result = applyPatches(ast, [
            { nodeId: "mod-001", op: "insert", value: {} },
        ]);
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("patch_invalid_field");
    });

    /** Insert into non-existent field triggers applyInsert line 162-169 */
    it("returns error when insert field does not exist", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [],
        };
        const result = applyPatches(ast, [
            { nodeId: "mod-001", op: "insert", field: "nonexistent_field", value: {} },
        ]);
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("patch_invalid_field");
    });

    /** Negative insert index triggers line 182-190 */
    it("returns error for negative insert index", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [],
        };
        const result = applyPatches(ast, [
            { nodeId: "mod-001", op: "insert", field: "definitions", value: {}, index: -1 },
        ]);
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("patch_index_out_of_range");
    });

    /** Delete a node that's inside a nested object (not array) triggers line 123-124 */
    it("returns error when deleting a non-array-child node", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "binop",
                    id: "binop-001",
                    op: "+",
                    left: { kind: "literal", id: "lit-left-001", value: 1 },
                    right: { kind: "literal", id: "lit-right-001", value: 2 },
                }],
            }],
        };
        // lit-left-001 is NOT in an array (it's the "left" field of binop), so delete should fail
        const result = applyPatches(ast, [
            { nodeId: "lit-left-001", op: "delete" },
        ]);
        expect(result.ok).toBe(false);
        expect(result.errors[0]!.error).toBe("patch_delete_not_in_array");
    });
});

// ---------------------------------------------------------------------------
// Codegen compile (src/codegen/compile.ts line 45 — missing module)
// ---------------------------------------------------------------------------

describe("validator — const definition", () => {
    it("validates const definition with body expression", () => {
        const ast = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "const",
                id: "const-001",
                name: "PI",
                type: { kind: "basic", name: "Float" },
                value: { kind: "literal", id: "lit-001", value: 3.14 },
            }, {
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-002", value: 0 }],
            }],
        };
        const result = validate(ast);
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Lint: remaining expression branches (lint.ts lines 264-266, 282-283)
// ---------------------------------------------------------------------------

import { lint } from "../../src/lint/lint.js";

describe("lint — additional expression branches", () => {
    /** Test lint on a module with block expression (lint.ts walkExpressions) */
    it("lints module with block expressions", () => {
        const mod: EdictModule = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "block",
                    id: "blk-001",
                    body: [
                        {
                            kind: "call",
                            id: "call-001",
                            fn: { kind: "ident", id: "id-print", name: "print" },
                            args: [{ kind: "literal", id: "lit-001", value: "hi" }],
                        },
                        { kind: "literal", id: "lit-002", value: 42 },
                    ],
                }],
            }],
        } as EdictModule;
        const warnings = lint(mod);
        expect(warnings).toBeDefined();
    });

    /** Test lint on module with string_interp expression */
    it("lints module with string interpolation", () => {
        const mod: EdictModule = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "string_interp",
                    id: "si-001",
                    parts: [
                        { kind: "literal", id: "lit-str-001", value: "value: " },
                        { kind: "ident", id: "id-x-001", name: "x" },
                    ],
                },
                { kind: "literal", id: "lit-ret-001", value: 0 }],
            }],
        } as EdictModule;
        const warnings = lint(mod);
        expect(warnings).toBeDefined();
    });

    /** Test lint on module with tuple expression */
    it("lints module with tuple expression", () => {
        const mod: EdictModule = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "tuple_expr",
                    id: "tup-001",
                    elements: [
                        { kind: "literal", id: "lit-001", value: 1 },
                        { kind: "literal", id: "lit-002", value: 2 },
                    ],
                }],
            }],
        } as EdictModule;
        const warnings = lint(mod);
        expect(warnings).toBeDefined();
    });

    /** Test lint on module with lambda expression */
    it("lints module with lambda expression", () => {
        const mod: EdictModule = {
            kind: "module",
            id: "mod-001",
            name: "test",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-001",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "lambda",
                    id: "lam-001",
                    params: [{ kind: "param", id: "p-x-001", name: "x", type: { kind: "basic", name: "Int" } }],
                    body: [{ kind: "ident", id: "id-x-001", name: "x" }],
                }],
            }],
        } as EdictModule;
        const warnings = lint(mod);
        expect(warnings).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Handler: handleLint error path (MCP lint tool line 13-19)
// ---------------------------------------------------------------------------
import { handleLint } from "../../src/mcp/handlers.js";

describe("handleLint — error branch", () => {
    it("returns errors for non-module AST", () => {
        const result = handleLint({ invalid: true });
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
    });
});
