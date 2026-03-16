// =============================================================================
// IR Expression compilation — dispatches to compile-ir-{scalars,calls,data,match}.ts
// =============================================================================
// The IR counterpart to compile-expr.ts. Instead of inferring WASM types from
// AST node shapes, this module reads pre-resolved types from IR nodes.
//
// Key difference: inferExprWasmType (130 lines of heuristic probing) is
// replaced by irExprWasmType (one-liner: edictTypeToWasm(expr.resolvedType)).

import * as binaryen from "./wasm-encoder.js";
import type { IRExpr } from "../ir/types.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import {
    compileIRLiteral,
    compileIRIdent,
    compileIRBinop,
    compileIRUnop,
    compileIRIf,
    compileIRLet,
    compileIRBlock,
} from "./compile-ir-scalars.js";
import { compileIRCall, compileIRLambdaRef } from "./compile-ir-calls.js";
import {
    compileIRRecord,
    compileIRTuple,
    compileIREnumConstructor,
    compileIRAccess,
    compileIRArray,
    compileIRStringInterp,
} from "./compile-ir-data.js";
import { compileIRMatch } from "./compile-ir-match.js";


// =============================================================================
// IR WASM type resolution — replaces inferExprWasmType
// =============================================================================

/**
 * Get the WASM type for an IR expression.
 *
 * Unlike `inferExprWasmType` (which walks AST nodes, probes locals, chases
 * function signatures, and handles special cases), this is a trivial lookup
 * because the IR lowering pass already resolved all types.
 *
 * Falls back to `binaryen.i32` for unknown types via `edictTypeToWasm`.
 */
export function irExprWasmType(expr: IRExpr): binaryen.Type {
    return edictTypeToWasm(expr.resolvedType);
}


// =============================================================================
// IR Expression compilation dispatcher
// =============================================================================

/**
 * Compile an IR expression to a binaryen ExpressionRef.
 *
 * Dispatches by IR node kind. All IR kinds are implemented.
 */
export function compileIRExpr(
    expr: IRExpr,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    switch (expr.kind) {
        case "ir_literal":
            return compileIRLiteral(expr, cc);

        case "ir_ident":
            return compileIRIdent(expr, cc, ctx);

        case "ir_binop":
            return compileIRBinop(expr, cc, ctx);

        case "ir_unop":
            return compileIRUnop(expr, cc, ctx);

        case "ir_if":
            return compileIRIf(expr, cc, ctx);

        case "ir_let":
            return compileIRLet(expr, cc, ctx);

        case "ir_block":
            return compileIRBlock(expr, cc, ctx);

        case "ir_call":
            return compileIRCall(expr, cc, ctx);

        case "ir_match":
            return compileIRMatch(expr, cc, ctx);

        case "ir_record":
            return compileIRRecord(expr, cc, ctx);

        case "ir_enum_constructor":
            return compileIREnumConstructor(expr, cc, ctx);

        case "ir_access":
            return compileIRAccess(expr, cc, ctx);

        case "ir_array":
            return compileIRArray(expr, cc, ctx);

        case "ir_tuple":
            return compileIRTuple(expr, cc, ctx);

        case "ir_lambda_ref":
            return compileIRLambdaRef(expr, cc, ctx);

        case "ir_string_interp":
            return compileIRStringInterp(expr, cc, ctx);

        default: {
            // Exhaustiveness guard — all IR kinds should be handled above
            const _exhaustive: never = expr;
            cc.errors.push(wasmValidationError(
                `unknown IR expression kind: ${(_exhaustive as IRExpr).kind}`,
            ));
            return cc.mod.unreachable();
        }
    }
}
