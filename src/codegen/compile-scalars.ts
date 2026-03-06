// =============================================================================
// Scalar expression compilers — literal, ident, binop, unop, if, let, block
// =============================================================================

import binaryen from "binaryen";
import type { Expression } from "../ast/nodes.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { allocClosurePair } from "./closures.js";
import { compileExpr, inferExprWasmType } from "./codegen.js";

export function compileLiteral(
    expr: Expression & { kind: "literal" },
    cc: CompilationContext,
): binaryen.ExpressionRef {
    const { mod, strings } = cc;
    const val = expr.value;

    if (typeof val === "boolean") {
        return mod.i32.const(val ? 1 : 0);
    }
    // Int64 literal — value may be string (for >2^53 precision) or number
    if (expr.type?.kind === "basic" && expr.type.name === "Int64") {
        try {
            const big = BigInt(val as string | number);
            const low = Number(big & 0xFFFFFFFFn);
            const high = Number((big >> 32n) & 0xFFFFFFFFn);
            return mod.i64.const(low, high);
        } catch {
            cc.errors.push(wasmValidationError(`invalid Int64 literal value: ${JSON.stringify(val)}`));
            return mod.unreachable();
        }
    }
    if (typeof val === "number") {
        // Check type annotation first — 0.0 is integer in JS but Float in Edict
        if (expr.type && expr.type.kind === "basic" && expr.type.name === "Float") {
            return mod.f64.const(val);
        }
        if (Number.isInteger(val)) {
            return mod.i32.const(val);
        }
        return mod.f64.const(val);
    }
    if (typeof val === "string") {
        const interned = strings.intern(val);
        // Return the pointer (offset). The caller/callee will also need
        // the length — for builtin calls we handle this specially in compileCall.
        return mod.i32.const(interned.offset);
    }
    return mod.unreachable();
}

export function compileIdent(
    expr: Expression & { kind: "ident" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const local = ctx.getLocal(expr.name);
    if (local) {
        return mod.local.get(local.index, local.type);
    }
    // Check module-level const globals
    const globalType = cc.constGlobals.get(expr.name);
    if (globalType !== undefined) {
        return mod.global.get(expr.name, globalType);
    }
    // Check function table — return a closure pair (table_index, env_ptr=0)
    // This enables `let f = myFunc` to store a function reference as a closure
    const tableIndex = cc.fnTableIndices.get(expr.name);
    if (tableIndex !== undefined) {
        return allocClosurePair(
            mod, ctx,
            mod.i32.const(tableIndex),
            mod.i32.const(0),
            `ident_${expr.name}`,
        );
    }
    return mod.unreachable();
}

export function compileBinop(
    expr: Expression & { kind: "binop" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs, errors } = cc;
    const left = compileExpr(expr.left, cc, ctx);
    const right = compileExpr(expr.right, cc, ctx);

    // Determine the WASM type from the left operand.
    // Type checker guarantees matching types for both operands.
    const opType = inferExprWasmType(expr.left, cc, ctx);
    const isFloat = opType === binaryen.f64;
    const isInt64 = opType === binaryen.i64;

    switch (expr.op) {
        case "+":
            return isFloat ? mod.f64.add(left, right) : isInt64 ? mod.i64.add(left, right) : mod.i32.add(left, right);
        case "-":
            return isFloat ? mod.f64.sub(left, right) : isInt64 ? mod.i64.sub(left, right) : mod.i32.sub(left, right);
        case "*":
            return isFloat ? mod.f64.mul(left, right) : isInt64 ? mod.i64.mul(left, right) : mod.i32.mul(left, right);
        case "/":
            return isFloat ? mod.f64.div(left, right) : isInt64 ? mod.i64.div_s(left, right) : mod.i32.div_s(left, right);
        case "%":
            if (isFloat) {
                errors.push(wasmValidationError(`modulo (%) not supported for Float`));
                return mod.unreachable();
            }
            return isInt64 ? mod.i64.rem_s(left, right) : mod.i32.rem_s(left, right);
        case "==":
            return isFloat ? mod.f64.eq(left, right) : isInt64 ? mod.i64.eq(left, right) : mod.i32.eq(left, right);
        case "!=":
            return isFloat ? mod.f64.ne(left, right) : isInt64 ? mod.i64.ne(left, right) : mod.i32.ne(left, right);
        case "<":
            return isFloat ? mod.f64.lt(left, right) : isInt64 ? mod.i64.lt_s(left, right) : mod.i32.lt_s(left, right);
        case ">":
            return isFloat ? mod.f64.gt(left, right) : isInt64 ? mod.i64.gt_s(left, right) : mod.i32.gt_s(left, right);
        case "<=":
            return isFloat ? mod.f64.le(left, right) : isInt64 ? mod.i64.le_s(left, right) : mod.i32.le_s(left, right);
        case ">=":
            return isFloat ? mod.f64.ge(left, right) : isInt64 ? mod.i64.ge_s(left, right) : mod.i32.ge_s(left, right);
        case "and":
            return mod.i32.and(left, right);
        case "or":
            return mod.i32.or(left, right);
        case "implies":
            // A implies B ≡ (not A) or B
            return mod.i32.or(mod.i32.eqz(left), right);
        default:
            errors.push(wasmValidationError(`unsupported binop: ${expr.op}`));
            return mod.unreachable();
    }
}

export function compileUnop(
    expr: Expression & { kind: "unop" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs, errors } = cc;
    const operand = compileExpr(expr.operand, cc, ctx);
    const opType = inferExprWasmType(expr.operand, cc, ctx);
    const isFloat = opType === binaryen.f64;

    const isInt64 = opType === binaryen.i64;

    switch (expr.op) {
        case "-":
            return isFloat
                ? mod.f64.neg(operand)
                : isInt64
                    ? mod.i64.sub(mod.i64.const(0, 0), operand)
                    : mod.i32.sub(mod.i32.const(0), operand);
        case "not":
            return mod.i32.eqz(operand);
        default:
            errors.push(wasmValidationError(`unsupported unop: ${expr.op}`));
            return mod.unreachable();
    }
}

export function compileIf(
    expr: Expression & { kind: "if" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
    const cond = compileExpr(expr.condition, cc, ctx);

    // Infer the result type from the then-branch's last expression
    const resultType = expr.then.length > 0
        ? inferExprWasmType(expr.then[expr.then.length - 1]!, cc, ctx)
        : binaryen.i32;

    const thenExprs = expr.then.map((e) =>
        compileExpr(e, cc, ctx),
    );
    const thenBody =
        thenExprs.length === 1
            ? thenExprs[0]!
            : mod.block(null, thenExprs, resultType);

    if (expr.else) {
        const elseExprs = expr.else.map((e) =>
            compileExpr(e, cc, ctx),
        );
        const elseBody =
            elseExprs.length === 1
                ? elseExprs[0]!
                : mod.block(null, elseExprs, resultType);
        return mod.if(cond, thenBody, elseBody);
    }

    return mod.if(cond, thenBody);
}

export function compileLet(
    expr: Expression & { kind: "let" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings, fnSigs } = cc;
    const wasmType = expr.type
        ? edictTypeToWasm(expr.type)
        : inferExprWasmType(expr.value, cc, ctx);

    let edictTypeName: string | undefined;
    if (expr.type && expr.type.kind === "named") {
        edictTypeName = expr.type.name;
    } else if (expr.type && expr.type.kind === "option") {
        edictTypeName = "Option";
    } else if (expr.type && expr.type.kind === "result") {
        edictTypeName = "Result";
    } else if (expr.value.kind === "record_expr") {
        edictTypeName = expr.value.name;
    } else if (expr.value.kind === "enum_constructor") {
        edictTypeName = expr.value.enumName;
    }

    const index = ctx.addLocal(expr.name, wasmType, edictTypeName);
    const value = compileExpr(expr.value, cc, ctx);
    const localSet = mod.local.set(index, value);

    // For String-type let bindings from literals, also set __str_ret_len
    // so downstream string builtins can read the correct length.
    // For calls to string-returning builtins, __str_ret_len is already set by the host.
    const isStringType = expr.type?.kind === "basic" && expr.type.name === "String";
    if (isStringType && expr.value.kind === "literal" && typeof expr.value.value === "string") {
        const interned = strings.intern(expr.value.value);
        return mod.block(null, [
            localSet,
            mod.global.set("__str_ret_len", mod.i32.const(interned.length)),
        ], binaryen.none);
    }

    return localSet;
}

export function compileBlock(
    expr: Expression & { kind: "block" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, fnSigs } = cc;
    const bodyExprs = expr.body.map((e) =>
        compileExpr(e, cc, ctx),
    );
    if (bodyExprs.length === 0) return mod.nop();
    if (bodyExprs.length === 1) return bodyExprs[0]!;
    const blockType = inferExprWasmType(expr.body[expr.body.length - 1]!, cc, ctx);
    return mod.block(null, bodyExprs, blockType);
}
