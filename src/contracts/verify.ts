// =============================================================================
// Edict Contract Verifier
// =============================================================================
// Verifies pre/post contracts on functions using Z3 SMT solver.
// For each postcondition, checks: preconditions ∧ ¬postcondition.
//   - unsat → proven ✓
//   - sat   → counterexample → ContractFailureError
//   - unknown → VerificationTimeoutError

import type { Context } from "z3-solver";
import type { EdictModule, FunctionDef, Contract, Expression } from "../ast/nodes.js";
import type { StructuredError } from "../errors/structured-errors.js";
import {
    contractFailure,
    verificationTimeout,
    undecidablePredicate,
    preconditionNotMet,
    analysisDiagnostic,
    type AnalysisDiagnostic,
} from "../errors/structured-errors.js";
import { getZ3 } from "./z3-context.js";
import {
    createParamVariables,
    translateExpr,
    translateExprList,
    type TranslationContext,
} from "./translate.js";

const TIMEOUT_MS = 5000;

type Z3Context = Context<"main">;

/**
 * Result of contract verification: errors (violations) + diagnostics (skipped checks).
 */
export interface ContractVerifyResult {
    errors: StructuredError[];
    diagnostics: AnalysisDiagnostic[];
}

/**
 * Verify all contracts in the module.
 * Returns errors and INFO-level diagnostics for skipped verifications.
 */
export async function contractVerify(
    module: EdictModule,
): Promise<ContractVerifyResult> {
    // Build function defs map (once)
    const functionDefs = new Map<string, FunctionDef>();
    const allFunctions: FunctionDef[] = [];
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            functionDefs.set(def.name, def);
            allFunctions.push(def);
        }
    }

    // Check if ANY function has contracts or call sites worth checking
    const fnsWithContracts = allFunctions.filter(fn => fn.contracts.length > 0);
    const hasPreconditions = fnsWithContracts.some(fn =>
        fn.contracts.some(c => c.kind === "pre"),
    );

    // No contracts at all → nothing to verify
    if (fnsWithContracts.length === 0 && !hasPreconditions) return { errors: [], diagnostics: [] };

    const ctx = await getZ3();
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Phase 1: Verify postconditions for functions with contracts
    for (const fn of fnsWithContracts) {
        const fnResult = await verifyFunction(ctx, fn, module);
        errors.push(...fnResult.errors);
        diagnostics.push(...fnResult.diagnostics);
    }

    // Phase 2: Verify callsite preconditions for ALL functions
    if (hasPreconditions) {
        for (const fn of allFunctions) {
            const csResult = await verifyCallSitePreconditions(ctx, fn, functionDefs, module);
            errors.push(...csResult.errors);
            diagnostics.push(...csResult.diagnostics);
        }
    }

    return { errors, diagnostics };
}

// ---------------------------------------------------------------------------
// Per-function verification
// ---------------------------------------------------------------------------

interface VerifyFunctionResult {
    errors: StructuredError[];
    diagnostics: AnalysisDiagnostic[];
}

async function verifyFunction(
    ctx: Z3Context,
    fn: FunctionDef,
    module: EdictModule,
): Promise<VerifyFunctionResult> {
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Create translation context
    const tctx: TranslationContext = {
        ctx,
        variables: new Map(),
        errors: [],
        module,
    };

    // Create Z3 variables for all parameters
    const allParamsSupported = createParamVariables(tctx, fn.params);

    if (!allParamsSupported) {
        // Can't verify functions with unsupported param types — report diagnostic
        diagnostics.push(analysisDiagnostic(
            "contract_skipped_unsupported_params",
            fn.name,
            fn.id,
            "contracts",
            fn.params.map(p => p.name).join(", "),
        ));
        return { errors, diagnostics };
    }

    // Translate body to bind `result` (supports multi-expression bodies)
    const firstContract = fn.contracts[0]!;
    const cachedBodyExpr = translateExprList(tctx, fn.body, firstContract.id, fn.name);
    if (cachedBodyExpr !== null) {
        // Create `result` variable with same sort as the body expression
        const sortName = cachedBodyExpr.sort.name();
        const resultVar = sortName === "Int"
            ? ctx.Int.const("result")
            : sortName === "Real"
                ? ctx.Real.const("result")
                : sortName === "Bool"
                    ? ctx.Bool.const("result")
                    : null;

        if (resultVar !== null) {
            tctx.variables.set("result", resultVar);
        }
    }
    // Clear translation errors from body translation (they're not contract errors)
    tctx.errors = [];

    // Separate contracts into preconditions and postconditions
    const preconds: Contract[] = [];
    const postconds: Contract[] = [];
    for (const c of fn.contracts) {
        if (c.kind === "pre") preconds.push(c);
        else postconds.push(c);
    }

    // If no postconditions, nothing to verify
    if (postconds.length === 0) return { errors, diagnostics };

    // Translate all preconditions
    const translatedPres: any[] = [];
    for (const pre of preconds) {
        const z3Pre = translateExpr(tctx, pre.condition, pre.id, fn.name);
        if (z3Pre === null) {
            // Can't translate precondition — all postconditions become undecidable
            for (const post of postconds) {
                errors.push(undecidablePredicate(fn.id, post.id, fn.name, "untranslatable_precondition"));
            }
            flushTranslationErrors(tctx, fn.id, errors);
            return errors;
        }
        translatedPres.push(z3Pre);
    }

    // Create result binding (result == body) using cached body translation
    let resultBinding: any | null = null;
    if (cachedBodyExpr !== null && tctx.variables.has("result")) {
        resultBinding = tctx.variables.get("result")!.eq(cachedBodyExpr);
    }

    // Verify each postcondition
    for (const post of postconds) {
        const z3Post = translateExpr(tctx, post.condition, post.id, fn.name);
        if (z3Post === null) {
            // Flush errors for this contract
            const relevantErrors = tctx.errors.filter(e => e.contractId === post.id);
            for (const te of relevantErrors) {
                errors.push(undecidablePredicate(fn.id, te.contractId, fn.name, te.unsupportedNodeKind));
            }
            tctx.errors = tctx.errors.filter(e => e.contractId !== post.id);
            continue;
        }

        // Create a fresh solver for each postcondition
        const solver = new ctx.Solver();
        solver.set("timeout", TIMEOUT_MS);

        // Assert preconditions
        for (const pre of translatedPres) {
            solver.add(pre);
        }

        // Assert result binding if available
        if (resultBinding !== null) {
            solver.add(resultBinding);
        }

        // Assert negation of postcondition (must be Bool sort)
        try {
            solver.add(ctx.Not(z3Post as any as ReturnType<Z3Context["Bool"]["val"]>));
        } catch {
            // z3Post is not a Bool — postcondition is non-boolean → undecidable
            errors.push(undecidablePredicate(fn.id, post.id, fn.name, "non_boolean_postcondition"));
            continue;
        }

        // Check
        const result = await solver.check();

        if (result === "sat") {
            // Postcondition violated — extract counterexample
            const model = solver.model();
            const counterexample: Record<string, unknown> = {};

            for (const p of fn.params) {
                const v = tctx.variables.get(p.name);
                if (v) {
                    try {
                        const val = model.eval(v, true);
                        counterexample[p.name] = val.toString();
                    } catch {
                        counterexample[p.name] = "?";
                    }
                }
            }

            errors.push(contractFailure(fn.id, post.id, fn.name, "post", counterexample));
        } else if (result === "unknown") {
            errors.push(verificationTimeout(fn.id, post.id, fn.name, TIMEOUT_MS));
        }
        // result === "unsat" → proven, no error
    }

    // Flush any remaining translation errors
    flushTranslationErrors(tctx, fn.id, errors);

    return { errors, diagnostics };
}

// ---------------------------------------------------------------------------
// Callsite Precondition Checking
// ---------------------------------------------------------------------------

interface CallSiteInfo {
    calleeName: string;
    callSiteId: string;
    args: Expression[];
    /** Path conditions from enclosing if branches that are known true at this call site */
    pathConditions: Expression[];
}

/**
 * Collect all ident-based call sites from an expression list.
 * Returns callee name, call-site node id, and argument expressions.
 */
function collectCallSites(exprs: Expression[]): CallSiteInfo[] {
    const sites: CallSiteInfo[] = [];

    function walk(expr: Expression, conditions: Expression[]): void {
        switch (expr.kind) {
            case "call":
                for (const arg of expr.args) walk(arg, conditions);
                if (expr.fn.kind === "ident") {
                    sites.push({
                        calleeName: expr.fn.name,
                        callSiteId: expr.id,
                        args: expr.args,
                        pathConditions: [...conditions],
                    });
                } else {
                    walk(expr.fn, conditions);
                }
                break;
            case "if": {
                // Calls in the condition itself don't gain branch info
                walk(expr.condition, conditions);
                // then branch: condition is true
                const thenConds = [...conditions, expr.condition];
                for (const e of expr.then) walk(e, thenConds);
                // else branch: condition is false (synthesize not)
                if (expr.else) {
                    const elseConds = [...conditions, {
                        kind: "unop" as const,
                        id: "synth-not",
                        op: "not" as const,
                        operand: expr.condition,
                    } satisfies Expression & { kind: "unop" }];
                    for (const e of expr.else) walk(e, elseConds);
                }
                break;
            }
            case "let":
                walk(expr.value, conditions);
                break;
            case "match":
                walk(expr.target, conditions);
                for (const arm of expr.arms) for (const e of arm.body) walk(e, conditions);
                break;
            case "block":
                for (const e of expr.body) walk(e, conditions);
                break;
            case "binop":
                walk(expr.left, conditions);
                walk(expr.right, conditions);
                break;
            case "unop":
                walk(expr.operand, conditions);
                break;
            case "array":
            case "tuple_expr":
                for (const e of expr.elements) walk(e, conditions);
                break;
            case "record_expr":
            case "enum_constructor":
                for (const f of expr.fields) walk(f.value, conditions);
                break;
            case "access":
                walk(expr.target, conditions);
                break;
            case "lambda":
            case "literal":
            case "ident":
                break;
        }
    }

    for (const expr of exprs) walk(expr, []);
    return sites;
}

/**
 * Verify that a function's call sites satisfy callee preconditions.
 * For each call f(...args) where f has preconditions, check that
 * the caller's context (params + own preconditions) implies each
 * callee precondition with args substituted for params.
 */
async function verifyCallSitePreconditions(
    ctx: Z3Context,
    callerFn: FunctionDef,
    functionDefs: Map<string, FunctionDef>,
    module: EdictModule,
): Promise<VerifyFunctionResult> {
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Find all call sites in the caller's body
    const callSites = collectCallSites(callerFn.body);
    if (callSites.length === 0) return { errors, diagnostics };

    // Filter to calls with preconditions (self-recursive calls now supported via path conditions)
    const relevantSites = callSites.filter(site => {
        const callee = functionDefs.get(site.calleeName);
        return callee && callee.contracts.some(c => c.kind === "pre");
    });
    if (relevantSites.length === 0) return { errors, diagnostics };

    // Create translation context for the caller
    const tctx: TranslationContext = {
        ctx,
        variables: new Map(),
        errors: [],
        module,
    };

    // Create Z3 variables for caller's params
    const allParamsSupported = createParamVariables(tctx, callerFn.params);
    if (!allParamsSupported) {
        diagnostics.push(analysisDiagnostic(
            "contract_skipped_unsupported_params",
            callerFn.name,
            callerFn.id,
            "contracts",
            callerFn.params.map(p => p.name).join(", "),
        ));
        return { errors, diagnostics };
    }

    // Translate caller's preconditions (assumptions)
    const callerPres: any[] = [];
    for (const c of callerFn.contracts) {
        if (c.kind === "pre") {
            const z3Pre = translateExpr(tctx, c.condition, c.id, callerFn.name);
            if (z3Pre !== null) callerPres.push(z3Pre);
        }
    }
    tctx.errors = []; // Clear any translation errors from precond translation

    // Check each relevant call site
    for (const site of relevantSites) {
        const callee = functionDefs.get(site.calleeName)!;
        const calleePres = callee.contracts.filter(c => c.kind === "pre");

        // Translate call-site arguments in caller's context
        const translatedArgs: any[] = [];
        let argsOk = true;
        for (const arg of site.args) {
            const z3Arg = translateExpr(tctx, arg, "callsite", callerFn.name);
            if (z3Arg === null) {
                argsOk = false;
                break;
            }
            translatedArgs.push(z3Arg);
        }
        tctx.errors = []; // Clear arg translation errors
        if (!argsOk) continue;

        // Arity check
        if (translatedArgs.length !== callee.params.length) continue;

        // For each callee precondition, verify caller satisfies it
        for (const pre of calleePres) {
            // Save variable state
            const savedVars = new Map(tctx.variables);

            // Substitute callee params with translated args
            for (let i = 0; i < callee.params.length; i++) {
                tctx.variables.set(callee.params[i]!.name, translatedArgs[i]);
            }

            // Translate the precondition with substitutions active
            const z3Pre = translateExpr(tctx, pre.condition, pre.id, callerFn.name);

            // Restore variables
            tctx.variables = savedVars;
            tctx.errors = [];

            if (z3Pre === null) continue; // Can't verify this precondition

            // Check: caller_preconds ∧ path_conditions ∧ ¬P[args/params]
            const solver = new ctx.Solver();
            solver.set("timeout", TIMEOUT_MS);

            for (const cp of callerPres) solver.add(cp);

            // Assert path conditions from enclosing if branches
            for (const pathCond of site.pathConditions) {
                const z3PathCond = translateExpr(tctx, pathCond, "callsite", callerFn.name);
                tctx.errors = []; // Clear translation errors
                if (z3PathCond !== null) {
                    try {
                        solver.add(z3PathCond as any);
                    } catch {
                        // Non-boolean path condition — skip
                    }
                }
            }

            try {
                solver.add(ctx.Not(z3Pre as any as ReturnType<Z3Context["Bool"]["val"]>));
            } catch {
                // z3Pre is not a Bool — can't verify this precondition
                continue;
            }

            const result = await solver.check();

            if (result === "sat") {
                const model = solver.model();
                const counterexample: Record<string, unknown> = {};

                for (const p of callerFn.params) {
                    const v = tctx.variables.get(p.name);
                    if (v) {
                        try {
                            const val = model.eval(v, true);
                            counterexample[p.name] = val.toString();
                        } catch {
                            counterexample[p.name] = "?";
                        }
                    }
                }

                errors.push(preconditionNotMet(
                    callerFn.id,
                    site.callSiteId,
                    callerFn.name,
                    site.calleeName,
                    pre.id,
                    counterexample,
                ));
            } else if (result === "unknown") {
                errors.push(verificationTimeout(
                    callerFn.id, pre.id, callerFn.name, TIMEOUT_MS,
                ));
            }
            // "unsat" → proven ✔
        }
    }

    return { errors, diagnostics };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushTranslationErrors(
    tctx: TranslationContext,
    nodeId: string,
    errors: StructuredError[],
): void {
    for (const te of tctx.errors) {
        errors.push(undecidablePredicate(nodeId, te.contractId, te.functionName, te.unsupportedNodeKind));
    }
    tctx.errors = [];
}
