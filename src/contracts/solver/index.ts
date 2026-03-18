// =============================================================================
// Built-in Solver Context — SolverContext implementation using the custom solver
// =============================================================================
// Factory function that creates a SolverContext backed by the pure-JS
// evaluation-based QF-LIA solver. Drop-in replacement for Z3 for
// quantifier-free contracts.

import type { SolverContext } from "../solver-context.js";
import { wrapExpr, makeSortDescriptor } from "./types.js";
import { BuiltinSolver } from "./solver.js";

/**
 * Create a SolverContext backed by the built-in QF-LIA solver.
 *
 * Supports: Int, Bool, Real sorts; arithmetic, comparison, boolean ops.
 * Does NOT support: ForAll, Exists, Array, Function (returns undefined).
 */
export function createBuiltinSolver(): SolverContext {
    return {
        Int: {
            const(name: string) { return wrapExpr({ tag: "int_var", name }, "Int"); },
            val(n: number) { return wrapExpr({ tag: "int_const", value: n }, "Int"); },
            sort() { return makeSortDescriptor("Int"); },
        },
        Bool: {
            const(name: string) { return wrapExpr({ tag: "bool_var", name }, "Bool"); },
            val(v: boolean) { return wrapExpr({ tag: "bool_const", value: v }, "Bool"); },
        },
        Real: {
            const(name: string) { return wrapExpr({ tag: "real_var", name }, "Real"); },
            val(n: number) { return wrapExpr({ tag: "real_const", value: n }, "Real"); },
        },
        And(...args: any[]) {
            if (args.length === 0) return wrapExpr({ tag: "bool_const", value: true }, "Bool");
            if (args.length === 1) return args[0];
            return wrapExpr(
                { tag: "bool_binop", op: "and", args: args.map(a => a.__expr ?? a) },
                "Bool",
            );
        },
        Or(...args: any[]) {
            if (args.length === 0) return wrapExpr({ tag: "bool_const", value: false }, "Bool");
            if (args.length === 1) return args[0];
            return wrapExpr(
                { tag: "bool_binop", op: "or", args: args.map(a => a.__expr ?? a) },
                "Bool",
            );
        },
        Not(expr: any) {
            return wrapExpr({ tag: "bool_not", operand: expr.__expr ?? expr }, "Bool");
        },
        Implies(a: any, b: any) {
            return wrapExpr(
                { tag: "bool_binop", op: "implies", args: [a.__expr ?? a, b.__expr ?? b] },
                "Bool",
            );
        },
        If(cond: any, thenExpr: any, elseExpr: any) {
            // Determine sort from then branch
            const thenSort = thenExpr?.sort?.name?.() ?? "Int";
            return wrapExpr(
                { tag: "ite", cond: cond.__expr ?? cond, thenExpr: thenExpr.__expr ?? thenExpr, elseExpr: elseExpr.__expr ?? elseExpr },
                thenSort,
            );
        },
        Solver: BuiltinSolver as any,
        // Quantifiers and advanced features: NOT supported
        // ForAll, Exists, Array, Function are undefined
    };
}
