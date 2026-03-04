// =============================================================================
// Edict Structured Errors
// =============================================================================
// Every compiler error is a structured JSON object with enough context
// for an agent to self-repair. No human-readable strings.

import type { Effect } from "../ast/nodes.js";
import type { TypeExpr } from "../ast/types.js";

/**
 * A concrete AST patch an agent can apply to fix an error.
 * `nodeId` identifies the node to patch, `field` is the field to change,
 * and `value` is the new value for that field.
 */
export interface FixSuggestion {
    nodeId: string | null;
    field: string;
    value: unknown;
}

/**
 * Union of all compiler errors (Phase 1–4).
 */
export type StructuredError =
    // Phase 1 — validation errors
    | DuplicateIdError
    | UnknownNodeKindError
    | MissingFieldError
    | InvalidFieldTypeError
    | InvalidEffectError
    | InvalidOperatorError
    | InvalidBasicTypeName
    | ConflictingEffectsError
    // Phase 2 — name resolution errors
    | UndefinedReferenceError
    | DuplicateDefinitionError
    | UnknownRecordError
    | UnknownEnumError
    | UnknownVariantError
    // Phase 2 — type checking errors
    | TypeMismatchError
    | ArityMismatchError
    | NotAFunctionError
    | UnknownFieldError
    | MissingRecordFieldsError
    // Phase 3 — effect checking errors
    | EffectViolationError
    | EffectInPureError
    // Phase 4 — contract verification errors
    | ContractFailureError
    | VerificationTimeoutError
    | UndecidablePredicateError
    | PreconditionNotMetError
    // Patch errors
    | PatchNodeNotFoundError
    | PatchInvalidFieldError
    | PatchIndexOutOfRangeError
    | PatchDeleteNotInArrayError
    // Phase 5 — Codegen errors
    | WasmValidationError;

// =============================================================================
// Phase 1 — Validation errors
// =============================================================================

export interface DuplicateIdError {
    error: "duplicate_id";
    nodeId: string;
    firstPath: string;
    secondPath: string;
}

export interface UnknownNodeKindError {
    error: "unknown_node_kind";
    path: string;
    received: string;
    validKinds: readonly string[];
}

export interface MissingFieldError {
    error: "missing_field";
    path: string;
    nodeId: string | null;
    field: string;
    expectedFormat: string;
}

export interface InvalidFieldTypeError {
    error: "invalid_field_type";
    path: string;
    nodeId: string | null;
    field: string;
    expectedFormat: string;
    actualFormat: string;
}

export interface InvalidEffectError {
    error: "invalid_effect";
    path: string;
    nodeId: string | null;
    received: string;
    validEffects: readonly string[];
}

export interface InvalidOperatorError {
    error: "invalid_operator";
    path: string;
    nodeId: string | null;
    received: string;
    validOperators: readonly string[];
}

export interface InvalidBasicTypeName {
    error: "invalid_basic_type_name";
    path: string;
    nodeId: string | null;
    received: string;
    validNames: readonly string[];
}

export interface ConflictingEffectsError {
    error: "conflicting_effects";
    path: string;
    nodeId: string | null;
    effectsFound: string[];
}

// =============================================================================
// Phase 2 — Name resolution errors
// =============================================================================

export interface UndefinedReferenceError {
    error: "undefined_reference";
    nodeId: string | null;
    name: string;
    candidates: string[];
    suggestion?: FixSuggestion;
}

export interface DuplicateDefinitionError {
    error: "duplicate_definition";
    nodeId: string | null;
    name: string;
    firstNodeId: string | null;
}

export interface UnknownRecordError {
    error: "unknown_record";
    nodeId: string | null;
    name: string;
    candidates: string[];
    suggestion?: FixSuggestion;
}

export interface UnknownEnumError {
    error: "unknown_enum";
    nodeId: string | null;
    name: string;
    candidates: string[];
    suggestion?: FixSuggestion;
}

export interface UnknownVariantError {
    error: "unknown_variant";
    nodeId: string | null;
    enumName: string;
    variantName: string;
    availableVariants: string[];
    suggestion?: FixSuggestion;
}

// =============================================================================
// Phase 2 — Type checking errors
// =============================================================================

export interface TypeMismatchError {
    error: "type_mismatch";
    nodeId: string | null;
    expected: TypeExpr;
    actual: TypeExpr;
    suggestion?: FixSuggestion;
}

export interface ArityMismatchError {
    error: "arity_mismatch";
    nodeId: string | null;
    expected: number;
    actual: number;
}

export interface NotAFunctionError {
    error: "not_a_function";
    nodeId: string | null;
    actualType: TypeExpr;
}

export interface UnknownFieldError {
    error: "unknown_field";
    nodeId: string | null;
    recordName: string;
    fieldName: string;
    availableFields: string[];
    suggestion?: FixSuggestion;
}

export interface MissingRecordFieldsError {
    error: "missing_record_fields";
    nodeId: string | null;
    recordName: string;
    missingFields: string[];
    suggestion?: FixSuggestion;
}

// =============================================================================
// Phase 1 error constructors
// =============================================================================

export function duplicateId(
    nodeId: string,
    firstPath: string,
    secondPath: string,
): DuplicateIdError {
    return { error: "duplicate_id", nodeId, firstPath, secondPath };
}

export function unknownNodeKind(
    path: string,
    received: string,
    validKinds: readonly string[],
): UnknownNodeKindError {
    return { error: "unknown_node_kind", path, received, validKinds };
}

export function missingField(
    path: string,
    nodeId: string | null,
    field: string,
    expectedFormat: string,
): MissingFieldError {
    return { error: "missing_field", path, nodeId, field, expectedFormat };
}

export function invalidFieldType(
    path: string,
    nodeId: string | null,
    field: string,
    expectedFormat: string,
    actualFormat: string,
): InvalidFieldTypeError {
    return { error: "invalid_field_type", path, nodeId, field, expectedFormat, actualFormat };
}

export function invalidEffect(
    path: string,
    nodeId: string | null,
    received: string,
    validEffects: readonly string[],
): InvalidEffectError {
    return { error: "invalid_effect", path, nodeId, received, validEffects };
}

export function invalidOperator(
    path: string,
    nodeId: string | null,
    received: string,
    validOperators: readonly string[],
): InvalidOperatorError {
    return {
        error: "invalid_operator",
        path,
        nodeId,
        received,
        validOperators,
    };
}

export function invalidBasicTypeName(
    path: string,
    nodeId: string | null,
    received: string,
    validNames: readonly string[],
): InvalidBasicTypeName {
    return { error: "invalid_basic_type_name", path, nodeId, received, validNames };
}

export function conflictingEffects(
    path: string,
    nodeId: string | null,
    effectsFound: string[],
): ConflictingEffectsError {
    return { error: "conflicting_effects", path, nodeId, effectsFound };
}

// =============================================================================
// Phase 2 error constructors
// =============================================================================

export function undefinedReference(
    nodeId: string | null,
    name: string,
    candidates: string[],
    suggestion?: FixSuggestion,
): UndefinedReferenceError {
    const err: UndefinedReferenceError = { error: "undefined_reference", nodeId, name, candidates };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function duplicateDefinition(
    nodeId: string | null,
    name: string,
    firstNodeId: string | null,
): DuplicateDefinitionError {
    return { error: "duplicate_definition", nodeId, name, firstNodeId };
}

export function unknownRecord(
    nodeId: string | null,
    name: string,
    candidates: string[],
    suggestion?: FixSuggestion,
): UnknownRecordError {
    const err: UnknownRecordError = { error: "unknown_record", nodeId, name, candidates };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function unknownEnum(
    nodeId: string | null,
    name: string,
    candidates: string[],
    suggestion?: FixSuggestion,
): UnknownEnumError {
    const err: UnknownEnumError = { error: "unknown_enum", nodeId, name, candidates };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function unknownVariant(
    nodeId: string | null,
    enumName: string,
    variantName: string,
    availableVariants: string[],
    suggestion?: FixSuggestion,
): UnknownVariantError {
    const err: UnknownVariantError = { error: "unknown_variant", nodeId, enumName, variantName, availableVariants };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function typeMismatch(
    nodeId: string | null,
    expected: TypeExpr,
    actual: TypeExpr,
    suggestion?: FixSuggestion,
): TypeMismatchError {
    const err: TypeMismatchError = { error: "type_mismatch", nodeId, expected, actual };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function arityMismatch(
    nodeId: string | null,
    expected: number,
    actual: number,
): ArityMismatchError {
    return { error: "arity_mismatch", nodeId, expected, actual };
}

export function notAFunction(
    nodeId: string | null,
    actualType: TypeExpr,
): NotAFunctionError {
    return { error: "not_a_function", nodeId, actualType };
}

export function unknownField(
    nodeId: string | null,
    recordName: string,
    fieldName: string,
    availableFields: string[],
    suggestion?: FixSuggestion,
): UnknownFieldError {
    const err: UnknownFieldError = { error: "unknown_field", nodeId, recordName, fieldName, availableFields };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function missingRecordFields(
    nodeId: string | null,
    recordName: string,
    missingFields: string[],
    suggestion?: FixSuggestion,
): MissingRecordFieldsError {
    const err: MissingRecordFieldsError = { error: "missing_record_fields", nodeId, recordName, missingFields };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

// =============================================================================
// Phase 3 — Effect checking errors
// =============================================================================

export interface EffectViolationError {
    error: "effect_violation";
    nodeId: string | null;
    functionName: string;
    missingEffects: Effect[];
    callSiteNodeId: string | null;
    calleeName: string;
    suggestion?: FixSuggestion;
}

export interface EffectInPureError {
    error: "effect_in_pure";
    nodeId: string | null;
    functionName: string;
    callSiteNodeId: string | null;
    calleeName: string;
    calleeEffects: Effect[];
    suggestion?: FixSuggestion;
}

// =============================================================================
// Phase 3 error constructors
// =============================================================================

export function effectViolation(
    nodeId: string | null,
    functionName: string,
    missingEffects: Effect[],
    callSiteNodeId: string | null,
    calleeName: string,
    suggestion?: FixSuggestion,
): EffectViolationError {
    const err: EffectViolationError = { error: "effect_violation", nodeId, functionName, missingEffects, callSiteNodeId, calleeName };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

export function effectInPure(
    nodeId: string | null,
    functionName: string,
    callSiteNodeId: string | null,
    calleeName: string,
    calleeEffects: Effect[],
    suggestion?: FixSuggestion,
): EffectInPureError {
    const err: EffectInPureError = { error: "effect_in_pure", nodeId, functionName, callSiteNodeId, calleeName, calleeEffects };
    if (suggestion) err.suggestion = suggestion;
    return err;
}

// =============================================================================
// Phase 4 — Contract verification errors
// =============================================================================

export interface ContractFailureError {
    error: "contract_failure";
    nodeId: string;
    contractId: string;
    functionName: string;
    contractKind: "pre" | "post";
    counterexample: Record<string, unknown>;
}

export interface VerificationTimeoutError {
    error: "verification_timeout";
    nodeId: string;
    contractId: string;
    functionName: string;
    timeoutMs: number;
}

export interface UndecidablePredicateError {
    error: "undecidable_predicate";
    nodeId: string;
    contractId: string;
    functionName: string;
    unsupportedNodeKind: string;
}

export interface PreconditionNotMetError {
    error: "precondition_not_met";
    nodeId: string;
    callSiteId: string;
    callerName: string;
    calleeName: string;
    contractId: string;
    counterexample: Record<string, unknown>;
}

// =============================================================================
// Phase 4 error constructors
// =============================================================================

export function contractFailure(
    nodeId: string,
    contractId: string,
    functionName: string,
    contractKind: "pre" | "post",
    counterexample: Record<string, unknown>,
): ContractFailureError {
    return { error: "contract_failure", nodeId, contractId, functionName, contractKind, counterexample };
}

export function verificationTimeout(
    nodeId: string,
    contractId: string,
    functionName: string,
    timeoutMs: number,
): VerificationTimeoutError {
    return { error: "verification_timeout", nodeId, contractId, functionName, timeoutMs };
}

export function undecidablePredicate(
    nodeId: string,
    contractId: string,
    functionName: string,
    unsupportedNodeKind: string,
): UndecidablePredicateError {
    return { error: "undecidable_predicate", nodeId, contractId, functionName, unsupportedNodeKind };
}

export function preconditionNotMet(
    nodeId: string,
    callSiteId: string,
    callerName: string,
    calleeName: string,
    contractId: string,
    counterexample: Record<string, unknown>,
): PreconditionNotMetError {
    return { error: "precondition_not_met", nodeId, callSiteId, callerName, calleeName, contractId, counterexample };
}

// =============================================================================
// Patch errors
// =============================================================================

export interface PatchNodeNotFoundError {
    error: "patch_node_not_found";
    nodeId: string | null;
    patchIndex: number;
}

export interface PatchInvalidFieldError {
    error: "patch_invalid_field";
    nodeId: string;
    field: string;
    availableFields: string[];
    patchIndex: number;
}

export interface PatchIndexOutOfRangeError {
    error: "patch_index_out_of_range";
    nodeId: string;
    field: string;
    index: number;
    arrayLength: number;
    patchIndex: number;
}

export interface PatchDeleteNotInArrayError {
    error: "patch_delete_not_in_array";
    nodeId: string;
    patchIndex: number;
}

// =============================================================================
// Patch error constructors
// =============================================================================

export function patchNodeNotFound(
    nodeId: string | null,
    patchIndex: number,
): PatchNodeNotFoundError {
    return { error: "patch_node_not_found", nodeId, patchIndex };
}

export function patchInvalidField(
    nodeId: string,
    field: string,
    availableFields: string[],
    patchIndex: number,
): PatchInvalidFieldError {
    return { error: "patch_invalid_field", nodeId, field, availableFields, patchIndex };
}

export function patchIndexOutOfRange(
    nodeId: string,
    field: string,
    index: number,
    arrayLength: number,
    patchIndex: number,
): PatchIndexOutOfRangeError {
    return { error: "patch_index_out_of_range", nodeId, field, index, arrayLength, patchIndex };
}

export function patchDeleteNotInArray(
    nodeId: string,
    patchIndex: number,
): PatchDeleteNotInArrayError {
    return { error: "patch_delete_not_in_array", nodeId, patchIndex };
}

// =============================================================================
// Phase 5 — Codegen errors
// =============================================================================

export interface WasmValidationError {
    error: "wasm_validation_error";
    message: string;
}

export function wasmValidationError(
    message: string,
): WasmValidationError {
    return { error: "wasm_validation_error", message };
}
