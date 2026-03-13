// =============================================================================
// IR Optimization Passes — Constant Folding + Dead Code Elimination
// =============================================================================
// Walks the IR bottom-up and applies two optimization passes:
//
// Pass 1: Constant Folding (bottom-up)
// Walks the IR bottom-up and replaces foldable expressions with IRLiteral nodes.
//
// What it folds:
//   - IRBinop: arithmetic, comparison, boolean, and string ops with literal operands
//   - IRUnop: negation and logical not with literal operands
//   - IRIf: literal condition → replace with taken branch
//   - Identity ops: x + 0 → x, x * 1 → x, x - 0 → x, x * 0 → 0
//
// Pass 2: Dead Code Elimination (top-down per block/function)
//   - Unused let bindings: removed if the value expression is pure (no calls)
//   - Unreachable code: expressions after exit() calls in a block
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
// Dead Code Elimination (DCE)
// =============================================================================

/**
 * Collect all variable names referenced in an expression tree.
 * Used to determine which let-bound names are actually used.
 */
function collectUsedNames(exprs: IRExpr[]): Set<string> {
    const names = new Set<string>();
    for (const expr of exprs) {
        collectUsedNamesExpr(expr, names);
    }
    return names;
}

function collectUsedNamesExpr(expr: IRExpr, names: Set<string>): void {
    switch (expr.kind) {
        case "ir_ident":
            names.add(expr.name);
            break;
        case "ir_literal":
        case "ir_lambda_ref":
            break;
        case "ir_binop":
            collectUsedNamesExpr(expr.left, names);
            collectUsedNamesExpr(expr.right, names);
            break;
        case "ir_unop":
            collectUsedNamesExpr(expr.operand, names);
            break;
        case "ir_call":
            collectUsedNamesExpr(expr.fn, names);
            for (const arg of expr.args) collectUsedNamesExpr(arg, names);
            break;
        case "ir_if":
            collectUsedNamesExpr(expr.condition, names);
            for (const e of expr.then) collectUsedNamesExpr(e, names);
            for (const e of expr.else) collectUsedNamesExpr(e, names);
            break;
        case "ir_let":
            // The let itself doesn't "use" a name — it defines one.
            // But its value expression may reference other names.
            collectUsedNamesExpr(expr.value, names);
            break;
        case "ir_block":
            for (const e of expr.body) collectUsedNamesExpr(e, names);
            break;
        case "ir_match":
            collectUsedNamesExpr(expr.target, names);
            for (const arm of expr.arms) {
                for (const e of arm.body) collectUsedNamesExpr(e, names);
            }
            break;
        case "ir_array":
        case "ir_tuple":
            for (const e of expr.elements) collectUsedNamesExpr(e, names);
            break;
        case "ir_record":
            for (const f of expr.fields) collectUsedNamesExpr(f.value, names);
            break;
        case "ir_enum_constructor":
            for (const f of expr.fields) collectUsedNamesExpr(f.value, names);
            break;
        case "ir_access":
            collectUsedNamesExpr(expr.target, names);
            break;
        case "ir_string_interp":
            for (const p of expr.parts) collectUsedNamesExpr(p.expr, names);
            break;
    }
}

/**
 * Check if an expression may have side effects.
 * Pure expressions can be safely removed if their result is unused.
 *
 * Conservative: returns true for anything that could possibly have effects.
 * Only removes let bindings with values that are guaranteed pure.
 */
function mayHaveSideEffects(expr: IRExpr): boolean {
    switch (expr.kind) {
        case "ir_literal":
        case "ir_ident":
        case "ir_lambda_ref":
            return false;
        case "ir_binop":
            return mayHaveSideEffects(expr.left) || mayHaveSideEffects(expr.right);
        case "ir_unop":
            return mayHaveSideEffects(expr.operand);
        case "ir_call":
            // All calls may have side effects (even builtins can print, etc.)
            return true;
        case "ir_if":
            // Condition or branches may be effectful
            return mayHaveSideEffects(expr.condition) ||
                expr.then.some(mayHaveSideEffects) ||
                expr.else.some(mayHaveSideEffects);
        case "ir_let":
            return mayHaveSideEffects(expr.value);
        case "ir_block":
            return expr.body.some(mayHaveSideEffects);
        case "ir_match":
            return mayHaveSideEffects(expr.target) ||
                expr.arms.some(arm => arm.body.some(mayHaveSideEffects));
        case "ir_array":
        case "ir_tuple":
            return expr.elements.some(mayHaveSideEffects);
        case "ir_record":
            return expr.fields.some(f => mayHaveSideEffects(f.value));
        case "ir_enum_constructor":
            return expr.fields.some(f => mayHaveSideEffects(f.value));
        case "ir_access":
            return mayHaveSideEffects(expr.target);
        case "ir_string_interp":
            // String interp may call coercion builtins (intToString, etc.)
            // These are pure in practice, but treat as effectful to be safe
            return true;
    }
}

/**
 * Check if an expression is an exit() call — anything after it
 * in a block is unreachable.
 *
 * Only `exit` is recognized — it's the sole diverging builtin
 * in the Edict builtins registry (src/builtins/domains/io.ts).
 */
function isTerminatingCall(expr: IRExpr): boolean {
    if (expr.kind !== "ir_call") return false;
    if (expr.fn.kind !== "ir_ident") return false;
    return expr.fn.name === "exit";
}

/**
 * Remove unused let bindings from a body (list of expressions).
 *
 * A let binding `let x = e` is dead if:
 * 1. The name `x` is never referenced in any subsequent expression in the body
 * 2. The value `e` is pure (no side effects)
 *
 * We scan backwards: collect used names from all expressions after the current one,
 * then check if the let binding's name is in the set.
 */
function eliminateDeadLets(body: IRExpr[]): IRExpr[] {
    if (body.length === 0) return body;

    // Collect names used in ALL subsequent expressions for each position.
    // usedAfter[i] = names used in body[i+1..end]
    const usedAfter: Set<string>[] = new Array(body.length);
    usedAfter[body.length - 1] = new Set();
    for (let i = body.length - 2; i >= 0; i--) {
        const next = new Set(usedAfter[i + 1]!);
        const exprNames = collectUsedNames([body[i + 1]!]);
        for (const n of exprNames) next.add(n);
        usedAfter[i] = next;
    }

    const result: IRExpr[] = [];
    let changed = false;

    for (let i = 0; i < body.length; i++) {
        const expr = body[i]!;
        if (expr.kind === "ir_let") {
            const nameUsed = usedAfter[i]!.has(expr.name);
            if (!nameUsed && !mayHaveSideEffects(expr.value)) {
                // Dead let binding — skip it
                changed = true;
                continue;
            }
        }
        result.push(expr);
    }

    return changed ? result : body;
}

/**
 * Remove unreachable code after exit() calls.
 * In a block, any expressions after a terminating call are dead.
 */
function removeUnreachable(body: IRExpr[]): IRExpr[] {
    for (let i = 0; i < body.length; i++) {
        if (isTerminatingCall(body[i]!)) {
            // Everything after this is unreachable
            if (i + 1 < body.length) {
                return body.slice(0, i + 1);
            }
            break;
        }
    }
    return body;
}

// =============================================================================
// Function & Constant Optimization
// =============================================================================

function optimizeFunction(fn: IRFunction): IRFunction {
    // Pass 1: constant folding (bottom-up)
    let body = fn.body.map(foldExpr);
    // Pass 2: dead code elimination
    body = eliminateDeadLets(body);
    body = removeUnreachable(body);
    return { ...fn, body };
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
            let thenBody = expr.then.map(foldExpr);
            let elseBody = expr.else.map(foldExpr);

            // Apply DCE inside branches
            thenBody = removeUnreachable(eliminateDeadLets(thenBody));
            elseBody = removeUnreachable(eliminateDeadLets(elseBody));

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

        case "ir_block": {
            let body = expr.body.map(foldExpr);
            body = eliminateDeadLets(body);
            body = removeUnreachable(body);
            return { ...expr, body };
        }

        case "ir_match": {
            const target = foldExpr(expr.target);
            const arms: IRMatchArm[] = expr.arms.map(arm => {
                let body = arm.body.map(foldExpr);
                body = eliminateDeadLets(body);
                body = removeUnreachable(body);
                return { ...arm, body };
            });
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
