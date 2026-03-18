// =============================================================================
// Solver Context — Abstract interface for SMT solvers
// =============================================================================
// Decouples the contract verification pipeline from Z3. Both the Z3 adapter
// and the built-in QF-LIA solver implement this interface.
//
// Design: expressions are typed as `any` because:
// 1. The existing contract pipeline (translate.ts, verify.ts) uses `any` throughout
// 2. Z3's expression types (Arith, Bool) are not structurally compatible with
//    custom types — they have implementation-specific properties
// 3. Each solver implementation has its own internal strong typing
//
// The SolverContext is the factory boundary — what goes IN (names, numbers)
// and what comes OUT (solver results) are typed. Expressions in between are opaque.

// ---------------------------------------------------------------------------
// Sort factories
// ---------------------------------------------------------------------------

/** Factory for creating integer constants and values. */
export interface IntSortFactory {
    const(name: string): any;
    val(n: number): any;
    sort(): any;
}

/** Factory for creating boolean constants and values. */
export interface BoolSortFactory {
    const(name: string): any;
    val(v: boolean): any;
}

/** Factory for creating real constants and values. */
export interface RealSortFactory {
    const(name: string): any;
    val(n: number): any;
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/** SMT solver instance. */
export interface SmtSolver {
    /** Set solver option (e.g., timeout). */
    set(key: string, value: number): void;

    /** Add a constraint. */
    add(expr: any): void;

    /** Check satisfiability. */
    check(): Promise<"sat" | "unsat" | "unknown">;

    /** Synchronous check — only available on the built-in solver. */
    checkSync?(): "sat" | "unsat" | "unknown";

    /** Get model (only valid after check() returns "sat"). */
    model(): SmtModel;
}

/** Model from a satisfying assignment. */
export interface SmtModel {
    /** Evaluate an expression in the model. */
    eval(expr: any, completion: boolean): any;
}

// ---------------------------------------------------------------------------
// Solver Context (the main interface)
// ---------------------------------------------------------------------------

/**
 * Abstract SMT solver context.
 *
 * Provides factories for creating expressions and solvers.
 * Both the Z3 adapter and the built-in QF-LIA solver implement this.
 *
 * Optional members (ForAll, Exists, Array, Function) are only implemented
 * by the Z3 adapter for semantic assertion support. The built-in solver
 * omits them — translate-semantic.ts checks for their presence.
 */
export interface SolverContext {
    // Sort factories
    readonly Int: IntSortFactory;
    readonly Bool: BoolSortFactory;
    readonly Real: RealSortFactory;

    // Boolean operations
    And(...args: any[]): any;
    Or(...args: any[]): any;
    Not(expr: any): any;
    Implies(a: any, b: any): any;
    If(cond: any, thenExpr: any, elseExpr: any): any;

    // Solver factory — used as `new ctx.Solver()` to match Z3's API
    Solver: { new(): SmtSolver };

    // --- Optional: Z3-only features for semantic assertions ---

    /** Quantifier: ∀ vars. body (Z3 only). */
    ForAll?(vars: any[], body: any): any;

    /** Quantifier: ∃ vars. body (Z3 only). */
    Exists?(vars: any[], body: any): any;

    /** Array sort factory (Z3 only). */
    readonly Array?: {
        const(name: string, keySort: any, valueSort: any): any;
    };

    /** Uninterpreted function factory (Z3 only). */
    readonly Function?: {
        declare(name: string, ...sorts: any[]): any;
    };
}
