// =============================================================================
// Edict AST Type Expressions
// =============================================================================
// Every possible type in the Edict type system.
// Types are compile-time only — unit types are erased after type checking.

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
    | TupleType;

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

// Circular import workaround: these are defined in nodes.ts but needed here.
// We use a forward-reference pattern.
import type { Expression, Effect } from "./nodes.js";
