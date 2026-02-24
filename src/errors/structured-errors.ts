// =============================================================================
// Edict Structured Errors
// =============================================================================
// Every compiler error is a structured JSON object with enough context
// for an agent to self-repair. No human-readable strings.

import type { Effect } from "../ast/nodes.js";

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
    | PreconditionNotMetError;

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
    expectedType: string;
}

export interface InvalidFieldTypeError {
    error: "invalid_field_type";
    path: string;
    nodeId: string | null;
    field: string;
    expected: string;
    actual: string;
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
    message: string;
}

// =============================================================================
// Phase 2 — Name resolution errors
// =============================================================================

export interface UndefinedReferenceError {
    error: "undefined_reference";
    nodeId: string | null;
    name: string;
    candidates: string[];
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
}

export interface UnknownEnumError {
    error: "unknown_enum";
    nodeId: string | null;
    name: string;
    candidates: string[];
}

export interface UnknownVariantError {
    error: "unknown_variant";
    nodeId: string | null;
    enumName: string;
    variantName: string;
    availableVariants: string[];
}

// =============================================================================
// Phase 2 — Type checking errors
// =============================================================================

export interface TypeMismatchError {
    error: "type_mismatch";
    nodeId: string | null;
    expected: string;
    actual: string;
    hint?: string;
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
    actualType: string;
}

export interface UnknownFieldError {
    error: "unknown_field";
    nodeId: string | null;
    recordName: string;
    fieldName: string;
    availableFields: string[];
}

export interface MissingRecordFieldsError {
    error: "missing_record_fields";
    nodeId: string | null;
    recordName: string;
    missingFields: string[];
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
    expectedType: string,
): MissingFieldError {
    return { error: "missing_field", path, nodeId, field, expectedType };
}

export function invalidFieldType(
    path: string,
    nodeId: string | null,
    field: string,
    expected: string,
    actual: string,
): InvalidFieldTypeError {
    return { error: "invalid_field_type", path, nodeId, field, expected, actual };
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
    message: string,
): ConflictingEffectsError {
    return { error: "conflicting_effects", path, nodeId, message };
}

// =============================================================================
// Phase 2 error constructors
// =============================================================================

export function undefinedReference(
    nodeId: string | null,
    name: string,
    candidates: string[],
): UndefinedReferenceError {
    return { error: "undefined_reference", nodeId, name, candidates };
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
): UnknownRecordError {
    return { error: "unknown_record", nodeId, name, candidates };
}

export function unknownEnum(
    nodeId: string | null,
    name: string,
    candidates: string[],
): UnknownEnumError {
    return { error: "unknown_enum", nodeId, name, candidates };
}

export function unknownVariant(
    nodeId: string | null,
    enumName: string,
    variantName: string,
    availableVariants: string[],
): UnknownVariantError {
    return { error: "unknown_variant", nodeId, enumName, variantName, availableVariants };
}

export function typeMismatch(
    nodeId: string | null,
    expected: string,
    actual: string,
    hint?: string,
): TypeMismatchError {
    const err: TypeMismatchError = { error: "type_mismatch", nodeId, expected, actual };
    if (hint !== undefined) err.hint = hint;
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
    actualType: string,
): NotAFunctionError {
    return { error: "not_a_function", nodeId, actualType };
}

export function unknownField(
    nodeId: string | null,
    recordName: string,
    fieldName: string,
    availableFields: string[],
): UnknownFieldError {
    return { error: "unknown_field", nodeId, recordName, fieldName, availableFields };
}

export function missingRecordFields(
    nodeId: string | null,
    recordName: string,
    missingFields: string[],
): MissingRecordFieldsError {
    return { error: "missing_record_fields", nodeId, recordName, missingFields };
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
}

export interface EffectInPureError {
    error: "effect_in_pure";
    nodeId: string | null;
    functionName: string;
    callSiteNodeId: string | null;
    calleeName: string;
    calleeEffects: Effect[];
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
): EffectViolationError {
    return { error: "effect_violation", nodeId, functionName, missingEffects, callSiteNodeId, calleeName };
}

export function effectInPure(
    nodeId: string | null,
    functionName: string,
    callSiteNodeId: string | null,
    calleeName: string,
    calleeEffects: Effect[],
): EffectInPureError {
    return { error: "effect_in_pure", nodeId, functionName, callSiteNodeId, calleeName, calleeEffects };
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
