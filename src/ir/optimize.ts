// =============================================================================
// IR Constant Folding Optimization Pass
// =============================================================================
// Walks the IR bottom-up and replaces foldable expressions with IRLiteral nodes.
//
// What it folds:
//   - IRBinop: arithmetic, comparison, boolean, and string ops with literal operands
//   - IRUnop: negation and logical not with literal operands
//   - IRIf: literal condition → replace with taken branch
//   - Identity ops: x + 0 → x, x * 1 → x, x - 0 → x, x * 0 → 0
//
// Invariants:
//   - Pure function — returns a new IRModule, no mutation
//   - Bottom-up — children folded before parent (enables cascading)
//   - Preserves sourceId — folded literals keep original node's sourceId
//   - Int arithmetic wraps to 32 bits (matches WASM i32)
//   - Division/modulo by zero is NOT folded (let WASM trap at runtime)

import type {
    IRModule,
    IRFunction,
    IRExpr,
    IRConstant,
    IRMatchArm,
} from "./types.js";

// =============================================================================
// Entry Point
// =============================================================================

/**
 * Run constant folding on an IR module.
 * Returns a new IRModule with foldable expressions replaced by literals.
 */
export function optimize(ir: IRModule): IRModule {
    return {
        ...ir,
        functions: ir.functions.map(optimizeFunction),
        constants: ir.constants.map(optimizeConstant),
    };
}

// =============================================================================
// Function & Constant Optimization
// =============================================================================

function optimizeFunction(fn: IRFunction): IRFunction {
    return {
        ...fn,
        body: fn.body.map(foldExpr),
    };
}

function optimizeConstant(c: IRConstant): IRConstant {
    return {
        ...c,
        value: foldExpr(c.value),
    };
}

// =============================================================================
// Expression Folding — Bottom-Up Walk
// =============================================================================

function foldExpr(expr: IRExpr): IRExpr {
    switch (expr.kind) {
        case "ir_literal":
        case "ir_ident":
        case "ir_lambda_ref":
            return expr; // Leaf nodes — nothing to fold

        case "ir_binop": {
            const left = foldExpr(expr.left);
            const right = foldExpr(expr.right);

            // Try identity optimizations first (even with non-literal operands)
            const identity = tryIdentityFold(expr, left, right);
            if (identity) return identity;

            // Try constant folding with two literals
            if (left.kind === "ir_literal" && right.kind === "ir_literal") {
                const folded = foldBinop(expr.sourceId, expr.op, left, right, expr.resolvedType, expr.resolvedOperandType);
                if (folded) return folded;
            }

            return { ...expr, left, right };
        }

        case "ir_unop": {
            const operand = foldExpr(expr.operand);
            if (operand.kind === "ir_literal") {
                const folded = foldUnop(expr.sourceId, expr.op, operand, expr.resolvedType);
                if (folded) return folded;
            }
            return { ...expr, operand };
        }

        case "ir_call":
            return {
                ...expr,
                fn: foldExpr(expr.fn),
                args: expr.args.map(foldExpr),
            };

        case "ir_if": {
            const condition = foldExpr(expr.condition);
            const thenBody = expr.then.map(foldExpr);
            const elseBody = expr.else.map(foldExpr);

            // If condition is a literal, replace with taken branch
            if (condition.kind === "ir_literal" && typeof condition.value === "boolean") {
                if (condition.value) {
                    // true → take then branch
                    return wrapAsBlock(expr.sourceId, expr.resolvedType, thenBody);
                } else {
                    // false → take else branch
                    return wrapAsBlock(expr.sourceId, expr.resolvedType, elseBody);
                }
            }

            return { ...expr, condition, then: thenBody, else: elseBody };
        }

        case "ir_let":
            return { ...expr, value: foldExpr(expr.value) };

        case "ir_block":
            return { ...expr, body: expr.body.map(foldExpr) };

        case "ir_match": {
            const target = foldExpr(expr.target);
            const arms: IRMatchArm[] = expr.arms.map(arm => ({
                ...arm,
                body: arm.body.map(foldExpr),
            }));
            return { ...expr, target, arms };
        }

        case "ir_array":
            return { ...expr, elements: expr.elements.map(foldExpr) };

        case "ir_tuple":
            return { ...expr, elements: expr.elements.map(foldExpr) };

        case "ir_record":
            return {
                ...expr,
                fields: expr.fields.map(f => ({ ...f, value: foldExpr(f.value) })),
            };

        case "ir_enum_constructor":
            return {
                ...expr,
                fields: expr.fields.map(f => ({ ...f, value: foldExpr(f.value) })),
            };

        case "ir_access":
            return { ...expr, target: foldExpr(expr.target) };

        case "ir_string_interp":
            return {
                ...expr,
                parts: expr.parts.map(p => ({ ...p, expr: foldExpr(p.expr) })),
            };
    }
}

// =============================================================================
// Binary Operation Folding
// =============================================================================

import type { TypeExpr } from "../ast/types.js";
import type { BinaryOperator, UnaryOperator } from "../ast/nodes.js";

function foldBinop(
    sourceId: string,
    op: BinaryOperator,
    left: IRExpr & { kind: "ir_literal" },
    right: IRExpr & { kind: "ir_literal" },
    resolvedType: TypeExpr,
    resolvedOperandType: TypeExpr,
): IRExpr | undefined {
    const lv = left.value;
    const rv = right.value;

    // ── Numeric arithmetic ──
    if (typeof lv === "number" && typeof rv === "number") {
        const isInt = resolvedOperandType.kind === "basic" && resolvedOperandType.name === "Int";

        switch (op) {
            case "+": return mkLiteral(sourceId, resolvedType, isInt ? wrap32(lv + rv) : lv + rv);
            case "-": return mkLiteral(sourceId, resolvedType, isInt ? wrap32(lv - rv) : lv - rv);
            case "*": return mkLiteral(sourceId, resolvedType, isInt ? wrap32(lv * rv) : lv * rv);
            case "/":
                // Don't fold division by zero — let WASM trap at runtime
                if (rv === 0) return undefined;
                return mkLiteral(sourceId, resolvedType, isInt ? (lv / rv) | 0 : lv / rv);
            case "%":
                if (rv === 0) return undefined;
                return mkLiteral(sourceId, resolvedType, isInt ? wrap32(lv % rv) : lv % rv);

            // Comparisons
            case "==": return mkLiteral(sourceId, resolvedType, lv === rv);
            case "!=": return mkLiteral(sourceId, resolvedType, lv !== rv);
            case "<":  return mkLiteral(sourceId, resolvedType, lv < rv);
            case ">":  return mkLiteral(sourceId, resolvedType, lv > rv);
            case "<=": return mkLiteral(sourceId, resolvedType, lv <= rv);
            case ">=": return mkLiteral(sourceId, resolvedType, lv >= rv);
        }
    }

    // ── String concatenation ──
    if (typeof lv === "string" && typeof rv === "string" && op === "+") {
        return mkLiteral(sourceId, resolvedType, lv + rv);
    }

    // ── Boolean operations ──
    if (typeof lv === "boolean" && typeof rv === "boolean") {
        switch (op) {
            case "and": return mkLiteral(sourceId, resolvedType, lv && rv);
            case "or":  return mkLiteral(sourceId, resolvedType, lv || rv);
            case "implies": return mkLiteral(sourceId, resolvedType, !lv || rv);
            case "==": return mkLiteral(sourceId, resolvedType, lv === rv);
            case "!=": return mkLiteral(sourceId, resolvedType, lv !== rv);
        }
    }

    // ── String comparison ──
    if (typeof lv === "string" && typeof rv === "string") {
        switch (op) {
            case "==": return mkLiteral(sourceId, resolvedType, lv === rv);
            case "!=": return mkLiteral(sourceId, resolvedType, lv !== rv);
        }
    }

    return undefined;
}

// =============================================================================
// Unary Operation Folding
// =============================================================================

function foldUnop(
    sourceId: string,
    op: UnaryOperator,
    operand: IRExpr & { kind: "ir_literal" },
    resolvedType: TypeExpr,
): IRExpr | undefined {
    const v = operand.value;

    if (op === "-" && typeof v === "number") {
        const isInt = resolvedType.kind === "basic" && resolvedType.name === "Int";
        return mkLiteral(sourceId, resolvedType, isInt ? wrap32(-v) : -v);
    }

    if (op === "not" && typeof v === "boolean") {
        return mkLiteral(sourceId, resolvedType, !v);
    }

    return undefined;
}

// =============================================================================
// Identity Optimizations
// =============================================================================

function tryIdentityFold(
    expr: IRExpr & { kind: "ir_binop" },
    left: IRExpr,
    right: IRExpr,
): IRExpr | undefined {
    const isIntOp = expr.resolvedOperandType.kind === "basic" && expr.resolvedOperandType.name === "Int";
    const isFloatOp = expr.resolvedOperandType.kind === "basic" && expr.resolvedOperandType.name === "Float";

    if (!isIntOp && !isFloatOp) return undefined;

    // x + 0 → x, 0 + x → x
    if (expr.op === "+") {
        if (isLiteralZero(right)) return left;
        if (isLiteralZero(left)) return right;
    }

    // x - 0 → x
    if (expr.op === "-" && isLiteralZero(right)) {
        return left;
    }

    // x * 1 → x, 1 * x → x
    if (expr.op === "*") {
        if (isLiteralOne(right)) return left;
        if (isLiteralOne(left)) return right;
        // x * 0 → 0, 0 * x → 0
        if (isLiteralZero(right)) return right;
        if (isLiteralZero(left)) return left;
    }

    return undefined;
}

function isLiteralZero(expr: IRExpr): boolean {
    return expr.kind === "ir_literal" && expr.value === 0;
}

function isLiteralOne(expr: IRExpr): boolean {
    return expr.kind === "ir_literal" && expr.value === 1;
}

// =============================================================================
// Helpers
// =============================================================================

function mkLiteral(sourceId: string, resolvedType: TypeExpr, value: number | string | boolean): IRExpr {
    return {
        kind: "ir_literal",
        sourceId,
        resolvedType,
        value,
    };
}

/** Wrap a number to 32-bit signed integer range (matching WASM i32 semantics) */
function wrap32(n: number): number {
    return n | 0;
}

/** Wrap an expression list as a block (or return the single expression) */
function wrapAsBlock(sourceId: string, resolvedType: TypeExpr, body: IRExpr[]): IRExpr {
    if (body.length === 1) return body[0]!;
    return {
        kind: "ir_block",
        sourceId,
        resolvedType,
        body,
    };
}
