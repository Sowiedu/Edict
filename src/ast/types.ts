// =============================================================================
// Edict AST Type Expressions
// =============================================================================
// Every possible type in the Edict type system.
// Types are compile-time only — unit types and confidence types are erased after type checking.

/**
 * Union of all type expressions in Edict.
 */
export type TypeExpr =
    | BasicType
    | ArrayType
    | OptionType
    | ResultType
    | UnitType
    | RefinedType
    | FunctionType
    | NamedType
    | TupleType
    | ConfidenceType
    | ProvenanceType
    | CapabilityType
    | FreshnessType
    | TypeVarType;

/**
 * Primitive types.
 */
export interface BasicType {
    kind: "basic";
    name: "Int" | "Int64" | "Float" | "String" | "Bool";
}

/**
 * Homogeneous array type.
 */
export interface ArrayType {
    kind: "array";
    element: TypeExpr;
}

/**
 * Optional value — None or Some(T).
 */
export interface OptionType {
    kind: "option";
    inner: TypeExpr;
}

/**
 * Result type for error handling. Interacts with the "fails" effect.
 */
export interface ResultType {
    kind: "result";
    ok: TypeExpr;
    err: TypeExpr;
}

/**
 * Semantic unit type — compile-time enforcement, zero runtime cost.
 * Prevents mixing incompatible units (e.g., currency<usd> + temp<celsius>).
 */
export interface UnitType {
    kind: "unit_type";
    base: "Int" | "Float";
    unit: string; // "usd", "celsius", "meters", etc.
}

/**
 * Refinement type — base type + logical predicate verified by Z3 (Phase 4).
 * Example: { v: Int | v > 0 } is a positive integer.
 */
export interface RefinedType {
    kind: "refined";
    id: string;
    base: TypeExpr;
    variable: string;
    predicate: Expression;
}

/**
 * Function type — for higher-order functions and lambdas.
 */
export interface FunctionType {
    kind: "fn_type";
    params: TypeExpr[];
    effects: Effect[];
    returnType: TypeExpr;
}

/**
 * Reference to a user-defined type (RecordDef or EnumDef) by name.
 */
export interface NamedType {
    kind: "named";
    name: string;
}

/**
 * Fixed-size heterogeneous tuple.
 */
export interface TupleType {
    kind: "tuple";
    elements: TypeExpr[];
}

/**
 * Confidence-typed value — tracks LLM uncertainty at the type level.
 * Erased after type checking (zero runtime cost). Structurally transparent:
 * Confidence<T, 0.9> is assignable to/from T.
 */
export interface ConfidenceType {
    kind: "confidence";
    base: TypeExpr;
    confidence: number; // 0.0–1.0
}

/**
 * Provenance-typed value — tracks data origin at the type level.
 * Erased after type checking (zero runtime cost). Structurally transparent:
 * Provenance<T, "api:x"> is assignable to/from T.
 */
export interface ProvenanceType {
    kind: "provenance";
    base: TypeExpr;
    sources: string[]; // sorted, deduplicated union of all contributing source tags
}

/**
 * Capability token — compile-time verified, unforgeable permission.
 * Not a type wrapper (unlike confidence/provenance). Capabilities ARE the type.
 * Erased at codegen (zero runtime cost). The host mints them; agents cannot forge them.
 * Permissions are hierarchical: "net:smtp" subsumes "net:smtp:max_10" via prefix matching.
 */
export interface CapabilityType {
    kind: "capability";
    permissions: string[]; // ["net:smtp", "secret:api_key"], hierarchical
}

/**
 * Freshness-typed value — tracks temporal validity at the type level.
 * Erased after type checking (zero runtime cost). Structurally transparent:
 * Fresh<T, "5m"> is assignable to/from T.
 * maxAge is a duration string: "30s", "5m", "1h", "200ms".
 */
export interface FreshnessType {
    kind: "fresh";
    base: TypeExpr;
    maxAge: string; // duration: "30s", "5m", "1h", "200ms"
}

/**
 * Type variable — placeholder for a concrete type, resolved at call sites.
 * Used in polymorphic builtin signatures (e.g., array_get: Array<T> → T).
 * Compile-time only — erased during type checking (unified with concrete types).
 * Never appears in user-written ASTs; only in builtin type definitions.
 */
export interface TypeVarType {
    kind: "type_var";
    name: string; // "T", "E", etc.
}

// Circular import workaround: these are defined in nodes.ts but needed here.
// We use a forward-reference pattern.
import type { Expression, Effect } from "./nodes.js";
