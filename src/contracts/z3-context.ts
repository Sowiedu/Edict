// =============================================================================
// Z3 Context — Lazy singleton for Z3 WASM initialization + context
// =============================================================================

import { init, type Context } from "z3-solver";

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

/** Reset the Z3 context (used by tests). */
export function resetZ3(): void {
    z3Ctx = null;
}
