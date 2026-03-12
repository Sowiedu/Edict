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
 * The 5 canonical concrete effect categories.
 * A function definition's signature includes which concrete effects it may perform.
 */
export type ConcreteEffect = "pure" | "reads" | "writes" | "io" | "fails";

/**
 * Effect variable — a placeholder for an unknown set of effects.
 * Used in FunctionType to express effect polymorphism for higher-order functions.
 * Only valid in type annotations (fn_type), NOT in function/tool definitions.
 * Names must be single uppercase ASCII letters (e.g., "E", "F").
 */
export interface EffectVariable {
    kind: "effect_var";
    name: string;
}

/**
 * An effect is either a concrete effect literal or an effect variable.
 * Concrete effects appear in function/tool definitions.
 * Effect variables appear only in FunctionType (type annotations for callbacks).
 */
export type Effect = ConcreteEffect | EffectVariable;

/**
 * Type guard: is this effect a concrete string literal?
 */
export function isConcreteEffect(e: Effect): e is ConcreteEffect {
    return typeof e === "string";
}

/**
 * Type guard: is this effect an effect variable?
 */
export function isEffectVariable(e: Effect): e is EffectVariable {
    return typeof e === "object" && e !== null && e.kind === "effect_var";
}

export const VALID_EFFECTS: readonly ConcreteEffect[] = [
    "pure",
    "reads",
    "writes",
    "io",
    "fails",
] as const;

// =============================================================================
// Tool Call Infrastructure
// =============================================================================

/**
 * Retry backoff strategy for tool calls.
 */
export type BackoffKind = "fixed" | "linear" | "exponential";

export const VALID_BACKOFF_KINDS: readonly BackoffKind[] = [
    "fixed",
    "linear",
    "exponential",
] as const;

/**
 * Retry policy for tool calls — how often and how to back off.
 */
export interface RetryPolicy {
    maxRetries: number;
    backoff: BackoffKind;
}

// =============================================================================
// Approval Gates
// =============================================================================

/**
 * Approval scope controls how often approval must be re-obtained.
 */
export type ApprovalScope = "per_call" | "per_session" | "per_module";

export const VALID_APPROVAL_SCOPES: readonly ApprovalScope[] = [
    "per_call",
    "per_session",
    "per_module",
] as const;

/**
 * Approval gate on a function — requires explicit host approval before execution.
 * Propagates through call chains: if a callee requires approval, the caller must too.
 */
export interface ApprovalGate {
    required: boolean;
    scope: ApprovalScope;
    reason: string;  // machine-readable tag, e.g. "wire_transfer", "delete_data"
}

// =============================================================================
// Top-Level
// =============================================================================

/**
 * Structured blame / provenance annotation.
 * Tracks which agent produced a module or function, when, and with what confidence.
 */
export interface BlameAnnotation {
    author: string;           // e.g. "agent://payment-specialist-v3"
    generatedAt: string;      // ISO 8601 timestamp
    confidence: number;       // 0.0–1.0
    sourcePrompt?: string;    // optional hash of the prompt, e.g. "sha256:abc123..."
}

/**
 * A complete Edict program / module.
 */
export interface EdictModule {
    kind: "module";
    id: string;
    name: string;
    schemaVersion?: string;
    imports: Import[];
    definitions: Definition[];
    budget?: ComplexityConstraints;
    blame?: BlameAnnotation;
    minConfidence?: number;
    capabilities?: string[];  // host-provided permissions: ["net:smtp", "fs:read"]
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
    blame?: BlameAnnotation;
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
    | ConstDef
    | ToolDef;

/**
 * Function definition with effects, contracts, and body.
 */
export interface FunctionDef {
    kind: "fn";
    id: string;
    name: string;
    params: Param[];
    effects: ConcreteEffect[];
    returnType?: TypeExpr;
    contracts: Contract[];
    constraints?: ComplexityConstraints;
    intent?: IntentDeclaration;
    approval?: ApprovalGate;
    blame?: BlameAnnotation;
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
    blame?: BlameAnnotation;
}

/**
 * Record (struct) definition.
 */
export interface RecordDef {
    kind: "record";
    id: string;
    name: string;
    fields: RecordField[];
    blame?: BlameAnnotation;
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
    blame?: BlameAnnotation;
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
    blame?: BlameAnnotation;
}

/**
 * Tool definition — declares a named external tool with a typed interface.
 * The host provides the actual implementation at runtime.
 * Tool names are in scope like functions; tool_call expressions reference them by name.
 */
export interface ToolDef {
    kind: "tool";
    id: string;
    name: string;              // agent-facing name: "get_weather", "create_issue"
    uri: string;               // tool URI: "mcp://github/create_issue"
    params: Param[];           // typed parameters
    returnType: TypeExpr;      // Ok payload; tool_call returns Result<returnType, String>
    effects: ConcreteEffect[]; // must include "io"; may include others
    blame?: BlameAnnotation;
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
    | ExistsExpr
    | ToolCallExpr;

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

/**
 * Tool call expression — invokes a declared tool by name.
 * Named args via FieldInit (same pattern as RecordExpr/EnumConstructor).
 * Always returns Result<T, String> where T is the tool's returnType.
 */
export interface ToolCallExpr {
    kind: "tool_call";
    id: string;
    tool: string;              // references a ToolDef.name
    args: FieldInit[];         // named args
    timeout?: number;          // ms
    retryPolicy?: RetryPolicy;
    fallback?: Expression;     // must type-check as Result<T, String>
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
    "tool",
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
    "tool_call",
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
    "confidence",
    "provenance",
    "capability",
    "fresh",
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
    "effect_var",
    ...VALID_EXPRESSION_KINDS,
    ...VALID_TYPE_KINDS,
    ...VALID_PATTERN_KINDS,
] as const;
