// =============================================================================
// Error Catalog — Machine-readable catalog of all structured error types
// =============================================================================
// Fields are auto-derived from the error registry (constructor samples).
// Only examples (example_cause / example_fix) are hand-written.
// To add a new error type:
//   1. Add interface + constructor in structured-errors.ts
//   2. Add registry entry in error-registry.ts (type + stage + make)
//   3. Add examples below in ERROR_EXAMPLES

import {
    ERROR_REGISTRY,
    deriveFieldsFromSample,
} from "./error-registry.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A single entry in the error catalog.
 */
export interface ErrorCatalogEntry {
    /** Discriminator string (e.g., "type_mismatch") */
    type: string;
    /** Pipeline stage that produces this error */
    pipeline_stage: "validator" | "resolver" | "type_checker" | "complexity_checker" | "effect_checker" | "contract_verifier" | "codegen" | "patch" | "lint";
    /** All fields present on this error (excluding the `error` discriminator) */
    fields: { name: string; type: string }[];
    /** Minimal AST that triggers this error */
    example_cause: Record<string, unknown>;
    /** The corrected AST that fixes the error */
    example_fix: Record<string, unknown>;
}

/**
 * The full error catalog returned by the edict://errors resource.
 */
export interface ErrorCatalog {
    /** Total number of error types */
    count: number;
    /** All error types grouped by pipeline stage */
    errors: ErrorCatalogEntry[];
}

// =============================================================================
// Hand-written examples — only thing that can't be auto-derived
// =============================================================================

interface ExamplePair {
    cause: Record<string, unknown>;
    fix: Record<string, unknown>;
}

const ERROR_EXAMPLES: Record<string, ExamplePair> = {
    // =========================================================================
    // Phase 1 — Validation
    // =========================================================================
    duplicate_id: {
        cause: {
            kind: "module", name: "test",
            definitions: [
                { kind: "fn", id: "fn-main-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] },
                { kind: "fn", id: "fn-main-001", name: "helper", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-002", value: 2 }] },
            ],
        },
        fix: {
            kind: "module", name: "test",
            definitions: [
                { kind: "fn", id: "fn-main-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] },
                { kind: "fn", id: "fn-helper-001", name: "helper", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-002", value: 2 }] },
            ],
        },
    },
    unknown_node_kind: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "function", id: "fn-001", name: "main" }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    missing_field: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main" }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    invalid_field_type: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: 42, params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    invalid_effect: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["network"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    invalid_operator: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "binop", id: "binop-001", op: "**", left: { kind: "literal", id: "lit-001", value: 2 }, right: { kind: "literal", id: "lit-002", value: 3 } }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "binop", id: "binop-001", op: "*", left: { kind: "literal", id: "lit-001", value: 2 }, right: { kind: "literal", id: "lit-002", value: 3 } }] }] },
    },
    invalid_basic_type_name: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Integer" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    conflicting_effects: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure", "io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },

    // =========================================================================
    // Phase 2a — Name resolution
    // =========================================================================
    undefined_reference: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-001", name: "undeclaredVar" }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 42 }] }] },
    },
    duplicate_definition: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] },
            { kind: "fn", id: "fn-002", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-002", value: 2 }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] },
            { kind: "fn", id: "fn-002", name: "helper", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-002", value: 2 }] },
        ] },
    },
    unknown_record: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "record_expr", id: "rec-001", name: "NonExistent", fields: [] }] }] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "record", id: "rec-def-001", name: "Point", fields: [{ kind: "field", id: "fld-x-001", name: "x", type: { kind: "basic", name: "Int" } }, { kind: "field", id: "fld-y-001", name: "y", type: { kind: "basic", name: "Int" } }] },
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "named", name: "Point" }, contracts: [], body: [{ kind: "record_expr", id: "rec-001", name: "Point", fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "lit-001", value: 0 } }, { kind: "field_init", name: "y", value: { kind: "literal", id: "lit-002", value: 0 } }] }] },
        ] },
    },
    unknown_enum: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "enum_constructor", id: "en-001", enumName: "NonExistent", variant: "A", fields: [{ kind: "field_init", name: "value", value: { kind: "literal", id: "lit-001", value: 1 } }] }] }] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "enum", id: "enum-def-001", name: "Color", variants: [{ kind: "variant", id: "var-red-001", name: "Red", fields: [{ kind: "field", id: "fld-r-001", name: "value", type: { kind: "basic", name: "Int" } }] }] },
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "named", name: "Color" }, contracts: [], body: [{ kind: "enum_constructor", id: "en-001", enumName: "Color", variant: "Red", fields: [{ kind: "field_init", name: "value", value: { kind: "literal", id: "lit-001", value: 1 } }] }] },
        ] },
    },
    unknown_variant: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "enum", id: "enum-001", name: "Color", variants: [{ kind: "variant", id: "var-red-002", name: "Red", fields: [{ kind: "field", id: "fld-r-002", name: "value", type: { kind: "basic", name: "Int" } }] }] },
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "enum_constructor", id: "en-001", enumName: "Color", variant: "Blue", fields: [{ kind: "field_init", name: "value", value: { kind: "literal", id: "lit-001", value: 1 } }] }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "enum", id: "enum-001", name: "Color", variants: [{ kind: "variant", id: "var-red-003", name: "Red", fields: [{ kind: "field", id: "fld-r-003", name: "value", type: { kind: "basic", name: "Int" } }] }] },
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "named", name: "Color" }, contracts: [], body: [{ kind: "enum_constructor", id: "en-001", enumName: "Color", variant: "Red", fields: [{ kind: "field_init", name: "value", value: { kind: "literal", id: "lit-001", value: 1 } }] }] },
        ] },
    },

    // =========================================================================
    // Phase 2b — Type checking
    // =========================================================================
    type_mismatch: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: "hello" }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 42 }] }] },
    },
    arity_mismatch: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-001", name: "add", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "basic", name: "Int" } }, { kind: "param", id: "p-002", name: "b", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "binop", id: "bin-001", op: "+", left: { kind: "ident", id: "id-001", name: "a" }, right: { kind: "ident", id: "id-002", name: "b" } }] },
            { kind: "fn", id: "fn-002", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-add-001", name: "add" }, args: [{ kind: "literal", id: "lit-001", value: 1 }] }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-001", name: "add", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "basic", name: "Int" } }, { kind: "param", id: "p-002", name: "b", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "binop", id: "bin-001", op: "+", left: { kind: "ident", id: "id-001", name: "a" }, right: { kind: "ident", id: "id-002", name: "b" } }] },
            { kind: "fn", id: "fn-002", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-add-002", name: "add" }, args: [{ kind: "literal", id: "lit-001", value: 1 }, { kind: "literal", id: "lit-002", value: 2 }] }] },
        ] },
    },
    not_a_function: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-x-call", name: "x" }, args: [] }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-001", name: "x" }] }] },
    },
    unknown_field: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "record", id: "rec-001", name: "Point", fields: [{ kind: "field", id: "fld-x-002", name: "x", type: { kind: "basic", name: "Int" } }, { kind: "field", id: "fld-y-002", name: "y", type: { kind: "basic", name: "Int" } }] },
            { kind: "fn", id: "fn-001", name: "main", params: [{ kind: "param", id: "p-001", name: "p", type: { kind: "named", name: "Point" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "access", id: "acc-001", target: { kind: "ident", id: "id-001", name: "p" }, field: "z" }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "record", id: "rec-001", name: "Point", fields: [{ kind: "field", id: "fld-x-003", name: "x", type: { kind: "basic", name: "Int" } }, { kind: "field", id: "fld-y-003", name: "y", type: { kind: "basic", name: "Int" } }] },
            { kind: "fn", id: "fn-001", name: "main", params: [{ kind: "param", id: "p-001", name: "p", type: { kind: "named", name: "Point" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "access", id: "acc-001", target: { kind: "ident", id: "id-001", name: "p" }, field: "x" }] },
        ] },
    },
    missing_record_fields: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "record", id: "rec-001", name: "Point", fields: [{ kind: "field", id: "fld-x-004", name: "x", type: { kind: "basic", name: "Int" } }, { kind: "field", id: "fld-y-004", name: "y", type: { kind: "basic", name: "Int" } }] },
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "record_expr", id: "rl-001", name: "Point", fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "lit-001", value: 1 } }] }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "record", id: "rec-001", name: "Point", fields: [{ kind: "field", id: "fld-x-005", name: "x", type: { kind: "basic", name: "Int" } }, { kind: "field", id: "fld-y-005", name: "y", type: { kind: "basic", name: "Int" } }] },
            { kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "named", name: "Point" }, contracts: [], body: [{ kind: "record_expr", id: "rl-001", name: "Point", fields: [{ kind: "field_init", name: "x", value: { kind: "literal", id: "lit-001", value: 1 } }, { kind: "field_init", name: "y", value: { kind: "literal", id: "lit-002", value: 2 } }] }] },
        ] },
    },

    // =========================================================================
    // Phase 2c — Complexity checking
    // =========================================================================
    function_complexity_exceeded: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], constraints: { kind: "constraints", maxAstNodes: 2 }, body: [{ kind: "binop", id: "bin-001", op: "+", left: { kind: "literal", id: "lit-1", value: 1 }, right: { kind: "literal", id: "lit-2", value: 2 } }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], constraints: { kind: "constraints", maxAstNodes: 10 }, body: [{ kind: "binop", id: "bin-001", op: "+", left: { kind: "literal", id: "lit-1", value: 1 }, right: { kind: "literal", id: "lit-2", value: 2 } }] }] },
    },
    module_complexity_exceeded: {
        cause: { kind: "module", name: "test", budget: { kind: "constraints", maxAstNodes: 2 }, definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] }] },
        fix: { kind: "module", name: "test", budget: { kind: "constraints", maxAstNodes: 10 }, definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] }] },
    },

    // =========================================================================
    // Phase 3 — Effect checking
    // =========================================================================
    effect_violation: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "greet", params: [], effects: ["reads"], returnType: { kind: "basic", name: "String" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-print-001", name: "print" }, args: [{ kind: "literal", id: "lit-001", value: "hi" }] }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "greet", params: [], effects: ["io"], returnType: { kind: "basic", name: "String" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-print-002", name: "print" }, args: [{ kind: "literal", id: "lit-001", value: "hi" }] }] }] },
    },
    effect_in_pure: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "greet", params: [], effects: ["pure"], returnType: { kind: "basic", name: "String" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-print-003", name: "print" }, args: [{ kind: "literal", id: "lit-001", value: "hi" }] }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "greet", params: [], effects: ["io"], returnType: { kind: "basic", name: "String" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-print-004", name: "print" }, args: [{ kind: "literal", id: "lit-001", value: "hi" }] }] }] },
    },

    // =========================================================================
    // Phase 4 — Contract verification
    // =========================================================================
    contract_failure: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "abs", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "post", id: "post-001", condition: { kind: "binop", id: "cmp-001", op: ">", left: { kind: "ident", id: "id-r", name: "result" }, right: { kind: "literal", id: "lit-z", value: 0 } } }], body: [{ kind: "ident", id: "id-001", name: "x" }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "abs", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "post", id: "post-001", condition: { kind: "binop", id: "cmp-001", op: ">=", left: { kind: "ident", id: "id-r", name: "result" }, right: { kind: "literal", id: "lit-z", value: 0 } } }], body: [{ kind: "if", id: "if-001", condition: { kind: "binop", id: "cmp-002", op: ">=", left: { kind: "ident", id: "id-x1", name: "x" }, right: { kind: "literal", id: "lit-001", value: 0 } }, then: [{ kind: "ident", id: "id-x2", name: "x" }], else: [{ kind: "binop", id: "neg-001", op: "*", left: { kind: "literal", id: "lit-m1", value: -1 }, right: { kind: "ident", id: "id-x3", name: "x" } }] }] }] },
    },
    verification_timeout: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "complex", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "post", id: "post-001", condition: { kind: "binop", id: "cmp-t1", op: ">", left: { kind: "binop", id: "mul-t1", op: "*", left: { kind: "ident", id: "id-r-t1", name: "result" }, right: { kind: "ident", id: "id-r-t2", name: "result" } }, right: { kind: "binop", id: "mul-t2", op: "*", left: { kind: "ident", id: "id-r-t3", name: "result" }, right: { kind: "literal", id: "lit-t1", value: -1 } } } }], body: [{ kind: "binop", id: "add-001", op: "+", left: { kind: "ident", id: "id-001", name: "x" }, right: { kind: "literal", id: "lit-002", value: 1 } }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "complex", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "binop", id: "add-001", op: "+", left: { kind: "ident", id: "id-001", name: "x" }, right: { kind: "literal", id: "lit-002", value: 1 } }] }] },
    },
    undecidable_predicate: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-helper", name: "helper", params: [{ kind: "param", id: "p-h", name: "n", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-h", name: "n" }] },
            { kind: "fn", id: "fn-001", name: "f", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "post", id: "post-001", condition: { kind: "binop", id: "cmp-ud", op: ">", left: { kind: "call", id: "call-ud", fn: { kind: "ident", id: "id-hcall", name: "helper" }, args: [{ kind: "ident", id: "id-r", name: "result" }] }, right: { kind: "literal", id: "lit-ud", value: 0 } } }], body: [{ kind: "ident", id: "id-001", name: "x" }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-helper", name: "helper", params: [{ kind: "param", id: "p-h", name: "n", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-h", name: "n" }] },
            { kind: "fn", id: "fn-001", name: "f", params: [{ kind: "param", id: "p-001", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-001", name: "x" }] },
        ] },
    },
    precondition_not_met: {
        cause: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-001", name: "divide", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "basic", name: "Int" } }, { kind: "param", id: "p-002", name: "b", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "pre", id: "pre-001", condition: { kind: "binop", id: "cmp-001", op: "!=", left: { kind: "ident", id: "id-b", name: "b" }, right: { kind: "literal", id: "lit-z", value: 0 } } }], body: [{ kind: "binop", id: "div-001", op: "/", left: { kind: "ident", id: "id-a", name: "a" }, right: { kind: "ident", id: "id-b2", name: "b" } }] },
            { kind: "fn", id: "fn-002", name: "main", params: [{ kind: "param", id: "p-003", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-div-001", name: "divide" }, args: [{ kind: "ident", id: "id-x", name: "x" }, { kind: "literal", id: "lit-001", value: 0 }] }] },
        ] },
        fix: { kind: "module", name: "test", definitions: [
            { kind: "fn", id: "fn-001", name: "divide", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "basic", name: "Int" } }, { kind: "param", id: "p-002", name: "b", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "pre", id: "pre-001", condition: { kind: "binop", id: "cmp-001", op: "!=", left: { kind: "ident", id: "id-b", name: "b" }, right: { kind: "literal", id: "lit-z", value: 0 } } }], body: [{ kind: "binop", id: "div-001", op: "/", left: { kind: "ident", id: "id-a", name: "a" }, right: { kind: "ident", id: "id-b2", name: "b" } }] },
            { kind: "fn", id: "fn-002", name: "main", params: [{ kind: "param", id: "p-003", name: "x", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-div-002", name: "divide" }, args: [{ kind: "ident", id: "id-x", name: "x" }, { kind: "literal", id: "lit-001", value: 1 }] }] },
        ] },
    },

    // =========================================================================
    // Phase 5 — Codegen
    // =========================================================================
    wasm_validation_error: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "bad_codegen", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-001", name: "internal_compiler_error" }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "bad_codegen", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] }] },
    },

    // =========================================================================
    // Patch errors
    // =========================================================================
    patch_node_not_found: {
        cause: { patches: [{ nodeId: "nonexistent-001", op: "replace", field: "name", value: "fixed" }] },
        fix: { patches: [{ nodeId: "fn-main-001", op: "replace", field: "name", value: "fixed" }] },
    },
    patch_invalid_field: {
        cause: { patches: [{ nodeId: "fn-main-001", op: "replace", field: "nonexistent", value: "x" }] },
        fix: { patches: [{ nodeId: "fn-main-001", op: "replace", field: "name", value: "x" }] },
    },
    patch_index_out_of_range: {
        cause: { patches: [{ nodeId: "fn-main-001", op: "insert", field: "params", index: 999, value: {} }] },
        fix: { patches: [{ nodeId: "fn-main-001", op: "insert", field: "params", index: 0, value: {} }] },
    },
    patch_delete_not_in_array: {
        cause: { patches: [{ nodeId: "fn-main-001", op: "delete" }] },
        fix: { patches: [{ nodeId: "fn-main-001", op: "replace", field: "name", value: "updated" }] },
    },

    // =========================================================================
    // Lint warnings
    // =========================================================================
    unused_variable: {
        cause: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "let", id: "let-001", name: "unused", type: { kind: "basic", name: "Int" }, value: { kind: "literal", id: "lit-001", value: 42 } }, { kind: "literal", id: "lit-002", value: 0 }] }] },
        fix: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-002", value: 0 }] }] },
    },
    unused_import: {
        cause: { kind: "module", id: "mod-001", name: "test", imports: [{ kind: "import", id: "imp-001", module: "std", names: ["map"] }], definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
        fix: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    missing_contract: {
        cause: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "add", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "ident", id: "id-001", name: "a" }] }] },
        fix: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "add", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "basic", name: "Int" } }], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [{ kind: "post", id: "post-001", condition: { kind: "binop", id: "cmp-001", op: ">=", left: { kind: "ident", id: "id-r", name: "result" }, right: { kind: "literal", id: "lit-z", value: 0 } } }], body: [{ kind: "ident", id: "id-001", name: "a" }] }] },
    },
    oversized_function: {
        cause: { _note: "Function with >50 recursive expression nodes" },
        fix: { _note: "Split into smaller helper functions" },
    },
    empty_body: {
        cause: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "stub", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [] }] },
        fix: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "stub", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    redundant_effect: {
        cause: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "helper", params: [], effects: ["io"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 42 }] }] },
        fix: { kind: "module", id: "mod-001", name: "test", imports: [], definitions: [{ kind: "fn", id: "fn-001", name: "helper", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 42 }] }] },
    },

    // =========================================================================
    // Multi-module errors
    // =========================================================================
    circular_import: {
        cause: { modules: [
            { kind: "module", id: "mod-a-001", name: "a", imports: [{ kind: "import", id: "imp-a-001", module: "b", names: ["fb"] }], definitions: [] },
            { kind: "module", id: "mod-b-001", name: "b", imports: [{ kind: "import", id: "imp-b-001", module: "a", names: ["fa"] }], definitions: [] },
        ] },
        fix: { modules: [
            { kind: "module", id: "mod-a-001", name: "a", imports: [], definitions: [{ kind: "fn", id: "fn-fa-001", name: "fa", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 1 }] }] },
            { kind: "module", id: "mod-b-001", name: "b", imports: [{ kind: "import", id: "imp-b-001", module: "a", names: ["fa"] }], definitions: [{ kind: "fn", id: "fn-fb-001", name: "fb", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "call", id: "call-001", fn: { kind: "ident", id: "id-fa", name: "fa" }, args: [] }] }] },
        ] },
    },
    unresolved_module: {
        cause: { modules: [{ kind: "module", id: "mod-001", name: "main", imports: [{ kind: "import", id: "imp-001", module: "nonexistent", names: ["foo"] }], definitions: [] }] },
        fix: { modules: [
            { kind: "module", id: "mod-math-001", name: "math", imports: [], definitions: [{ kind: "fn", id: "fn-foo-001", name: "foo", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 42 }] }] },
            { kind: "module", id: "mod-001", name: "main", imports: [{ kind: "import", id: "imp-001", module: "math", names: ["foo"] }], definitions: [] },
        ] },
    },
    duplicate_module_name: {
        cause: { modules: [
            { kind: "module", id: "mod-001", name: "math", imports: [], definitions: [] },
            { kind: "module", id: "mod-002", name: "math", imports: [], definitions: [] },
        ] },
        fix: { modules: [
            { kind: "module", id: "mod-001", name: "math", imports: [], definitions: [] },
            { kind: "module", id: "mod-002", name: "utils", imports: [], definitions: [] },
        ] },
    },

    // =========================================================================
    // Missing entries (no hand-written examples yet)
    // =========================================================================
    missing_entry_point: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "not_main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" }, contracts: [], body: [{ kind: "literal", id: "lit-001", value: 0 }] }] },
    },
    unsatisfied_requirement: {
        cause: { fragments: [{ kind: "fragment", id: "frag-001", provides: ["a"], requires: ["b"], imports: [], definitions: [] }] },
        fix: { fragments: [
            { kind: "fragment", id: "frag-001", provides: ["a"], requires: [], imports: [], definitions: [] },
        ] },
    },
    duplicate_provision: {
        cause: { fragments: [
            { kind: "fragment", id: "frag-001", provides: ["a"], requires: [], imports: [], definitions: [] },
            { kind: "fragment", id: "frag-002", provides: ["a"], requires: [], imports: [], definitions: [] },
        ] },
        fix: { fragments: [
            { kind: "fragment", id: "frag-001", provides: ["a"], requires: [], imports: [], definitions: [] },
            { kind: "fragment", id: "frag-002", provides: ["b"], requires: [], imports: [], definitions: [] },
        ] },
    },
    missing_external_module: {
        cause: { _note: "WASM run called without required external module" },
        fix: { _note: "Provide the external module in externalModules parameter" },
    },
    unit_mismatch: {
        cause: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "unit_type", base: "Int", unit: "meters" } }, { kind: "param", id: "p-002", name: "b", type: { kind: "unit_type", base: "Int", unit: "kg" } }], effects: ["pure"], returnType: { kind: "unit_type", base: "Int", unit: "meters" }, contracts: [], body: [{ kind: "binop", id: "binop-001", op: "+", left: { kind: "ident", id: "id-001", name: "a" }, right: { kind: "ident", id: "id-002", name: "b" } }] }] },
        fix: { kind: "module", name: "test", definitions: [{ kind: "fn", id: "fn-001", name: "main", params: [{ kind: "param", id: "p-001", name: "a", type: { kind: "unit_type", base: "Int", unit: "meters" } }, { kind: "param", id: "p-002", name: "b", type: { kind: "unit_type", base: "Int", unit: "meters" } }], effects: ["pure"], returnType: { kind: "unit_type", base: "Int", unit: "meters" }, contracts: [], body: [{ kind: "binop", id: "binop-001", op: "+", left: { kind: "ident", id: "id-001", name: "a" }, right: { kind: "ident", id: "id-002", name: "b" } }] }] },
    },
};

// =============================================================================
// Lint warning metadata (not in the StructuredError union — separate type)
// =============================================================================

interface LintMeta {
    type: string;
    stage: ErrorCatalogEntry["pipeline_stage"];
    fields: { name: string; type: string }[];
}

const LINT_WARNINGS: LintMeta[] = [
    { type: "unused_variable",    stage: "lint", fields: [{ name: "nodeId", type: "string" }, { name: "name", type: "string" }] },
    { type: "unused_import",      stage: "lint", fields: [{ name: "nodeId", type: "string" }, { name: "importModule", type: "string" }, { name: "unusedNames", type: "string[]" }] },
    { type: "missing_contract",   stage: "lint", fields: [{ name: "nodeId", type: "string" }, { name: "functionName", type: "string" }] },
    { type: "oversized_function", stage: "lint", fields: [{ name: "nodeId", type: "string" }, { name: "functionName", type: "string" }, { name: "expressionCount", type: "number" }, { name: "threshold", type: "number" }] },
    { type: "empty_body",         stage: "lint", fields: [{ name: "nodeId", type: "string" }, { name: "functionName", type: "string" }] },
    { type: "redundant_effect",   stage: "lint", fields: [{ name: "nodeId", type: "string" }, { name: "functionName", type: "string" }, { name: "redundantEffects", type: "Effect[]" }, { name: "requiredEffects", type: "Effect[]" }, { name: "suggestion", type: "FixSuggestion?" }] },
];

// =============================================================================
// Build the catalog — auto-derives fields from registry
// =============================================================================

/**
 * Build the complete error catalog. Fields are auto-derived from the error
 * registry; only examples are hand-written.
 */
export function buildErrorCatalog(): ErrorCatalog {
    const errors: ErrorCatalogEntry[] = [];

    // Registry-derived entries (StructuredError types)
    for (const entry of ERROR_REGISTRY) {
        const examples = ERROR_EXAMPLES[entry.type];
        if (!examples) continue; // skip entries without examples

        errors.push({
            type: entry.type,
            pipeline_stage: entry.stage,
            fields: deriveFieldsFromSample(entry),
            example_cause: examples.cause,
            example_fix: examples.fix,
        });
    }

    // Lint warning entries (separate type system, fields are hand-specified)
    for (const lint of LINT_WARNINGS) {
        const examples = ERROR_EXAMPLES[lint.type];
        if (!examples) continue;

        errors.push({
            type: lint.type,
            pipeline_stage: lint.stage,
            fields: lint.fields,
            example_cause: examples.cause,
            example_fix: examples.fix,
        });
    }

    return { count: errors.length, errors };
}
