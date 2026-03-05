// =============================================================================
// Error Catalog Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { handleErrorCatalog } from "../../src/mcp/handlers.js";
import type { ErrorCatalog, ErrorCatalogEntry } from "../../src/errors/error-catalog.js";

// All error type discriminators from the StructuredError union
const ALL_ERROR_TYPES = [
    // Phase 1 — Validation
    "duplicate_id",
    "unknown_node_kind",
    "missing_field",
    "invalid_field_type",
    "invalid_effect",
    "invalid_operator",
    "invalid_basic_type_name",
    "conflicting_effects",
    // Phase 2 — Resolution
    "undefined_reference",
    "duplicate_definition",
    "unknown_record",
    "unknown_enum",
    "unknown_variant",
    // Phase 2 — Type checking
    "type_mismatch",
    "arity_mismatch",
    "not_a_function",
    "unknown_field",
    "missing_record_fields",
    // Phase 3 — Effect checking
    "effect_violation",
    "effect_in_pure",
    // Phase 4 — Contract verification
    "contract_failure",
    "verification_timeout",
    "undecidable_predicate",
    "precondition_not_met",
    // Phase 5 — Codegen
    "wasm_validation_error",
    // Patch errors
    "patch_node_not_found",
    "patch_invalid_field",
    "patch_index_out_of_range",
    "patch_delete_not_in_array",
    // Lint warnings
    "unused_variable",
    "unused_import",
    "missing_contract",
    "oversized_function",
    "empty_body",
    "redundant_effect",
];

describe("handleErrorCatalog", () => {
    let catalog: ErrorCatalog;

    // Load catalog once for all tests
    catalog = handleErrorCatalog();

    it("returns a catalog with the correct count", () => {
        expect(catalog.count).toBe(catalog.errors.length);
        expect(catalog.count).toBe(ALL_ERROR_TYPES.length);
    });

    it("covers every StructuredError type", () => {
        const catalogTypes = catalog.errors.map((e) => e.type);
        for (const errorType of ALL_ERROR_TYPES) {
            expect(catalogTypes, `missing error type: ${errorType}`).toContain(errorType);
        }
    });

    it("has no duplicate error types", () => {
        const types = catalog.errors.map((e) => e.type);
        const unique = new Set(types);
        expect(unique.size).toBe(types.length);
    });

    it("every entry has the required fields", () => {
        for (const entry of catalog.errors) {
            expect(entry.type).toBeTruthy();
            expect(entry.pipeline_stage).toBeTruthy();
            expect(entry.fields).toBeInstanceOf(Array);
            expect(entry.fields.length).toBeGreaterThan(0);
            expect(entry.example_cause).toBeDefined();
            expect(entry.example_fix).toBeDefined();
        }
    });

    it("every entry has a valid pipeline_stage", () => {
        const validStages = ["validator", "resolver", "type_checker", "effect_checker", "contract_verifier", "codegen", "patch", "lint"];
        for (const entry of catalog.errors) {
            expect(validStages, `invalid pipeline_stage: ${entry.pipeline_stage} for ${entry.type}`).toContain(entry.pipeline_stage);
        }
    });

    it("every field entry has name and type", () => {
        for (const entry of catalog.errors) {
            for (const field of entry.fields) {
                expect(field.name).toBeTruthy();
                expect(field.type).toBeTruthy();
            }
        }
    });

    it("example_cause and example_fix are different for each entry", () => {
        for (const entry of catalog.errors) {
            expect(
                JSON.stringify(entry.example_cause),
                `example_cause and example_fix should differ for ${entry.type}`,
            ).not.toBe(JSON.stringify(entry.example_fix));
        }
    });

    it("groups errors by pipeline stage correctly", () => {
        const stageMap = new Map<string, string[]>();
        for (const entry of catalog.errors) {
            const list = stageMap.get(entry.pipeline_stage) || [];
            list.push(entry.type);
            stageMap.set(entry.pipeline_stage, list);
        }

        // Validator errors
        const validatorErrors = stageMap.get("validator") || [];
        expect(validatorErrors).toContain("duplicate_id");
        expect(validatorErrors).toContain("unknown_node_kind");
        expect(validatorErrors).toContain("missing_field");

        // Resolver errors
        const resolverErrors = stageMap.get("resolver") || [];
        expect(resolverErrors).toContain("undefined_reference");
        expect(resolverErrors).toContain("duplicate_definition");

        // Type checker errors
        const typeCheckerErrors = stageMap.get("type_checker") || [];
        expect(typeCheckerErrors).toContain("type_mismatch");
        expect(typeCheckerErrors).toContain("arity_mismatch");

        // Effect errors
        const effectErrors = stageMap.get("effect_checker") || [];
        expect(effectErrors).toContain("effect_violation");
        expect(effectErrors).toContain("effect_in_pure");

        // Contract errors
        const contractErrors = stageMap.get("contract_verifier") || [];
        expect(contractErrors).toContain("contract_failure");
        expect(contractErrors).toContain("precondition_not_met");

        // Codegen errors
        const codegenErrors = stageMap.get("codegen") || [];
        expect(codegenErrors).toContain("wasm_validation_error");

        // Patch errors
        const patchErrors = stageMap.get("patch") || [];
        expect(patchErrors).toContain("patch_node_not_found");
    });

    it("is serializable as JSON", () => {
        const json = JSON.stringify(catalog);
        const parsed = JSON.parse(json);
        expect(parsed.count).toBe(catalog.count);
        expect(parsed.errors).toHaveLength(catalog.errors.length);
    });
});
