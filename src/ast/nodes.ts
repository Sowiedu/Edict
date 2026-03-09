// =============================================================================
// Edict AST Node Definitions
// =============================================================================
// Every valid Edict program is a tree of these nodes, serialized as JSON.
// No lexer, no parser — agents produce these directly.

import type { TypeExpr } from "./types.js";

// Re-export TypeExpr for convenience
export type { TypeExpr } from "./types.js";

// =============================================================================
// Effects
// =============================================================================

/**
 * The 5 canonical effect categories.
 * A function's signature includes which effects it may perform.
 */
export type Effect = "pure" | "reads" | "writes" | "io" | "fails";

export const VALID_EFFECTS: readonly Effect[] = [
    "pure",
    "reads",
    "writes",
    "io",
    "fails",
] as const;

// =============================================================================
// Top-Level
// =============================================================================

/**
 * A complete Edict program / module.
 */
export interface EdictModule {
    kind: "module";
    id: string;
    name: string;
    imports: Import[];
    definitions: Definition[];
    budget?: ComplexityConstraints;
}

/**
 * A composable program fragment.
 * Agents can validate fragments independently and compose them into a module.
 */
export interface EdictFragment {
    kind: "fragment";
    id: string;
    provides: string[];       // names this fragment defines
    requires: string[];       // names this fragment depends on (external)
    imports: Import[];        // module imports needed by this fragment
    definitions: Definition[];
}

/**
 * Import names from another module.
 */
export interface Import {
    kind: "import";
    id: string;
    module: string;
    names: string[];
    types?: Record<string, TypeExpr>;
}

// =============================================================================
// Definitions
// =============================================================================

export type Definition =
    | FunctionDef
    | TypeDef
    | RecordDef
    | EnumDef
    | ConstDef;

/**
 * Function definition with effects, contracts, and body.
 */
export interface FunctionDef {
    kind: "fn";
    id: string;
    name: string;
    params: Param[];
    effects: Effect[];
    returnType?: TypeExpr;
    contracts: Contract[];
    constraints?: ComplexityConstraints;
    intent?: IntentDeclaration;
    body: Expression[];
}

/**
 * Structured intent — what the function is trying to accomplish.
 * Agents use this for re-synthesis, blame tracking, and specification diffing.
 * Invariants reuse Expression and SemanticAssertion types for automated matching.
 */
export interface IntentDeclaration {
    goal: string;
    inputs: string[];
    outputs: string[];
    invariants: IntentInvariant[];
}

/**
 * A structured invariant that can be automatically matched against contracts.
 * Reuses existing Expression and SemanticAssertionKind — zero new vocabulary.
 */
export type IntentInvariant =
    | ExpressionInvariant
    | SemanticInvariant;

export interface ExpressionInvariant {
    kind: "expression";
    expression: Expression;
}

export interface SemanticInvariant {
    kind: "semantic";
    assertion: SemanticAssertionKind;
    target: string;
    args?: string[];
}

/**
 * Type alias definition.
 */
export interface TypeDef {
    kind: "type";
    id: string;
    name: string;
    definition: TypeExpr;
}

/**
 * Record (struct) definition.
 */
export interface RecordDef {
    kind: "record";
    id: string;
    name: string;
    fields: RecordField[];
}

/**
 * A field in a record definition.
 */
export interface RecordField {
    kind: "field";
    id: string;
    name: string;
    type: TypeExpr;
    defaultValue?: Expression;
}

/**
 * Enum (tagged union / sum type) definition.
 */
export interface EnumDef {
    kind: "enum";
    id: string;
    name: string;
    variants: EnumVariant[];
}

/**
 * A variant of an enum. Fields are empty for unit variants (e.g., None).
 */
export interface EnumVariant {
    kind: "variant";
    id: string;
    name: string;
    fields: RecordField[];
}

/**
 * Constant definition.
 */
export interface ConstDef {
    kind: "const";
    id: string;
    name: string;
    type: TypeExpr;
    value: Expression;
}

// =============================================================================
// Function Components
// =============================================================================

/**
 * Function parameter.
 */
export interface Param {
    kind: "param";
    id: string;
    name: string;
    type?: TypeExpr;
}

/**
 * Pre/post contract on a function.
 * Must have exactly one of `condition` (manual expression) or `semantic` (pre-built assertion).
 * `semantic` is only valid on `post` contracts (v1).
 */
export interface Contract {
    kind: "pre" | "post";
    id: string;
    condition?: Expression;
    semantic?: SemanticAssertion;
}

/**
 * A pre-built semantic assertion that translates to a proven-correct Z3 encoding.
 * Agents use these instead of manually writing Z3-verifiable expressions.
 */
export interface SemanticAssertion {
    assertion: SemanticAssertionKind;
    target: string;        // variable name: "result", param name, etc.
    args?: string[];       // assertion-specific args: e.g. ["ascending"], ["input"]
}

/**
 * The 7 built-in semantic assertion kinds.
 */
export type SemanticAssertionKind =
    | "sorted"             // forall i: arr[i] <= arr[i+1]
    | "permutation_of"     // same elements, same counts as args[0]
    | "subset_of"          // all elements in result are in args[0]
    | "sum_preserved"      // sum(target) == sum(args[0])
    | "no_duplicates"      // forall i,j: i!=j => arr[i]!=arr[j]
    | "length_preserved"   // len(target) == len(args[0])
    | "bounded";           // forall x in target: args[0] <= x <= args[1]

export const VALID_SEMANTIC_ASSERTIONS: readonly SemanticAssertionKind[] = [
    "sorted", "permutation_of", "subset_of", "sum_preserved",
    "no_duplicates", "length_preserved", "bounded",
] as const;

/**
 * Bounds on token complexity and program size to prevent runaway agents.
 */
export interface ComplexityConstraints {
    kind: "constraints";
    maxAstNodes?: number;
    maxCallDepth?: number;
    maxBranches?: number;
}

// =============================================================================
// Expressions
// =============================================================================

export type Expression =
    | Literal
    | Identifier
    | BinaryOp
    | UnaryOp
    | Call
    | IfExpr
    | LetExpr
    | MatchExpr
    | ArrayExpr
    | TupleExpr
    | RecordExpr
    | EnumConstructor
    | FieldAccess
    | LambdaExpr
    | BlockExpr
    | StringInterp
    | ForallExpr
    | ExistsExpr;

export interface Literal {
    kind: "literal";
    id: string;
    value: number | string | boolean;
    type?: TypeExpr;
}

export interface Identifier {
    kind: "ident";
    id: string;
    name: string;
}

export type BinaryOperator =
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "=="
    | "!="
    | "<"
    | ">"
    | "<="
    | ">="
    | "and"
    | "or"
    | "implies";

export const VALID_BINARY_OPS: readonly BinaryOperator[] = [
    "+",
    "-",
    "*",
    "/",
    "%",
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "and",
    "or",
    "implies",
] as const;

export interface BinaryOp {
    kind: "binop";
    id: string;
    op: BinaryOperator;
    left: Expression;
    right: Expression;
}

export type UnaryOperator = "not" | "-";

export const VALID_UNARY_OPS: readonly UnaryOperator[] = ["not", "-"] as const;

export interface UnaryOp {
    kind: "unop";
    id: string;
    op: UnaryOperator;
    operand: Expression;
}

export interface Call {
    kind: "call";
    id: string;
    fn: Expression;
    args: Expression[];
}

export interface IfExpr {
    kind: "if";
    id: string;
    condition: Expression;
    then: Expression[];
    else?: Expression[];
}

export interface LetExpr {
    kind: "let";
    id: string;
    name: string;
    type?: TypeExpr;
    value: Expression;
}

export interface MatchExpr {
    kind: "match";
    id: string;
    target: Expression;
    arms: MatchArm[];
}

export interface MatchArm {
    kind: "arm";
    id: string;
    pattern: Pattern;
    body: Expression[];
}

export type Pattern =
    | LiteralPattern
    | WildcardPattern
    | BindingPattern
    | ConstructorPattern;

export interface LiteralPattern {
    kind: "literal_pattern";
    value: number | string | boolean;
}

export interface WildcardPattern {
    kind: "wildcard";
}

export interface BindingPattern {
    kind: "binding";
    name: string;
}

export interface ConstructorPattern {
    kind: "constructor";
    name: string;
    fields: Pattern[];
}

export interface ArrayExpr {
    kind: "array";
    id: string;
    elements: Expression[];
}

export interface TupleExpr {
    kind: "tuple_expr";
    id: string;
    elements: Expression[];
}

export interface RecordExpr {
    kind: "record_expr";
    id: string;
    name: string;
    fields: FieldInit[];
}

export interface EnumConstructor {
    kind: "enum_constructor";
    id: string;
    enumName: string;
    variant: string;
    fields: FieldInit[];
}

/**
 * Field initialization in record expressions and enum constructors.
 * Gives these inline objects a proper `kind` discriminator like every other AST node.
 */
export interface FieldInit {
    kind: "field_init";
    name: string;
    value: Expression;
}

export interface FieldAccess {
    kind: "access";
    id: string;
    target: Expression;
    field: string;
}

export interface LambdaExpr {
    kind: "lambda";
    id: string;
    params: Param[];
    body: Expression[];
}

export interface BlockExpr {
    kind: "block";
    id: string;
    body: Expression[];
}

/**
 * String interpolation — desugars to string_concat chains at compile time.
 * All parts must evaluate to String.
 */
export interface StringInterp {
    kind: "string_interp";
    id: string;
    parts: Expression[];
}

/**
 * Universal quantifier — contract-only.
 * forall variable in [range.from, range.to): body
 * Translates to Z3 ForAll. Body must evaluate to Bool.
 */
export interface ForallExpr {
    kind: "forall";
    id: string;
    variable: string;
    range: { from: Expression; to: Expression };
    body: Expression;
}

/**
 * Existential quantifier — contract-only.
 * exists variable in [range.from, range.to): body
 * Translates to Z3 Exists. Body must evaluate to Bool.
 */
export interface ExistsExpr {
    kind: "exists";
    id: string;
    variable: string;
    range: { from: Expression; to: Expression };
    body: Expression;
}

// =============================================================================
// Valid kind values — used by the validator
// =============================================================================

export const VALID_DEFINITION_KINDS = [
    "fn",
    "type",
    "record",
    "enum",
    "const",
] as const;

export const VALID_EXPRESSION_KINDS = [
    "literal",
    "ident",
    "binop",
    "unop",
    "call",
    "if",
    "let",
    "match",
    "array",
    "tuple_expr",
    "record_expr",
    "enum_constructor",
    "access",
    "lambda",
    "block",
    "string_interp",
    "forall",
    "exists",
] as const;

export const VALID_TYPE_KINDS = [
    "basic",
    "array",
    "option",
    "result",
    "unit_type",
    "refined",
    "fn_type",
    "named",
    "tuple",
] as const;

export const VALID_PATTERN_KINDS = [
    "literal_pattern",
    "wildcard",
    "binding",
    "constructor",
] as const;

export const VALID_BASIC_TYPE_NAMES = [
    "Int",
    "Int64",
    "Float",
    "String",
    "Bool",
] as const;

export const ALL_VALID_KINDS = [
    "module",
    "fragment",
    "import",
    ...VALID_DEFINITION_KINDS,
    "param",
    "field",
    "variant",
    "pre",
    "post",
    "arm",
    "field_init",
    "constraints",
    ...VALID_EXPRESSION_KINDS,
    ...VALID_TYPE_KINDS,
    ...VALID_PATTERN_KINDS,
] as const;
