// =============================================================================
// Mid-Level IR Type Definitions
// =============================================================================
// A lower-level, codegen-friendly representation between the AST and WASM.
//
// Key properties:
//   - Every expression node carries its resolved Edict type (no inference at codegen time)
//   - Closure environments are pre-computed and attached to function definitions
//   - No unresolved names — all identifiers reference known declarations
//   - Discriminated union with TypeScript literal types (not string `kind` dispatch)
//   - Designed to eliminate `edictTypeName` / `inferExprWasmType` heuristics in codegen
//
// The IR is produced by a lowering pass: AST + TypedModuleInfo → IRModule.
// Codegen reads IR instead of AST.

import type { TypeExpr } from "../ast/types.js";
import type {
    ConcreteEffect,
    BinaryOperator,
    UnaryOperator,
    Pattern,
    Contract,
} from "../ast/nodes.js";

// =============================================================================
// Top-Level IR
// =============================================================================

/**
 * A fully lowered Edict module — the input to the WASM code generator.
 * All type information is resolved; no heuristic inference needed downstream.
 */
export interface IRModule {
    /** Original module name */
    readonly name: string;
    /** Original module AST node ID */
    readonly sourceId: string;
    /** Module-level imports (extern function signatures) */
    readonly imports: IRImport[];
    /** User-defined functions (lowered from FunctionDef + LambdaExpr) */
    readonly functions: IRFunction[];
    /** Record type layouts for codegen */
    readonly records: IRRecordDef[];
    /** Enum type layouts for codegen */
    readonly enums: IREnumDef[];
    /** Module-level constants */
    readonly constants: IRConstant[];
}

/**
 * An imported function from another module.
 * Types are fully resolved — no `unknown` type placeholders.
 */
export interface IRImport {
    /** Module source name */
    readonly module: string;
    /** Imported function name */
    readonly name: string;
    /** Resolved parameter types */
    readonly paramTypes: TypeExpr[];
    /** Resolved return type */
    readonly returnType: TypeExpr;
    /** Declared effects */
    readonly effects: ConcreteEffect[];
}

/**
 * A lowered function — from FunctionDef or lifted lambda.
 *
 * Carries resolved type info and pre-computed closure environment.
 * Codegen reads `resolvedReturnType` instead of re-inferring from AST annotations.
 */
export interface IRFunction {
    /** Original AST node ID (for error mapping and debug metadata) */
    readonly sourceId: string;
    /** Function name (user-defined or auto-generated for lambdas) */
    readonly name: string;
    /** Parameters with resolved types */
    readonly params: IRParam[];
    /** Resolved return type (never `unknown` for well-typed programs) */
    readonly resolvedReturnType: TypeExpr;
    /** Concrete effects declared on this function */
    readonly effects: ConcreteEffect[];
    /** Pre/post contracts (lowered from AST contracts) */
    readonly contracts: Contract[];
    /** Lowered function body */
    readonly body: IRExpr[];
    /** Names of variables captured from enclosing scope (empty for non-closures) */
    readonly closureEnv: IRClosureVar[];
    /** Whether this function is a lifted lambda */
    readonly isLambda: boolean;
}

/**
 * A variable captured in a closure environment.
 * Pre-computed during lowering, eliminating runtime free-variable analysis.
 */
export interface IRClosureVar {
    /** Variable name in the enclosing scope */
    readonly name: string;
    /** Resolved Edict type of the captured variable */
    readonly resolvedType: TypeExpr;
}

/**
 * A function parameter with its resolved type.
 */
export interface IRParam {
    /** Original AST node ID */
    readonly sourceId: string;
    /** Parameter name */
    readonly name: string;
    /** Resolved type (always present — type checker guarantees this) */
    readonly resolvedType: TypeExpr;
}

/**
 * A module-level constant.
 */
export interface IRConstant {
    /** Original AST node ID */
    readonly sourceId: string;
    /** Constant name */
    readonly name: string;
    /** Resolved type */
    readonly resolvedType: TypeExpr;
    /** Constant value expression */
    readonly value: IRExpr;
}

// =============================================================================
// Data Definition IR
// =============================================================================

/**
 * Record definition — carries field layout information for codegen.
 */
export interface IRRecordDef {
    /** Record type name */
    readonly name: string;
    /** Ordered fields with resolved types */
    readonly fields: IRFieldDef[];
}

/**
 * A field in a record definition.
 */
export interface IRFieldDef {
    /** Field name */
    readonly name: string;
    /** Resolved type */
    readonly resolvedType: TypeExpr;
    /** Whether this field has a default value */
    readonly hasDefault: boolean;
}

/**
 * Enum (tagged union) definition — carries variant layout information for codegen.
 */
export interface IREnumDef {
    /** Enum type name */
    readonly name: string;
    /** Ordered variants */
    readonly variants: IRVariantDef[];
}

/**
 * A variant in an enum definition.
 */
export interface IRVariantDef {
    /** Variant name */
    readonly name: string;
    /** Variant tag (0-based index) — matches codegen's enum layout convention */
    readonly tag: number;
    /** Variant fields (empty for unit variants like `None`) */
    readonly fields: IRFieldDef[];
}

// =============================================================================
// IR Expressions — Discriminated Union
// =============================================================================
// Every expression carries `resolvedType` — the Edict-level type determined by
// the type checker. Codegen uses this instead of inferring types heuristically.

/**
 * The discriminated union of all IR expression nodes.
 * Uses TypeScript literal type discrimination via `kind`.
 */
export type IRExpr =
    | IRLiteral
    | IRIdent
    | IRBinop
    | IRUnop
    | IRCall
    | IRIf
    | IRLet
    | IRBlock
    | IRMatch
    | IRArray
    | IRTuple
    | IRRecordExpr
    | IREnumConstructor
    | IRAccess
    | IRLambdaRef
    | IRStringInterp;

// ─── Scalars ────────────────────────────────────────────────────────────────

/**
 * A literal value — Int, Float, String, or Bool.
 */
export interface IRLiteral {
    readonly kind: "ir_literal";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved Edict type */
    readonly resolvedType: TypeExpr;
    /** The literal value */
    readonly value: number | string | boolean;
}

/**
 * A resolved identifier reference.
 *
 * The lowering pass resolves the name to its declaration scope, eliminating
 * the need for runtime scope lookup in codegen.
 */
export interface IRIdent {
    readonly kind: "ir_ident";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved Edict type */
    readonly resolvedType: TypeExpr;
    /** Variable name */
    readonly name: string;
    /** Where this identifier was declared */
    readonly scope: IRIdentScope;
}

/**
 * How an identifier is accessed at the WASM level.
 * Pre-resolved during lowering — codegen doesn't need to search scopes.
 */
export type IRIdentScope =
    | "local"       // Function parameter or let-bound variable
    | "closure"     // Captured from enclosing scope (read from closure env)
    | "global"      // Module-level constant
    | "function";   // References a named function (for function-as-value)

// ─── Operators ──────────────────────────────────────────────────────────────

/**
 * Binary operation with resolved operand types.
 *
 * The `resolvedOperandType` disambiguates Int vs Float vs String operations
 * without codegen needing to infer from operand expressions.
 */
export interface IRBinop {
    readonly kind: "ir_binop";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved result type (e.g., Bool for comparisons, Int/Float for arithmetic) */
    readonly resolvedType: TypeExpr;
    /** The operator */
    readonly op: BinaryOperator;
    /** Left operand */
    readonly left: IRExpr;
    /** Right operand */
    readonly right: IRExpr;
    /**
     * Resolved type of operands (before the operation).
     * Used to dispatch i32 vs f64 vs string instructions.
     */
    readonly resolvedOperandType: TypeExpr;
}

/**
 * Unary operation.
 */
export interface IRUnop {
    readonly kind: "ir_unop";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved result type */
    readonly resolvedType: TypeExpr;
    /** The operator */
    readonly op: UnaryOperator;
    /** Operand */
    readonly operand: IRExpr;
}

// ─── Calls ──────────────────────────────────────────────────────────────────

/**
 * Function call — covers direct calls, indirect calls, and builtin calls.
 *
 * `callKind` pre-classifies the call for codegen:
 * - `"direct"` — known function name, emit `call`
 * - `"indirect"` — function value (closure pair), emit `call_indirect`
 * - `"builtin"` — built-in function, emit host import call
 */
export interface IRCall {
    readonly kind: "ir_call";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved return type */
    readonly resolvedType: TypeExpr;
    /** The function being called */
    readonly fn: IRExpr;
    /** Arguments */
    readonly args: IRExpr[];
    /** Pre-classified call kind for codegen dispatch */
    readonly callKind: IRCallKind;
    /**
     * For string-typed parameters: which argument positions need (ptr, len) expansion.
     * Pre-computed during lowering (replaces runtime edictParamTypes checking).
     */
    readonly stringParamIndices: number[];
    /**
     * Coercion builtins to apply to arguments before the call.
     * Key: argument index, Value: builtin name (e.g., "intToString").
     * Used for string interpolation auto-coercion.
     */
    readonly argCoercions: Record<number, string>;
}

/**
 * How the call should be emitted in WASM.
 */
export type IRCallKind =
    | "direct"      // Static function call (emit WASM `call`)
    | "indirect"    // Through closure pair (emit WASM `call_indirect`)
    | "builtin";    // Built-in host function (emit WASM imported call)

// ─── Control Flow ───────────────────────────────────────────────────────────

/**
 * Conditional expression.
 */
export interface IRIf {
    readonly kind: "ir_if";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved result type */
    readonly resolvedType: TypeExpr;
    /** Condition (must be Bool) */
    readonly condition: IRExpr;
    /** Then branch body */
    readonly then: IRExpr[];
    /** Else branch body (empty array if no else branch) */
    readonly else: IRExpr[];
}

/**
 * Let binding — introduces a local variable.
 */
export interface IRLet {
    readonly kind: "ir_let";
    /** Original AST node ID */
    readonly sourceId: string;
    /**
     * Resolved type is `void` (let is a statement).
     * The *bound variable's* type is in `boundType`.
     */
    readonly resolvedType: TypeExpr;
    /** Variable name */
    readonly name: string;
    /** Resolved type of the bound variable */
    readonly boundType: TypeExpr;
    /** Value expression */
    readonly value: IRExpr;
}

/**
 * Block expression — sequence of expressions, value is the last.
 */
export interface IRBlock {
    readonly kind: "ir_block";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved result type (type of last expression, or void if empty) */
    readonly resolvedType: TypeExpr;
    /** Body expressions */
    readonly body: IRExpr[];
}

// ─── Pattern Matching ───────────────────────────────────────────────────────

/**
 * Match expression — pattern matching on a target value.
 *
 * The `targetTypeName` resolves the enum/record name for codegen layout lookup,
 * eliminating the `edictTypeName` heuristic.
 */
export interface IRMatch {
    readonly kind: "ir_match";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved result type */
    readonly resolvedType: TypeExpr;
    /** Target expression being matched */
    readonly target: IRExpr;
    /** Match arms */
    readonly arms: IRMatchArm[];
    /**
     * Resolved type name of the target (e.g., "Option", "Result", "MyEnum").
     * Pre-resolved from the type checker — replaces `edictTypeName` inference.
     */
    readonly targetTypeName: string | undefined;
}

/**
 * A single arm in a match expression.
 * Patterns are preserved from the AST (they're already structural).
 */
export interface IRMatchArm {
    /** Original AST node ID */
    readonly sourceId: string;
    /** The pattern to match against */
    readonly pattern: Pattern;
    /** Body expressions (value is the last) */
    readonly body: IRExpr[];
}

// ─── Data Structures ────────────────────────────────────────────────────────

/**
 * Array literal — all elements have the same type.
 */
export interface IRArray {
    readonly kind: "ir_array";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type — `{ kind: "array", element: TypeExpr }` */
    readonly resolvedType: TypeExpr;
    /** Element expressions */
    readonly elements: IRExpr[];
}

/**
 * Tuple literal — fixed-size heterogeneous container.
 */
export interface IRTuple {
    readonly kind: "ir_tuple";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type — `{ kind: "tuple", elements: TypeExpr[] }` */
    readonly resolvedType: TypeExpr;
    /** Element expressions */
    readonly elements: IRExpr[];
}

/**
 * Record construction — creates a heap-allocated record instance.
 */
export interface IRRecordExpr {
    readonly kind: "ir_record";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type — `{ kind: "named", name: string }` */
    readonly resolvedType: TypeExpr;
    /** Record type name */
    readonly name: string;
    /** Field initializations in definition order (matching layout) */
    readonly fields: IRFieldInit[];
}

/**
 * Enum variant construction — creates a heap-allocated tagged union value.
 */
export interface IREnumConstructor {
    readonly kind: "ir_enum_constructor";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type — `{ kind: "named", name: string }` */
    readonly resolvedType: TypeExpr;
    /** Enum type name */
    readonly enumName: string;
    /** Variant name */
    readonly variant: string;
    /** Variant tag (pre-resolved from enum layout) */
    readonly tag: number;
    /** Field initializations */
    readonly fields: IRFieldInit[];
}

/**
 * Field initialization — used in records and enum constructors.
 */
export interface IRFieldInit {
    /** Field name */
    readonly name: string;
    /** Value expression */
    readonly value: IRExpr;
    /** Resolved type of this field */
    readonly resolvedType: TypeExpr;
}

/**
 * Field access — reads a field from a record, tuple, or enum variant.
 *
 * The `targetTypeName` and `fieldOffset` are pre-resolved from the record layout,
 * eliminating runtime layout lookup heuristics.
 */
export interface IRAccess {
    readonly kind: "ir_access";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type of the field being accessed */
    readonly resolvedType: TypeExpr;
    /** Target expression (the record/tuple being accessed) */
    readonly target: IRExpr;
    /** Field name (or numeric index as string for tuples) */
    readonly field: string;
    /**
     * Pre-resolved type name of the target for layout lookup.
     * e.g., "Point", "__tuple", "MyEnum"
     */
    readonly targetTypeName: string | undefined;
}

// ─── Lambdas & String Interpolation ─────────────────────────────────────────

/**
 * Reference to a lifted lambda function.
 *
 * During lowering, lambdas are lifted to top-level IRFunction entries.
 * The `IRLambdaRef` is what remains in the expression tree — a reference
 * to the lifted function plus the closure environment to capture.
 */
export interface IRLambdaRef {
    readonly kind: "ir_lambda_ref";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type — `{ kind: "fn_type", ... }` */
    readonly resolvedType: TypeExpr;
    /** Name of the lifted function (auto-generated) */
    readonly liftedName: string;
    /** Variables to capture from the current scope */
    readonly captures: IRClosureVar[];
}

/**
 * String interpolation — concatenation of string parts.
 * Non-string parts have pre-resolved coercion builtins attached.
 */
export interface IRStringInterp {
    readonly kind: "ir_string_interp";
    /** Original AST node ID */
    readonly sourceId: string;
    /** Resolved type — always `{ kind: "basic", name: "String" }` */
    readonly resolvedType: TypeExpr;
    /** Parts of the interpolation */
    readonly parts: IRStringInterpPart[];
}

/**
 * A part of a string interpolation.
 * If the part needs coercion (e.g., Int → String), `coercionBuiltin` names the
 * builtin to call (pre-resolved by the lowering pass from TypedModuleInfo).
 */
export interface IRStringInterpPart {
    /** The expression producing this part's value */
    readonly expr: IRExpr;
    /**
     * Coercion builtin name if needed (e.g., "intToString", "floatToString").
     * `undefined` if the expression already produces a String.
     */
    readonly coercionBuiltin: string | undefined;
}

// =============================================================================
// Debug & Stringify Helpers
// =============================================================================

/**
 * Get a human-readable label for an IR expression kind (for debug/test output).
 */
export function irExprKindLabel(expr: IRExpr): string {
    return expr.kind;
}

/**
 * Count total IR expression nodes in a module (for metrics/benchmarks).
 */
export function countIRNodes(module: IRModule): number {
    let count = 0;
    for (const fn of module.functions) {
        count += countExprNodes(fn.body);
    }
    for (const c of module.constants) {
        count += countExprNodes([c.value]);
    }
    return count;
}

function countExprNodes(exprs: IRExpr[]): number {
    let count = 0;
    for (const expr of exprs) {
        count++;
        switch (expr.kind) {
            case "ir_binop":
                count += countExprNodes([expr.left, expr.right]);
                break;
            case "ir_unop":
                count += countExprNodes([expr.operand]);
                break;
            case "ir_call":
                count += countExprNodes([expr.fn, ...expr.args]);
                break;
            case "ir_if":
                count += countExprNodes([expr.condition]);
                count += countExprNodes(expr.then);
                count += countExprNodes(expr.else);
                break;
            case "ir_let":
                count += countExprNodes([expr.value]);
                break;
            case "ir_block":
                count += countExprNodes(expr.body);
                break;
            case "ir_match":
                count += countExprNodes([expr.target]);
                for (const arm of expr.arms) {
                    count += countExprNodes(arm.body);
                }
                break;
            case "ir_array":
            case "ir_tuple":
                count += countExprNodes(expr.elements);
                break;
            case "ir_record":
                count += countExprNodes(expr.fields.map(f => f.value));
                break;
            case "ir_enum_constructor":
                count += countExprNodes(expr.fields.map(f => f.value));
                break;
            case "ir_access":
                count += countExprNodes([expr.target]);
                break;
            case "ir_lambda_ref":
            case "ir_literal":
            case "ir_ident":
                // Leaf nodes
                break;
            case "ir_string_interp":
                count += countExprNodes(expr.parts.map(p => p.expr));
                break;
        }
    }
    return count;
}
