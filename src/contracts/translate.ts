// =============================================================================
// Edict Expression → Z3 Expression Translator
// =============================================================================
// Translates Edict AST Expression nodes into Z3 SMT expressions.
// Unsupported expression kinds return null and push a TranslationError.

import type { Expression, Param, EdictModule, FunctionDef } from "../ast/nodes.js";
import type { Context } from "z3-solver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Z3Context = Context<"main">;

export interface TranslationContext {
    /** Z3 context with high-level API (Int, Bool, Real, Solver, Not, And, Or, ...) */
    ctx: Z3Context;
    /** name → Z3 variable */
    variables: Map<string, any>;
    errors: TranslationError[];
    /** Module for function lookup during call inlining (optional) */
    module?: EdictModule;
    /** Current call inlining depth for recursion guard (default 0) */
    callDepth?: number;
    /** Functions currently being inlined to prevent recursion */
    visitedFunctions?: Set<string>;
}

export interface TranslationError {
    contractId: string;
    functionName: string;
    unsupportedNodeKind: string;
}

// ---------------------------------------------------------------------------
// Parameter → Z3 Variable creation
// ---------------------------------------------------------------------------

/**
 * Create Z3 variables for each function parameter based on Param.type.
 * Returns false if any param has an unsupported type (no Z3 variable created for it).
 */
export function createParamVariables(
    tctx: TranslationContext,
    params: Param[],
): boolean {
    let allSupported = true;
    const { ctx } = tctx;

    for (const p of params) {
        if (p.type.kind === "basic") {
            switch (p.type.name) {
                case "Int":
                    tctx.variables.set(p.name, ctx.Int.const(p.name));
                    break;
                case "Float":
                    tctx.variables.set(p.name, ctx.Real.const(p.name));
                    break;
                case "Bool":
                    tctx.variables.set(p.name, ctx.Bool.const(p.name));
                    break;
                default:
                    allSupported = false;
            }
        } else {
            allSupported = false;
        }
    }

    return allSupported;
}

// ---------------------------------------------------------------------------
// Expression translation
// ---------------------------------------------------------------------------

/**
 * Translate an Edict Expression to a Z3 expression.
 * Returns null for unsupported expression kinds (pushes TranslationError).
 */
export function translateExpr(
    tctx: TranslationContext,
    expr: Expression,
    contractId: string,
    functionName: string,
): any | null {
    switch (expr.kind) {
        case "literal":
            return translateLiteral(tctx, expr.value, contractId, functionName);

        case "ident":
            return translateIdent(tctx, expr.name, contractId, functionName);

        case "binop":
            return translateBinop(tctx, expr, contractId, functionName);

        case "unop":
            return translateUnop(tctx, expr, contractId, functionName);

        case "access":
            return translateAccess(tctx, expr, contractId, functionName);

        case "if":
            return translateIf(tctx, expr, contractId, functionName);

        case "let":
            return translateLet(tctx, expr, contractId, functionName);

        case "match":
            return translateMatch(tctx, expr, contractId, functionName);

        case "call":
            return translateCall(tctx, expr, contractId, functionName);

        case "block":
            return translateBlock(tctx, expr, contractId, functionName);

        default:
            tctx.errors.push({ contractId, functionName, unsupportedNodeKind: expr.kind });
            return null;
    }
}

// ---------------------------------------------------------------------------
// Literal
// ---------------------------------------------------------------------------

function translateLiteral(
    tctx: TranslationContext,
    value: number | string | boolean,
    contractId: string,
    functionName: string,
): any | null {
    const { ctx } = tctx;

    if (typeof value === "boolean") {
        return ctx.Bool.val(value);
    }
    if (typeof value === "number") {
        if (Number.isInteger(value)) {
            return ctx.Int.val(value);
        }
        return ctx.Real.val(value);
    }
    // string literals not supported in Z3
    tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "literal:string" });
    return null;
}

// ---------------------------------------------------------------------------
// Identifier
// ---------------------------------------------------------------------------

function translateIdent(
    tctx: TranslationContext,
    name: string,
    contractId: string,
    functionName: string,
): any | null {
    const v = tctx.variables.get(name);
    if (v !== undefined) return v;

    // Unknown identifier — not a param or result
    tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `ident:${name}` });
    return null;
}

// ---------------------------------------------------------------------------
// Binary operation
// ---------------------------------------------------------------------------

function translateBinop(
    tctx: TranslationContext,
    expr: Expression & { kind: "binop" },
    contractId: string,
    functionName: string,
): any | null {
    const left = translateExpr(tctx, expr.left, contractId, functionName);
    const right = translateExpr(tctx, expr.right, contractId, functionName);
    if (left === null || right === null) return null;

    const { ctx } = tctx;

    switch (expr.op) {
        // Arithmetic
        case "+": return left.add(right);
        case "-": return left.sub(right);
        case "*": return left.mul(right);
        case "/": return left.div(right);
        case "%": return left.mod(right);

        // Comparison
        case "==": return left.eq(right);
        case "!=": return left.neq(right);
        case "<": return left.lt(right);
        case ">": return left.gt(right);
        case "<=": return left.le(right);
        case ">=": return left.ge(right);

        // Logical
        case "and": return ctx.And(left, right);
        case "or": return ctx.Or(left, right);
        case "implies": return ctx.Implies(left, right);

        default:
            tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `binop:${expr.op}` });
            return null;
    }
}

// ---------------------------------------------------------------------------
// Unary operation
// ---------------------------------------------------------------------------

function translateUnop(
    tctx: TranslationContext,
    expr: Expression & { kind: "unop" },
    contractId: string,
    functionName: string,
): any | null {
    const operand = translateExpr(tctx, expr.operand, contractId, functionName);
    if (operand === null) return null;

    switch (expr.op) {
        case "not": return tctx.ctx.Not(operand);
        case "-": return operand.neg();
        default:
            tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `unop:${expr.op}` });
            return null;
    }
}

// ---------------------------------------------------------------------------
// Field access (e.g., x.length → fresh Z3 Int variable)
// ---------------------------------------------------------------------------

function translateAccess(
    tctx: TranslationContext,
    expr: Expression & { kind: "access" },
    contractId: string,
    functionName: string,
): any | null {
    // Compute a synthetic variable name from the target
    let targetName: string;
    if (expr.target.kind === "ident") {
        targetName = expr.target.name;
    } else {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "access:complex_target" });
        return null;
    }

    const varName = `${targetName}.${expr.field}`;

    // Reuse if already created, otherwise create fresh Int variable
    let v = tctx.variables.get(varName);
    if (!v) {
        v = tctx.ctx.Int.const(varName);
        tctx.variables.set(varName, v);
    }
    return v;
}

// ---------------------------------------------------------------------------
// Expression list (shared helper for multi-expression walking)
// ---------------------------------------------------------------------------

/**
 * Walk an Expression[] accumulating `let` bindings, returning the last
 * expression's Z3 translation. Used by: if branches, match arms, block
 * bodies, and function body walking in verify.ts.
 */
export function translateExprList(
    tctx: TranslationContext,
    exprs: Expression[],
    contractId: string,
    functionName: string,
): any | null {
    if (exprs.length === 0) return null;
    for (let i = 0; i < exprs.length - 1; i++) {
        const e = exprs[i]!;
        if (e.kind === "let") {
            const val = translateExpr(tctx, e.value, contractId, functionName);
            if (val !== null) tctx.variables.set(e.name, val);
        }
        // Non-let intermediates ignored (pure, no side effects)
    }
    return translateExpr(tctx, exprs[exprs.length - 1]!, contractId, functionName);
}

// ---------------------------------------------------------------------------
// If expression → Z3 ite
// ---------------------------------------------------------------------------

function translateIf(
    tctx: TranslationContext,
    expr: Expression & { kind: "if" },
    contractId: string,
    functionName: string,
): any | null {
    // Both branches required for Z3 ite
    if (!expr.else || expr.else.length === 0) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "if:missing_else" });
        return null;
    }

    const cond = translateExpr(tctx, expr.condition, contractId, functionName);
    if (cond === null) return null;

    const thenVal = translateExprList(tctx, expr.then, contractId, functionName);
    if (thenVal === null) return null;

    const elseVal = translateExprList(tctx, expr.else, contractId, functionName);
    if (elseVal === null) return null;

    return tctx.ctx.If(cond, thenVal, elseVal);
}

// ---------------------------------------------------------------------------
// Let expression → variable binding (not a value)
// ---------------------------------------------------------------------------

function translateLet(
    tctx: TranslationContext,
    expr: Expression & { kind: "let" },
    contractId: string,
    functionName: string,
): any | null {
    const val = translateExpr(tctx, expr.value, contractId, functionName);
    if (val !== null) {
        tctx.variables.set(expr.name, val);
    }
    // let is not a value-producing expression
    return null;
}

// ---------------------------------------------------------------------------
// Match expression → chained Z3 ite
// ---------------------------------------------------------------------------

function translateMatch(
    tctx: TranslationContext,
    expr: Expression & { kind: "match" },
    contractId: string,
    functionName: string,
): any | null {
    const target = translateExpr(tctx, expr.target, contractId, functionName);
    if (target === null) return null;

    if (expr.arms.length === 0) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "match:empty" });
        return null;
    }

    // Separate literal arms from wildcard/binding
    const literalArms: { value: number | string | boolean; body: Expression[] }[] = [];
    let wildcardBody: Expression[] | null = null;
    let bindingName: string | null = null;

    for (const arm of expr.arms) {
        switch (arm.pattern.kind) {
            case "literal_pattern":
                literalArms.push({ value: arm.pattern.value, body: arm.body });
                break;
            case "wildcard":
                wildcardBody = arm.body;
                break;
            case "binding":
                // binding = wildcard + name binding (target → arm.pattern.name)
                wildcardBody = arm.body;
                bindingName = arm.pattern.name;
                break;
            default:
                // constructor patterns not supported
                tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `match:${arm.pattern.kind}` });
                return null;
        }
    }

    // Must have a wildcard/binding for ite default
    if (wildcardBody === null) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "match:no_wildcard" });
        return null;
    }

    // Translate wildcard/binding body as the default
    let defaultVal: any;
    if (bindingName !== null) {
        // Save variables, bind target → name, translate, restore
        const savedVars = new Map(tctx.variables);
        tctx.variables.set(bindingName, target);
        defaultVal = translateExprList(tctx, wildcardBody, contractId, functionName);
        tctx.variables = savedVars;
    } else {
        defaultVal = translateExprList(tctx, wildcardBody, contractId, functionName);
    }
    if (defaultVal === null) return null;

    // Build chained ite from right to left
    let result = defaultVal;
    for (let i = literalArms.length - 1; i >= 0; i--) {
        const arm = literalArms[i]!;
        const litVal = translateLiteral(tctx, arm.value, contractId, functionName);
        if (litVal === null) return null;

        const bodyVal = translateExprList(tctx, arm.body, contractId, functionName);
        if (bodyVal === null) return null;

        result = tctx.ctx.If(target.eq(litVal), bodyVal, result);
    }

    return result;
}

// ---------------------------------------------------------------------------
// Call expression → inline pure single-expr callee body
// ---------------------------------------------------------------------------

const MAX_CALL_DEPTH = 5;

function translateCall(
    tctx: TranslationContext,
    expr: Expression & { kind: "call" },
    contractId: string,
    functionName: string,
): any | null {
    // Only ident-based calls can be inlined
    if (expr.fn.kind !== "ident") {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "call:complex_fn" });
        return null;
    }

    const calleeName = expr.fn.name;

    // Need module context for function lookup
    if (!tctx.module) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: "call:no_module" });
        return null;
    }

    // Look up callee in module definitions
    const calleeDef = tctx.module.definitions.find(
        (d): d is FunctionDef => d.kind === "fn" && d.name === calleeName,
    );
    if (!calleeDef) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `call:unknown_fn:${calleeName}` });
        return null;
    }

    // Must be pure
    if (!calleeDef.effects.includes("pure")) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `call:not_pure:${calleeName}` });
        return null;
    }

    // Must have non-empty body
    if (calleeDef.body.length === 0) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `call:empty_body:${calleeName}` });
        return null;
    }

    // Recursion guard
    const depth = tctx.callDepth ?? 0;
    if (depth >= MAX_CALL_DEPTH) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `call:max_depth:${calleeName}` });
        return null;
    }

    const visited = tctx.visitedFunctions ?? new Set<string>();
    if (visited.has(calleeName)) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `call:recursive:${calleeName}` });
        return null;
    }

    // Arity check
    if (expr.args.length !== calleeDef.params.length) {
        tctx.errors.push({ contractId, functionName, unsupportedNodeKind: `call:arity:${calleeName}` });
        return null;
    }

    // Translate arguments
    const translatedArgs: any[] = [];
    for (const arg of expr.args) {
        const z3Arg = translateExpr(tctx, arg, contractId, functionName);
        if (z3Arg === null) return null;
        translatedArgs.push(z3Arg);
    }

    // Save variable state
    const savedVars = new Map(tctx.variables);

    // Bind callee params to translated args
    for (let i = 0; i < calleeDef.params.length; i++) {
        tctx.variables.set(calleeDef.params[i]!.name, translatedArgs[i]);
    }

    // Set recursion guard state
    const savedDepth = tctx.callDepth;
    const savedVisited = tctx.visitedFunctions;
    tctx.callDepth = depth + 1;
    tctx.visitedFunctions = new Set(visited);
    tctx.visitedFunctions.add(calleeName);

    // Translate callee body (supports multi-expression bodies with let bindings)
    const result = translateExprList(tctx, calleeDef.body, contractId, functionName);

    // Restore state
    tctx.variables = savedVars;
    tctx.callDepth = savedDepth;
    tctx.visitedFunctions = savedVisited;

    return result;
}

// ---------------------------------------------------------------------------
// Block expression → walk body, return last
// ---------------------------------------------------------------------------

function translateBlock(
    tctx: TranslationContext,
    expr: Expression & { kind: "block" },
    contractId: string,
    functionName: string,
): any | null {
    return translateExprList(tctx, expr.body, contractId, functionName);
}
