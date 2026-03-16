// =============================================================================
// IR Scalar expression compilers — literal, ident, binop, unop, if, let, block
// =============================================================================
// The IR counterpart to compile-scalars.ts. All type information comes from
// pre-resolved IR node fields, eliminating heuristic inference:
//
// - compileLet: uses expr.boundType directly (eliminates edictTypeName chain)
// - compileBinop: uses expr.resolvedOperandType (eliminates isStringExpr)
// - compileIdent: uses expr.scope (eliminates probe chain)

import * as binaryen from "./wasm-encoder.js";
import type {
    IRLiteral,
    IRIdent,
    IRBinop,
    IRUnop,
    IRIf,
    IRLet,
    IRBlock,
} from "../ir/types.js";
import type { TypeExpr } from "../ast/types.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { allocClosurePair } from "./closures.js";
import { compileIRExpr, irExprWasmType } from "./compile-ir-expr.js";


// =============================================================================
// Helper: derive edictTypeName from a TypeExpr
// =============================================================================

/**
 * Derive the edictTypeName string from a resolved TypeExpr.
 *
 * This replaces the 20-line conditional chain in compileLet (lines 309–329
 * of compile-scalars.ts) with a mechanical derivation from the type.
 */
function deriveEdictTypeName(type: TypeExpr): string | undefined {
    switch (type.kind) {
        case "basic":
            return type.name === "String" ? "String" : undefined;
        case "named":
            return type.name;
        case "option":
            return "Option";
        case "result":
            return "Result";
        case "tuple":
            return "__tuple";
        default:
            return undefined;
    }
}


// =============================================================================
// Literal
// =============================================================================

export function compileIRLiteral(
    expr: IRLiteral,
    cc: CompilationContext,
): binaryen.ExpressionRef {
    const { mod, strings } = cc;
    const val = expr.value;
    const type = expr.resolvedType;

    // Use the resolved type to dispatch — no typeof heuristic needed
    if (type.kind === "basic") {
        switch (type.name) {
            case "Bool":
                return mod.i32.const(val ? 1 : 0);

            case "Int64": {
                try {
                    const big = BigInt(val as string | number);
                    const low = Number(big & 0xFFFFFFFFn);
                    const high = Number((big >> 32n) & 0xFFFFFFFFn);
                    return mod.i64.const(low, high);
                } catch {
                    cc.errors.push(wasmValidationError(
                        `invalid Int64 literal value: ${JSON.stringify(val)}`,
                    ));
                    return mod.unreachable();
                }
            }

            case "Float":
                return mod.f64.const(val as number);

            case "String": {
                const interned = strings.intern(val as string);
                return mod.i32.const(interned.offset);
            }

            case "Int":
            default:
                return mod.i32.const(val as number);
        }
    }

    // Fallback: use JS typeof for non-basic types in literals
    // (should not happen with well-formed IR, but defensive)
    if (typeof val === "boolean") return mod.i32.const(val ? 1 : 0);
    if (typeof val === "string") {
        const interned = strings.intern(val);
        return mod.i32.const(interned.offset);
    }
    if (typeof val === "number") {
        if (Number.isInteger(val)) return mod.i32.const(val);
        return mod.f64.const(val);
    }
    return mod.unreachable();
}


// =============================================================================
// Identifier
// =============================================================================

export function compileIRIdent(
    expr: IRIdent,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;

    // Dispatch by pre-resolved scope — no probe chain needed
    switch (expr.scope) {
        case "local": {
            const local = ctx.getLocal(expr.name);
            if (local) {
                return mod.local.get(local.index, local.type);
            }
            // Local not yet registered — should not happen with well-formed IR
            cc.errors.push(wasmValidationError(
                `IR ident '${expr.name}' classified as local but not found in FunctionContext`,
            ));
            return mod.unreachable();
        }

        case "global": {
            const globalType = cc.constGlobals.get(expr.name);
            if (globalType !== undefined) {
                return mod.global.get(expr.name, globalType);
            }
            cc.errors.push(wasmValidationError(
                `IR ident '${expr.name}' classified as global but not found in constGlobals`,
            ));
            return mod.unreachable();
        }

        case "function": {
            const tableIndex = cc.fnTableIndices.get(expr.name);
            if (tableIndex !== undefined) {
                return allocClosurePair(
                    mod, ctx,
                    mod.i32.const(tableIndex),
                    mod.i32.const(0),
                    `ident_${expr.name}`,
                );
            }
            cc.errors.push(wasmValidationError(
                `IR ident '${expr.name}' classified as function but not found in fnTableIndices`,
            ));
            return mod.unreachable();
        }

        case "closure": {
            // Closure variables are read from the __env pointer
            // This will be fully implemented with lambda codegen in #161
            // For now, treat as local (closure env loading happens at function entry)
            const local = ctx.getLocal(expr.name);
            if (local) {
                return mod.local.get(local.index, local.type);
            }
            cc.errors.push(wasmValidationError(
                `IR ident '${expr.name}' classified as closure but not found`,
            ));
            return mod.unreachable();
        }
    }
}


// =============================================================================
// Binary Operation
// =============================================================================

export function compileIRBinop(
    expr: IRBinop,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const left = compileIRExpr(expr.left, cc, ctx);
    const right = compileIRExpr(expr.right, cc, ctx);

    // Use pre-resolved operand type — eliminates inferExprWasmType call
    const opWasmType = edictTypeToWasm(expr.resolvedOperandType);
    const isFloat = opWasmType === binaryen.f64;
    const isInt64 = opWasmType === binaryen.i64;

    // Detect string concat via resolvedOperandType — eliminates isStringExpr heuristic
    const isStringBinop = expr.op === "+"
        && !isFloat && !isInt64
        && expr.resolvedOperandType.kind === "basic"
        && expr.resolvedOperandType.name === "String";

    switch (expr.op) {
        case "+":
            if (isStringBinop) {
                return mod.call("string_concat", [left, right], binaryen.i32);
            }
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


// =============================================================================
// Unary Operation
// =============================================================================

export function compileIRUnop(
    expr: IRUnop,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const operand = compileIRExpr(expr.operand, cc, ctx);
    const opType = irExprWasmType(expr.operand);
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


// =============================================================================
// If Expression
// =============================================================================

export function compileIRIf(
    expr: IRIf,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const cond = compileIRExpr(expr.condition, cc, ctx);

    // Use pre-resolved result type from IR
    const resultType = expr.then.length > 0
        ? irExprWasmType(expr.then[expr.then.length - 1]!)
        : binaryen.i32;

    const thenExprs = expr.then.map(e => compileIRExpr(e, cc, ctx));
    const thenBody = thenExprs.length === 1
        ? thenExprs[0]!
        : mod.block(null, thenExprs, resultType);

    // if-with-else: standard branch
    if (expr.else.length > 0) {
        const elseExprs = expr.else.map(e => compileIRExpr(e, cc, ctx));
        const elseBody = elseExprs.length === 1
            ? elseExprs[0]!
            : mod.block(null, elseExprs, resultType);
        return mod.if(cond, thenBody, elseBody);
    }

    // if-without-else: produces Option<T> — Some(value) on true, None on false
    const optLayout = cc.enumLayouts.get("Option");
    const someVariant = optLayout?.variants.find(v => v.name === "Some");
    const optSize = someVariant?.totalSize ?? 16;
    const optPtrIdx = ctx.addLocal(`__opt_${expr.sourceId}`, binaryen.i32);

    const thenValueType = expr.then.length > 0
        ? irExprWasmType(expr.then[expr.then.length - 1]!)
        : binaryen.i32;

    const storeValue = thenValueType === binaryen.f64
        ? mod.f64.store(8, 0, mod.local.get(optPtrIdx, binaryen.i32), thenBody)
        : mod.i32.store(8, 0, mod.local.get(optPtrIdx, binaryen.i32), thenBody);

    const someBranch = mod.block(null, [
        mod.local.set(optPtrIdx, mod.global.get("__heap_ptr", binaryen.i32)),
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.local.get(optPtrIdx, binaryen.i32), mod.i32.const(optSize))),
        mod.i32.store(0, 0, mod.local.get(optPtrIdx, binaryen.i32), mod.i32.const(1)),
        storeValue,
    ], binaryen.none);

    const noneBranch = mod.block(null, [
        mod.local.set(optPtrIdx, mod.global.get("__heap_ptr", binaryen.i32)),
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.local.get(optPtrIdx, binaryen.i32), mod.i32.const(optSize))),
        mod.i32.store(0, 0, mod.local.get(optPtrIdx, binaryen.i32), mod.i32.const(0)),
    ], binaryen.none);

    return mod.block(null, [
        mod.if(cond, someBranch, noneBranch),
        mod.local.get(optPtrIdx, binaryen.i32),
    ], binaryen.i32);
}


// =============================================================================
// Let Binding
// =============================================================================

export function compileIRLet(
    expr: IRLet,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;

    // Use pre-resolved boundType — eliminates the edictTypeName inference chain
    const wasmType = edictTypeToWasm(expr.boundType);
    const edictTypeName = deriveEdictTypeName(expr.boundType);
    const edictType = expr.boundType.kind === "tuple" ? expr.boundType : undefined;

    const index = ctx.addLocal(expr.name, wasmType, edictTypeName, edictType);
    const value = compileIRExpr(expr.value, cc, ctx);

    return mod.local.set(index, value);
}


// =============================================================================
// Block
// =============================================================================

export function compileIRBlock(
    expr: IRBlock,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const bodyExprs = expr.body.map(e => compileIRExpr(e, cc, ctx));

    if (bodyExprs.length === 0) return mod.nop();
    if (bodyExprs.length === 1) {
        // Single let: append local.get to produce the bound value
        const singleExpr = expr.body[0]!;
        if (singleExpr.kind === "ir_let") {
            const local = ctx.getLocal(singleExpr.name);
            if (local) {
                return mod.block(null, [
                    bodyExprs[0]!,
                    mod.local.get(local.index, local.type),
                ], local.type);
            }
        }
        return bodyExprs[0]!;
    }

    const lastBodyExpr = expr.body[expr.body.length - 1]!;
    let blockType = irExprWasmType(lastBodyExpr);

    // Fixup: if the last expression is `let`, its codegen is void (local.set),
    // but the block may need to produce its value. Append local.get read-back.
    if (lastBodyExpr.kind === "ir_let") {
        const local = ctx.getLocal(lastBodyExpr.name);
        if (local) {
            bodyExprs.push(mod.local.get(local.index, local.type));
            blockType = local.type;
        }
    }

    return mod.block(null, bodyExprs, blockType);
}
