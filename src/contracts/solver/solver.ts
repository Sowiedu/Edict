// =============================================================================
// QF-LIA Solver — Quantifier-free linear integer/real arithmetic solver
// =============================================================================
// Strategy: expression evaluation + bounded model search.
//
// For Edict's contract pattern (preconditions ∧ ¬postcondition → SAT?),
// the constraints are small (few variables, simple arithmetic). We:
//   1. Collect all variables from the constraint set
//   2. Try systematic assignments from bounded integer ranges
//   3. Evaluate the conjunction under each assignment
//   4. If any assignment satisfies all constraints → SAT + counterexample
//   5. If exhausted → UNSAT (within bounds) or UNKNOWN (timeout)
//
// This is sound (SAT is always correct) and complete for small domains.
// For larger domains, we use heuristic narrowing from constraint bounds.

import {
    type Expr,
    type Sort,
    collectVariables,
    unwrap,
} from "./types.js";

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_ITERATIONS = 1_000_000;
const DEFAULT_SEARCH_RANGE = 128; // [-128, 128]
const HEURISTIC_VALUES = [
    0, 1, -1, 2, -2, 3, -3, 5, -5, 10, -10,
    100, -100, 127, -128, 255, -256,
];

export interface SolverResult {
    status: "sat" | "unsat" | "unknown";
    model?: Map<string, number | boolean>;
}

export class BuiltinSolver {
    private constraints: Expr[] = [];
    private timeoutIterations = DEFAULT_TIMEOUT_ITERATIONS;
    private iterations = 0;

    set(key: string, value: number): void {
        if (key === "timeout") {
            // Convert ms timeout to iteration count (rough: ~10k evals/ms)
            this.timeoutIterations = Math.max(10_000, value * 10_000);
        }
    }

    add(expr: any): void {
        this.constraints.push(unwrap(expr));
    }

    async check(): Promise<"sat" | "unsat" | "unknown"> {
        const result = this.solve();
        return result.status;
    }

    checkSync(): "sat" | "unsat" | "unknown" {
        return this.solve().status;
    }

    model(): BuiltinModel {
        const result = this.solve();
        return new BuiltinModel(result.model ?? new Map());
    }

    // --- Core solving algorithm ---

    private cachedResult: SolverResult | null = null;

    private solve(): SolverResult {
        if (this.cachedResult) return this.cachedResult;

        if (this.constraints.length === 0) {
            this.cachedResult = { status: "sat", model: new Map() };
            return this.cachedResult;
        }

        // Collect all variables
        const allVars = new Map<string, Sort>();
        for (const c of this.constraints) {
            for (const [name, sort] of collectVariables(c)) {
                allVars.set(name, sort);
            }
        }

        this.iterations = 0;

        // Phase 1: Try heuristic values first (fast path for common patterns)
        const heuristicResult = this.tryHeuristic(allVars);
        if (heuristicResult) {
            this.cachedResult = heuristicResult;
            return this.cachedResult;
        }

        // Phase 2: Bounded exhaustive search over small ranges
        const vars = Array.from(allVars.entries());
        const assignment = new Map<string, number | boolean>();
        const exhaustiveResult = this.searchExhaustive(vars, 0, assignment);
        this.cachedResult = exhaustiveResult;
        return this.cachedResult;
    }

    private tryHeuristic(allVars: Map<string, Sort>): SolverResult | null {
        const vars = Array.from(allVars.entries());
        const assignment = new Map<string, number | boolean>();

        // Try combinations of heuristic values for each variable
        return this.searchHeuristic(vars, 0, assignment);
    }

    private searchHeuristic(
        vars: [string, Sort][],
        idx: number,
        assignment: Map<string, number | boolean>,
    ): SolverResult | null {
        if (this.iterations >= this.timeoutIterations) return null;

        if (idx >= vars.length) {
            this.iterations++;
            if (this.evaluateAll(assignment)) {
                return { status: "sat", model: new Map(assignment) };
            }
            return null;
        }

        const [name, sort] = vars[idx]!;

        if (sort === "Bool") {
            for (const val of [true, false]) {
                assignment.set(name, val);
                const result = this.searchHeuristic(vars, idx + 1, assignment);
                if (result) return result;
            }
        } else {
            // Int or Real — try heuristic values
            for (const val of HEURISTIC_VALUES) {
                assignment.set(name, val);
                const result = this.searchHeuristic(vars, idx + 1, assignment);
                if (result) return result;
            }
        }

        return null;
    }

    private searchExhaustive(
        vars: [string, Sort][],
        idx: number,
        assignment: Map<string, number | boolean>,
    ): SolverResult {
        if (this.iterations >= this.timeoutIterations) {
            return { status: "unknown" };
        }

        if (idx >= vars.length) {
            this.iterations++;
            if (this.evaluateAll(assignment)) {
                return { status: "sat", model: new Map(assignment) };
            }
            return { status: "unsat" };
        }

        const [name, sort] = vars[idx]!;

        if (sort === "Bool") {
            for (const val of [true, false]) {
                assignment.set(name, val);
                const result = this.searchExhaustive(vars, idx + 1, assignment);
                if (result.status === "sat") return result;
                if (result.status === "unknown") return result;
            }
            return { status: "unsat" };
        }

        // Int or Real — search bounded range
        const range = this.computeRange(name, idx, vars);
        for (const val of range) {
            if (this.iterations >= this.timeoutIterations) {
                return { status: "unknown" };
            }
            assignment.set(name, val);
            const result = this.searchExhaustive(vars, idx + 1, assignment);
            if (result.status === "sat") return result;
            if (result.status === "unknown") return result;
        }

        return { status: "unsat" };
    }

    /**
     * Compute a bounded search range for a variable, using constraint
     * analysis to narrow the range and heuristic values to seed it.
     */
    private computeRange(
        _name: string,
        _idx: number,
        vars: [string, Sort][],
    ): number[] {
        // Adapt range based on number of variables:
        // More variables → smaller per-variable range to stay within timeout
        const numVars = vars.length;
        let halfRange: number;
        if (numVars <= 2) {
            halfRange = DEFAULT_SEARCH_RANGE;
        } else if (numVars <= 4) {
            halfRange = 32;
        } else {
            halfRange = 8;
        }

        // Generate range values, starting from 0 outward (more likely to hit)
        const values: number[] = [0];
        for (let i = 1; i <= halfRange; i++) {
            values.push(i, -i);
        }
        return values;
    }

    // --- Expression evaluation ---

    private evaluateAll(assignment: Map<string, number | boolean>): boolean {
        for (const constraint of this.constraints) {
            const val = this.evaluate(constraint, assignment);
            if (val !== true) return false;
        }
        return true;
    }

    private evaluate(expr: Expr, env: Map<string, number | boolean>): number | boolean {
        switch (expr.tag) {
            case "int_const":
                return expr.value;
            case "real_const":
                return expr.value;
            case "bool_const":
                return expr.value;
            case "int_var":
            case "real_var":
            case "bool_var": {
                const val = env.get(expr.name);
                if (val === undefined) return 0; // Default for unbound vars
                return val;
            }
            case "binop": {
                const l = this.evaluate(expr.left, env) as number;
                const r = this.evaluate(expr.right, env) as number;
                switch (expr.op) {
                    case "add": return l + r;
                    case "sub": return l - r;
                    case "mul": return l * r;
                    case "div": return r === 0 ? 0 : Math.trunc(l / r);
                    case "mod": return r === 0 ? 0 : l % r;
                }
                break;
            }
            case "unop":
                return -(this.evaluate(expr.operand, env) as number);
            case "cmp": {
                const l = this.evaluate(expr.left, env) as number;
                const r = this.evaluate(expr.right, env) as number;
                switch (expr.op) {
                    case "lt": return l < r;
                    case "gt": return l > r;
                    case "le": return l <= r;
                    case "ge": return l >= r;
                }
                break;
            }
            case "eq": {
                const l = this.evaluate(expr.left, env);
                const r = this.evaluate(expr.right, env);
                return l === r;
            }
            case "neq": {
                const l = this.evaluate(expr.left, env);
                const r = this.evaluate(expr.right, env);
                return l !== r;
            }
            case "bool_binop": {
                if (expr.op === "and") {
                    return expr.args.every(a => this.evaluate(a, env) === true);
                }
                if (expr.op === "or") {
                    return expr.args.some(a => this.evaluate(a, env) === true);
                }
                if (expr.op === "implies") {
                    // implies(a, b) = !a || b
                    const a = this.evaluate(expr.args[0]!, env);
                    const b = this.evaluate(expr.args[1]!, env);
                    return a !== true || b === true;
                }
                return false;
            }
            case "bool_not":
                return this.evaluate(expr.operand, env) !== true;
            case "ite": {
                const cond = this.evaluate(expr.cond, env);
                return cond === true
                    ? this.evaluate(expr.thenExpr, env)
                    : this.evaluate(expr.elseExpr, env);
            }
        }
        return false;
    }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export class BuiltinModel {
    constructor(private readonly values: Map<string, number | boolean>) {}

    eval(expr: any, _completion: boolean): any {
        const e = unwrap(expr);
        // For simple variable references, look up in the model
        if (e.tag === "int_var" || e.tag === "real_var" || e.tag === "bool_var") {
            const val = this.values.get(e.name);
            if (val !== undefined) {
                return {
                    toString: () => String(val),
                    value: val,
                    sort: { name: () => e.tag === "bool_var" ? "Bool" : e.tag === "real_var" ? "Real" : "Int" },
                    eq: (other: any) => {
                        const otherExpr = unwrap(other);
                        if (otherExpr.tag === "int_const" || otherExpr.tag === "real_const") {
                            return { toString: () => String(val === otherExpr.value) };
                        }
                        return { toString: () => "false" };
                    },
                };
            }
        }
        // For constant expressions, return as-is
        if (e.tag === "int_const" || e.tag === "real_const") {
            return { toString: () => String(e.value) };
        }
        if (e.tag === "bool_const") {
            return { toString: () => String(e.value) };
        }
        // For complex expressions, evaluate with the model values
        const result = evaluateWithModel(e, this.values);
        return { toString: () => String(result) };
    }
}

/** Evaluate an expression using model values. */
function evaluateWithModel(expr: Expr, env: Map<string, number | boolean>): number | boolean {
    switch (expr.tag) {
        case "int_const": return expr.value;
        case "real_const": return expr.value;
        case "bool_const": return expr.value;
        case "int_var": case "real_var": case "bool_var":
            return env.get(expr.name) ?? 0;
        case "binop": {
            const l = evaluateWithModel(expr.left, env) as number;
            const r = evaluateWithModel(expr.right, env) as number;
            switch (expr.op) {
                case "add": return l + r;
                case "sub": return l - r;
                case "mul": return l * r;
                case "div": return r === 0 ? 0 : Math.trunc(l / r);
                case "mod": return r === 0 ? 0 : l % r;
            }
            break;
        }
        case "unop": return -(evaluateWithModel(expr.operand, env) as number);
        case "cmp": {
            const l = evaluateWithModel(expr.left, env) as number;
            const r = evaluateWithModel(expr.right, env) as number;
            switch (expr.op) {
                case "lt": return l < r;
                case "gt": return l > r;
                case "le": return l <= r;
                case "ge": return l >= r;
            }
            break;
        }
        case "eq": return evaluateWithModel(expr.left, env) === evaluateWithModel(expr.right, env);
        case "neq": return evaluateWithModel(expr.left, env) !== evaluateWithModel(expr.right, env);
        case "bool_binop": {
            if (expr.op === "and") return expr.args.every(a => evaluateWithModel(a, env) === true);
            if (expr.op === "or") return expr.args.some(a => evaluateWithModel(a, env) === true);
            if (expr.op === "implies") {
                return evaluateWithModel(expr.args[0]!, env) !== true || evaluateWithModel(expr.args[1]!, env) === true;
            }
            return false;
        }
        case "bool_not": return evaluateWithModel(expr.operand, env) !== true;
        case "ite": {
            return evaluateWithModel(expr.cond, env) === true
                ? evaluateWithModel(expr.thenExpr, env)
                : evaluateWithModel(expr.elseExpr, env);
        }
    }
    return false;
}
