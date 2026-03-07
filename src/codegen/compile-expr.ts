// =============================================================================
// Expression compilation — dispatches to compile-{scalars,calls,data,match}.ts
// =============================================================================
// Extracted from codegen.ts to break circular dependencies.
// All compile-*.ts modules import compileExpr/inferExprWasmType from HERE,
// not from codegen.ts. This file is the only one that imports from all
// compile-*.ts modules.

import binaryen from "binaryen";
import type { Expression } from "../ast/nodes.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { compileLiteral, compileIdent, compileBinop, compileUnop, compileIf, compileLet, compileBlock } from "./compile-scalars.js";
import { compileCall, compileLambdaExpr } from "./compile-calls.js";
import { compileRecordExpr, compileTupleExpr, compileEnumConstructor, compileAccess, compileArrayExpr, compileStringInterp } from "./compile-data.js";
import { compileMatch } from "./compile-match.js";


// =============================================================================
// Compile-time WASM type inference for expressions
// =============================================================================

/**
 * Infer the WASM type an expression will produce at runtime.
 * Used to dispatch i32 vs f64 instructions in binops, unops, and block types.
 */
export function inferExprWasmType(
    expr: Expression,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.Type {
    switch (expr.kind) {
        case "literal": {
            // If the literal has an explicit type annotation, use it
            if (expr.type) return edictTypeToWasm(expr.type);
            const val = expr.value;
            if (typeof val === "number" && !Number.isInteger(val)) return binaryen.f64;
            return binaryen.i32; // int, bool, string → i32
        }
        case "ident": {
            const local = ctx.getLocal(expr.name);
            if (local) return local.type;
            const globalType = cc.constGlobals.get(expr.name);
            if (globalType) return globalType;
            return binaryen.i32;
        }
        case "binop": {
            // Comparison/logical ops always return i32 (boolean)
            const cmpOps = ["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"];
            if (cmpOps.includes(expr.op)) return binaryen.i32;
            // Arithmetic: infer from left operand
            return inferExprWasmType(expr.left, cc, ctx);
        }
        case "unop":
            if (expr.op === "not") return binaryen.i32;
            return inferExprWasmType(expr.operand, cc, ctx);
        case "call": {
            if (expr.fn.kind === "ident") {
                const sig = cc.fnSigs.get(expr.fn.name);
                if (sig) return sig.returnType;
            }
            return binaryen.i32;
        }
        case "if":
            // Type of if is the type of the then branch's last expression
            if (expr.then.length > 0) {
                return inferExprWasmType(expr.then[expr.then.length - 1]!, cc, ctx);
            }
            return binaryen.i32;
        case "let":
            return binaryen.none; // let is a statement (local.set), returns void
        case "block":
            if (expr.body.length > 0) {
                return inferExprWasmType(expr.body[expr.body.length - 1]!, cc, ctx);
            }
            return binaryen.none;
        case "match":
            // Type of match is the type of the first arm's body
            if (expr.arms.length > 0 && expr.arms[0]!.body.length > 0) {
                const firstBody = expr.arms[0]!.body;
                return inferExprWasmType(firstBody[firstBody.length - 1]!, cc, ctx);
            }
            return binaryen.i32;
        case "array":
        case "tuple_expr":
        case "enum_constructor":
        case "record_expr":
            return binaryen.i32; // heap pointer
        case "string_interp":
            return binaryen.i32; // string pointer
        case "access": {
            let recordTypeName: string | undefined;
            if (expr.target.kind === "ident") {
                const local = ctx.getLocal(expr.target.name);
                if (local && local.edictTypeName) {
                    recordTypeName = local.edictTypeName;
                }
            } else if (expr.target.kind === "record_expr") {
                recordTypeName = expr.target.name;
            }
            if (recordTypeName) {
                const layout = cc.recordLayouts.get(recordTypeName);
                if (layout) {
                    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
                    if (fieldLayout) return fieldLayout.wasmType;
                }
            }
            return binaryen.i32; // fallback
        }
        default:
            return binaryen.i32;
    }
}


// =============================================================================
// Expression compilation dispatcher
// =============================================================================

export function compileExpr(
    expr: Expression,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    switch (expr.kind) {
        case "literal":
            return compileLiteral(expr, cc);

        case "ident":
            return compileIdent(expr, cc, ctx);

        case "binop":
            return compileBinop(expr, cc, ctx);

        case "unop":
            return compileUnop(expr, cc, ctx);

        case "call":
            return compileCall(expr, cc, ctx);

        case "if":
            return compileIf(expr, cc, ctx);

        case "let":
            return compileLet(expr, cc, ctx);

        case "block":
            return compileBlock(expr, cc, ctx);

        case "match":
            return compileMatch(expr, cc, ctx);

        case "record_expr":
            return compileRecordExpr(expr, cc, ctx);

        case "tuple_expr":
            return compileTupleExpr(expr, cc, ctx);

        case "enum_constructor":
            return compileEnumConstructor(expr, cc, ctx);

        case "access":
            return compileAccess(expr, cc, ctx);

        case "array":
            return compileArrayExpr(expr as Expression & { kind: "array" }, cc, ctx);

        case "lambda":
            return compileLambdaExpr(expr as Expression & { kind: "lambda" }, cc, ctx);

        case "string_interp":
            return compileStringInterp(expr as Expression & { kind: "string_interp" }, cc, ctx);

        default:
            cc.errors.push(wasmValidationError(`unsupported expression kind: ${(expr as any).kind}`));
            return cc.mod.unreachable();
    }
}
