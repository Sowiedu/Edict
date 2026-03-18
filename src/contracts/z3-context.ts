// =============================================================================
// Z3 Context — Lazy singleton for Z3 WASM initialization + context
// =============================================================================

import { init, type Context } from "z3-solver";
import type { SolverContext } from "./solver-context.js";
import { createBuiltinSolver } from "./solver/index.js";

type Z3Context = Context<"main">;

let z3Ctx: Z3Context | null = null;

/**
 * Get or initialize the Z3 context (lazy singleton).
 * Z3 WASM initialization is expensive (~1s), so we cache the context.
 *
 * The returned Context has the high-level API: Int, Bool, Real, Solver,
 * and operations like Not, And, Or, Implies.
 */
export async function getZ3(): Promise<Z3Context> {
    if (!z3Ctx) {
        const { Context } = await init();
        z3Ctx = Context("main");
    }
    return z3Ctx;
}

/**
 * Get a solver context — the abstract interface for SMT solving.
 *
 * @param options.useZ3 - Use Z3 solver (default: false — uses built-in QF-LIA solver)
 * @returns SolverContext instance
 */
export async function getSolver(options?: { useZ3?: boolean }): Promise<SolverContext> {
    if (options?.useZ3) {
        return await getZ3() as unknown as SolverContext;
    }
    return createBuiltinSolver();
}

/** Reset the Z3 context (used by tests). */
export function resetZ3(): void {
    z3Ctx = null;
}

