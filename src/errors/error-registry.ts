// =============================================================================
// Error Registry — Single source of truth for error type metadata
// =============================================================================
// Each error type is registered with its pipeline stage and a factory that
// produces a sample instance. The catalog auto-derives `fields` from samples.
// When adding a new error type:
//   1. Add the interface + constructor in structured-errors.ts
//   2. Add a registry entry here (type + stage + make)
//   3. Add examples in error-catalog.ts (example_cause + example_fix)

import type { ErrorCatalogEntry } from "./error-catalog.js";
import {
    duplicateId,
    unknownNodeKind,
    missingField,
    invalidFieldType,
    invalidEffect,
    invalidOperator,
    invalidBasicTypeName,
    conflictingEffects,
    undefinedReference,
    duplicateDefinition,
    unknownRecord,
    unknownEnum,
    unknownVariant,
    typeMismatch,
    unitMismatch,
    arityMismatch,
    notAFunction,
    unknownField,
    missingRecordFields,
    functionComplexityExceeded,
    moduleComplexityExceeded,
    effectViolation,
    effectInPure,
    contractFailure,
    verificationTimeout,
    undecidablePredicate,
    preconditionNotMet,
    patchNodeNotFound,
    patchInvalidField,
    patchIndexOutOfRange,
    patchDeleteNotInArray,
    wasmValidationError,
    missingEntryPoint,
    unsatisfiedRequirement,
    duplicateProvision,
    circularImport,
    unresolvedModule,
    duplicateModuleName,
    missingExternalModule,
} from "./structured-errors.js";

// =============================================================================
// Registry entry type
// =============================================================================

export interface ErrorRegistryEntry {
    /** Error discriminator string */
    type: string;
    /** Pipeline stage */
    stage: ErrorCatalogEntry["pipeline_stage"];
    /** Factory producing a sample error with all fields populated */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    make: () => any;
    /** Factory producing a sample with optional fields included (if different) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeWithOptionals?: () => any;
}

// =============================================================================
// Dummy type helpers for constructing samples
// =============================================================================

const basicInt = { kind: "basic", name: "Int" } as const;
const basicStr = { kind: "basic", name: "String" } as const;
const dummySuggestion = { nodeId: "n", field: "f", value: "v" };

// =============================================================================
// Registry
// =============================================================================

export const ERROR_REGISTRY: ErrorRegistryEntry[] = [
    // Phase 1 — Validation
    { type: "duplicate_id",           stage: "validator",          make: () => duplicateId("n", "a", "b") },
    { type: "unknown_node_kind",      stage: "validator",          make: () => unknownNodeKind("p", "x", ["fn"]) },
    { type: "missing_field",          stage: "validator",          make: () => missingField("p", "n", "f", "fmt") },
    { type: "invalid_field_type",     stage: "validator",          make: () => invalidFieldType("p", "n", "f", "exp", "act") },
    { type: "invalid_effect",         stage: "validator",          make: () => invalidEffect("p", "n", "x", ["io"]) },
    { type: "invalid_operator",       stage: "validator",          make: () => invalidOperator("p", "n", "x", ["+"]) },
    { type: "invalid_basic_type_name", stage: "validator",         make: () => invalidBasicTypeName("p", "n", "x", ["Int"]) },
    { type: "conflicting_effects",    stage: "validator",          make: () => conflictingEffects("p", "n", ["pure", "io"]) },

    // Phase 2a — Name resolution
    { type: "undefined_reference",    stage: "resolver",           make: () => undefinedReference("n", "x", ["a"]),
                                                                   makeWithOptionals: () => undefinedReference("n", "x", ["a"], dummySuggestion) },
    { type: "duplicate_definition",   stage: "resolver",           make: () => duplicateDefinition("n", "x", "n2") },
    { type: "unknown_record",         stage: "resolver",           make: () => unknownRecord("n", "x", ["a"]),
                                                                   makeWithOptionals: () => unknownRecord("n", "x", ["a"], dummySuggestion) },
    { type: "unknown_enum",           stage: "resolver",           make: () => unknownEnum("n", "x", ["a"]),
                                                                   makeWithOptionals: () => unknownEnum("n", "x", ["a"], dummySuggestion) },
    { type: "unknown_variant",        stage: "resolver",           make: () => unknownVariant("n", "e", "v", ["a"]),
                                                                   makeWithOptionals: () => unknownVariant("n", "e", "v", ["a"], dummySuggestion) },

    // Phase 2b — Type checking
    { type: "type_mismatch",          stage: "type_checker",       make: () => typeMismatch("n", basicInt, basicStr),
                                                                   makeWithOptionals: () => typeMismatch("n", basicInt, basicStr, dummySuggestion) },
    { type: "unit_mismatch",          stage: "type_checker",       make: () => unitMismatch("n", "m", "kg", "Int", "Int") },
    { type: "arity_mismatch",         stage: "type_checker",       make: () => arityMismatch("n", 2, 1) },
    { type: "not_a_function",         stage: "type_checker",       make: () => notAFunction("n", basicInt) },
    { type: "unknown_field",          stage: "type_checker",       make: () => unknownField("n", "R", "f", ["a"]),
                                                                   makeWithOptionals: () => unknownField("n", "R", "f", ["a"], dummySuggestion) },
    { type: "missing_record_fields",  stage: "type_checker",       make: () => missingRecordFields("n", "R", ["f"]),
                                                                   makeWithOptionals: () => missingRecordFields("n", "R", ["f"], dummySuggestion) },

    // Phase 2c — Complexity checking
    { type: "function_complexity_exceeded", stage: "complexity_checker", make: () => functionComplexityExceeded("n", "fn", "maxAstNodes", 100, 50) },
    { type: "module_complexity_exceeded",   stage: "complexity_checker", make: () => moduleComplexityExceeded("maxAstNodes", 100, 50) },

    // Phase 3 — Effect checking
    { type: "effect_violation",       stage: "effect_checker",     make: () => effectViolation("n", "fn", ["io"], "cs", "callee"),
                                                                   makeWithOptionals: () => effectViolation("n", "fn", ["io"], "cs", "callee", dummySuggestion) },
    { type: "effect_in_pure",         stage: "effect_checker",     make: () => effectInPure("n", "fn", "cs", "callee", ["io"]),
                                                                   makeWithOptionals: () => effectInPure("n", "fn", "cs", "callee", ["io"], dummySuggestion) },

    // Phase 4 — Contract verification
    { type: "contract_failure",       stage: "contract_verifier",  make: () => contractFailure("n", "c", "fn", "post", { x: 0 }) },
    { type: "verification_timeout",   stage: "contract_verifier",  make: () => verificationTimeout("n", "c", "fn", 5000) },
    { type: "undecidable_predicate",  stage: "contract_verifier",  make: () => undecidablePredicate("n", "c", "fn", "call") },
    { type: "precondition_not_met",   stage: "contract_verifier",  make: () => preconditionNotMet("n", "cs", "caller", "callee", "c", { x: 0 }) },

    // Patch errors
    { type: "patch_node_not_found",   stage: "patch",              make: () => patchNodeNotFound("n", 0) },
    { type: "patch_invalid_field",    stage: "patch",              make: () => patchInvalidField("n", "f", ["a"], 0) },
    { type: "patch_index_out_of_range", stage: "patch",            make: () => patchIndexOutOfRange("n", "f", 5, 3, 0) },
    { type: "patch_delete_not_in_array", stage: "patch",           make: () => patchDeleteNotInArray("n", 0) },

    // Phase 5 — Codegen
    { type: "wasm_validation_error",  stage: "codegen",            make: () => wasmValidationError("msg") },
    { type: "missing_entry_point",    stage: "codegen",            make: () => missingEntryPoint("main") },

    // Composition errors
    { type: "unsatisfied_requirement", stage: "codegen",           make: () => unsatisfiedRequirement("frag", "req", ["a"]) },
    { type: "duplicate_provision",     stage: "codegen",           make: () => duplicateProvision("name", ["f1", "f2"]) },

    // Multi-module errors
    { type: "circular_import",        stage: "resolver",           make: () => circularImport(["a", "b"]) },
    { type: "unresolved_module",      stage: "resolver",           make: () => unresolvedModule("mod", "imp", ["a"]) },
    { type: "duplicate_module_name",  stage: "resolver",           make: () => duplicateModuleName("mod", ["m1", "m2"]) },

    // Runtime errors
    { type: "missing_external_module", stage: "codegen",           make: () => missingExternalModule("mod", ["a"]) },
];

// =============================================================================
// Field derivation
// =============================================================================

/**
 * Infer a human-readable type string from a runtime value.
 * Used to auto-populate the `fields[].type` in the error catalog.
 */
export function inferFieldType(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value)) {
        if (value.length === 0) return "unknown[]";
        const elemType = inferFieldType(value[0]);
        return `${elemType}[]`;
    }
    if (typeof value === "object") {
        // Check for TypeExpr-like objects
        if ("kind" in value && typeof (value as Record<string, unknown>).kind === "string") {
            return "TypeExpr";
        }
        // Check for FixSuggestion-like objects
        if ("nodeId" in value && "field" in value && "value" in value) {
            return "FixSuggestion";
        }
        return "Record<string, unknown>";
    }
    return "unknown";
}

/**
 * Extract fields from a sample error object, excluding the `error` discriminator.
 * Merges required fields (from `make()`) with optional fields (from `makeWithOptionals()`).
 */
export function deriveFieldsFromSample(
    entry: ErrorRegistryEntry,
): { name: string; type: string }[] {
    const sample = entry.make() as Record<string, unknown>;
    const requiredKeys = new Set(Object.keys(sample).filter(k => k !== "error"));

    // If there's a makeWithOptionals, find the extra fields
    let allKeys = requiredKeys;
    let optionalSample: Record<string, unknown> | null = null;
    if (entry.makeWithOptionals) {
        optionalSample = entry.makeWithOptionals() as Record<string, unknown>;
        allKeys = new Set([
            ...requiredKeys,
            ...Object.keys(optionalSample).filter(k => k !== "error"),
        ]);
    }

    const fields: { name: string; type: string }[] = [];
    for (const key of allKeys) {
        const isOptional = !requiredKeys.has(key);
        const value = optionalSample && key in optionalSample
            ? optionalSample[key]
            : sample[key];
        let type = inferFieldType(value);
        if (isOptional) type += "?";
        fields.push({ name: key, type });
    }

    return fields;
}
