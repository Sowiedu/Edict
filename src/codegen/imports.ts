// =============================================================================
// Import Signature Inference — infer WASM types for module-level imports
// =============================================================================
// Extracted from codegen.ts for modularity.

import binaryen from "binaryen";
import type { EdictModule, Expression, FunctionDef } from "../ast/nodes.js";
import { edictTypeToWasm } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export interface ImportSig {
    paramTypes: binaryen.Type[];
    returnType: binaryen.Type;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * FALLBACK: Scan function bodies for calls to imported names and infer WASM types
 * from the function's declared param/return types at call sites.
 *
 * When imports declare typed signatures (Import.types), the codegen uses those
 * directly. This inference is only needed for backwards-compatible untyped imports.
 */
export function inferImportSignatures(
    module: EdictModule,
    importedNames: Set<string>,
): Map<string, ImportSig> {
    const sigs = new Map<string, ImportSig>();

    // Initialize with defaults
    for (const name of importedNames) {
        sigs.set(name, { paramTypes: [], returnType: binaryen.i32 });
    }

    // Multi-pass: run inference until stable (handles ordering deps like pow→sqrt)
    for (let pass = 0; pass < 3; pass++) {
        for (const def of module.definitions) {
            if (def.kind !== "fn") continue;
            inferFromExprs(def.body, def, sigs, importedNames);
        }
    }

    return sigs;
}

// =============================================================================
// Internal helpers
// =============================================================================

function inferFromExprs(
    exprs: Expression[],
    enclosingFn: FunctionDef,
    sigs: Map<string, ImportSig>,
    importedNames: Set<string>,
): void {
    for (const expr of exprs) {
        inferFromExpr(expr, enclosingFn, sigs, importedNames);
    }
}

function inferFromExpr(
    expr: Expression,
    enclosingFn: FunctionDef,
    sigs: Map<string, ImportSig>,
    importedNames: Set<string>,
): void {
    if (expr.kind === "call" && expr.fn.kind === "ident" && importedNames.has(expr.fn.name)) {
        const name = expr.fn.name;
        // Infer param types from arguments
        const paramTypes = expr.args.map(arg => inferTypeFromExpr(arg, enclosingFn, sigs));
        // If any param is f64, promote all i32 numeric params to f64
        // (JSON can't distinguish 2.0 from 2; Edict doesn't mix int/float in one function)
        const hasFloat = paramTypes.some(t => t === binaryen.f64);
        if (hasFloat) {
            for (let j = 0; j < paramTypes.length; j++) {
                if (paramTypes[j] === binaryen.i32 && expr.args[j]?.kind === "literal" &&
                    typeof (expr.args[j] as Expression & { kind: "literal" }).value === "number") {
                    paramTypes[j] = binaryen.f64;
                }
            }
        }
        // Infer return type from the enclosing function's return type
        // (if this call is the last expression in the function body, it determines the return type)
        const lastExprInBody = enclosingFn.body.length > 0
            ? enclosingFn.body[enclosingFn.body.length - 1]
            : null;
        const returnType = isExprOrContains(lastExprInBody, expr) && enclosingFn.returnType
            ? edictTypeToWasm(enclosingFn.returnType)
            : binaryen.i32;
        sigs.set(name, { paramTypes, returnType });
    }

    // Recurse into sub-expressions
    switch (expr.kind) {
        case "binop": inferFromExpr(expr.left, enclosingFn, sigs, importedNames); inferFromExpr(expr.right, enclosingFn, sigs, importedNames); break;
        case "unop": inferFromExpr(expr.operand, enclosingFn, sigs, importedNames); break;
        case "call": inferFromExpr(expr.fn, enclosingFn, sigs, importedNames); for (const a of expr.args) inferFromExpr(a, enclosingFn, sigs, importedNames); break;
        case "if": inferFromExpr(expr.condition, enclosingFn, sigs, importedNames); inferFromExprs(expr.then, enclosingFn, sigs, importedNames); if (expr.else) inferFromExprs(expr.else, enclosingFn, sigs, importedNames); break;
        case "let": inferFromExpr(expr.value, enclosingFn, sigs, importedNames); break;
        case "block": inferFromExprs(expr.body, enclosingFn, sigs, importedNames); break;
        case "match": inferFromExpr(expr.target, enclosingFn, sigs, importedNames); for (const arm of expr.arms) inferFromExprs(arm.body, enclosingFn, sigs, importedNames); break;
        case "lambda": inferFromExprs(expr.body, enclosingFn, sigs, importedNames); break;
        case "array": for (const el of expr.elements) inferFromExpr(el, enclosingFn, sigs, importedNames); break;
        case "record_expr": for (const f of expr.fields) inferFromExpr(f.value, enclosingFn, sigs, importedNames); break;
        case "access": inferFromExpr(expr.target, enclosingFn, sigs, importedNames); break;
        default: break;
    }
}

/**
 * Infer the WASM type of an expression from its AST structure.
 * Used during import signature inference (before we have a FunctionContext).
 */
function inferTypeFromExpr(
    expr: Expression,
    enclosingFn: FunctionDef,
    sigs?: Map<string, ImportSig>,
): binaryen.Type {
    if (expr.kind === "literal") {
        if (expr.type) return edictTypeToWasm(expr.type);
        if (typeof expr.value === "number" && !Number.isInteger(expr.value)) return binaryen.f64;
        return binaryen.i32;
    }
    if (expr.kind === "ident") {
        const param = enclosingFn.params.find(p => p.name === expr.name);
        if (param) return edictTypeToWasm(param.type!);
        return binaryen.i32;
    }
    if (expr.kind === "binop") {
        // Arithmetic result type follows left operand
        const cmpOps = ["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"];
        if (cmpOps.includes(expr.op)) return binaryen.i32;
        return inferTypeFromExpr(expr.left, enclosingFn, sigs);
    }
    if (expr.kind === "call" && expr.fn.kind === "ident") {
        // Check inferred import sigs first, then fn defs
        if (sigs?.has(expr.fn.name)) {
            return sigs.get(expr.fn.name)!.returnType;
        }
        // Check enclosing module's function definitions
        return binaryen.i32;
    }
    return binaryen.i32;
}

/**
 * Check if target expression is or contains the needle (by reference).
 */
function isExprOrContains(target: Expression | null | undefined, needle: Expression): boolean {
    if (!target) return false;
    if (target === needle) return true;
    switch (target.kind) {
        case "call": return target.args.some(a => isExprOrContains(a, needle)) || isExprOrContains(target.fn, needle);
        case "binop": return isExprOrContains(target.left, needle) || isExprOrContains(target.right, needle);
        case "unop": return isExprOrContains(target.operand, needle);
        default: return false;
    }
}
