// =============================================================================
// Edict Contract Verifier
// =============================================================================
// Verifies pre/post contracts on functions using Z3 SMT solver.
// For each postcondition, checks: preconditions ∧ ¬postcondition.
//   - unsat → proven ✓
//   - sat   → counterexample → ContractFailureError
//   - unknown → VerificationTimeoutError
//
// Worker thread offloading (Phase 2):
// Cache lookup happens on the main thread. Uncached verifications are
// dispatched to a worker thread so the MCP server stays responsive.


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
import { walkExpression } from "../ast/walk.js";
import {
    createParamVariables,
    translateExpr,
    translateExprList,
    type TranslationContext,
} from "./translate.js";
import { translateSemanticAssertion } from "./translate-semantic.js";
import { computeVerificationHash } from "./hash.js";
import type { SolverContext } from "./solver-context.js";
import { Worker } from "node:worker_threads";

const TIMEOUT_MS = 5000;
const WORKER_TIMEOUT_MS = 30_000;

/**
 * Result of contract verification: errors (violations) + diagnostics (skipped checks).
 */
export interface ContractVerifyResult {
    errors: StructuredError[];
    diagnostics: AnalysisDiagnostic[];
    /** Cache hit/miss statistics for this verification run. */
    cacheStats?: { hits: number; misses: number };
}

/** Options for contractVerify. */
export interface ContractVerifyOptions {
    /**
     * When true (default), uncached verifications run in a worker thread
     * to keep the main event loop responsive. Set to false for tests
     * that need to avoid worker overhead or test verification logic directly.
     */
    useWorker?: boolean;
}

// ---------------------------------------------------------------------------
// Verification Cache
// ---------------------------------------------------------------------------

interface CachedResult {
    errors: StructuredError[];
    diagnostics: AnalysisDiagnostic[];
}

const verificationCache = new Map<string, CachedResult>();

/** Clear the verification cache. Used by tests for isolation. */
export function clearVerificationCache(): void {
    verificationCache.clear();
}

/**
 * Verify all pre/post contracts in the module using Z3 SMT solver.
 *
 * For each postcondition, checks: `preconditions ∧ ¬postcondition`.
 * Results: unsat → proven, sat → counterexample error, unknown → timeout error.
 * Caches proven results per-function. Uncached verifications run in a worker thread
 * by default to keep the MCP server responsive.
 *
 * @param module - A validated, resolved, type-checked, and effect-checked Edict module
 * @param options - Optional: `{ useWorker?: boolean }` — set `false` for tests
 * @returns `{ errors, diagnostics, cacheStats }` — contract violations, skipped-check diagnostics, and cache statistics
 */
export async function contractVerify(
    module: EdictModule,
    options: ContractVerifyOptions = {},
): Promise<ContractVerifyResult> {
    const useWorker = options.useWorker ?? true;
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

    // Build dependency map: for each function, which callee FunctionDefs have preconditions?
    const calleeDepsWithPre = new Map<string, Map<string, FunctionDef>>();
    for (const fn of allFunctions) {
        const deps = new Map<string, FunctionDef>();
        collectCalleeDeps(fn.body, functionDefs, deps);
        if (deps.size > 0) calleeDepsWithPre.set(fn.name, deps);
    }

    let cacheHits = 0;
    let cacheMisses = 0;

    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Collect per-function cache status
    type UncachedWork = { fn: FunctionDef; hash: string; phase: "post" | "callsite" };
    const uncachedWork: UncachedWork[] = [];

    // Phase 1: Check postcondition cache for functions with contracts
    for (const fn of fnsWithContracts) {
        const deps = calleeDepsWithPre.get(fn.name) ?? new Map();
        const hash = "post:" + computeVerificationHash(fn, deps);
        const cached = verificationCache.get(hash);
        if (cached) {
            cacheHits++;
            errors.push(...cached.errors);
            diagnostics.push(...cached.diagnostics);
        } else {
            cacheMisses++;
            uncachedWork.push({ fn, hash, phase: "post" });
        }
    }

    // Phase 2: Check callsite precondition cache for ALL functions
    if (hasPreconditions) {
        for (const fn of allFunctions) {
            const deps = calleeDepsWithPre.get(fn.name) ?? new Map();
            const hash = "cs:" + computeVerificationHash(fn, deps);
            const cached = verificationCache.get(hash);
            if (cached) {
                cacheHits++;
                errors.push(...cached.errors);
                diagnostics.push(...cached.diagnostics);
            } else {
                cacheMisses++;
                uncachedWork.push({ fn, hash, phase: "callsite" });
            }
        }
    }

    // If everything was cached, return immediately (no worker needed)
    if (uncachedWork.length === 0) {
        return { errors, diagnostics, cacheStats: { hits: cacheHits, misses: cacheMisses } };
    }

    // Run uncached verifications — either in worker or directly
    let freshResults: VerifyFunctionResult;
    if (useWorker) {
        freshResults = await verifyInWorker(module, uncachedWork);
    } else {
        freshResults = await verifyDirect(module, uncachedWork);
    }

    // Map fresh results back to cache entries
    // We send the whole module to the worker, so we need to re-hash to
    // match up worker results. Since the worker verifies everything, we
    // store results per-function from the batch.
    // For simplicity, the worker returns flat errors/diagnostics — we
    // merge them and cache the per-function results via a second pass.
    errors.push(...freshResults.errors);
    diagnostics.push(...freshResults.diagnostics);

    // Cache proven results: for each uncached function, if the fresh results
    // contain no errors for that function, cache it as proven.
    // Error types use different field names: contract_failure/verification_timeout
    // use `functionName`, while precondition_not_met uses `callerName`.
    for (const work of uncachedWork) {
        const fnName = work.fn.name;
        const fnErrors = freshResults.errors.filter(e => {
            const rec = e as unknown as Record<string, unknown>;
            if ("functionName" in rec && rec.functionName === fnName) return true;
            if ("callerName" in rec && rec.callerName === fnName) return true;
            return false;
        });
        const fnDiags = freshResults.diagnostics.filter(d =>
            d.functionName === fnName,
        );
        if (fnErrors.length === 0) {
            verificationCache.set(work.hash, { errors: [], diagnostics: [...fnDiags] });
        }
    }

    return { errors, diagnostics, cacheStats: { hits: cacheHits, misses: cacheMisses } };
}

/**
 * Run verifications directly on the current thread (no worker).
 * Used when useWorker is false, or as fallback.
 */
async function verifyDirect(
    module: EdictModule,
    uncachedWork: { fn: FunctionDef; hash: string; phase: "post" | "callsite" }[],
): Promise<VerifyFunctionResult> {
    const ctx = await getZ3();
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Build function defs map for callsite verification
    const functionDefs = new Map<string, FunctionDef>();
    for (const def of module.definitions) {
        if (def.kind === "fn") functionDefs.set(def.name, def);
    }

    for (const work of uncachedWork) {
        if (work.phase === "post") {
            const result = await verifyFunction(ctx, work.fn, module);
            errors.push(...result.errors);
            diagnostics.push(...result.diagnostics);
        } else {
            const result = await verifyCallSitePreconditions(ctx, work.fn, functionDefs, module);
            errors.push(...result.errors);
            diagnostics.push(...result.diagnostics);
        }
    }

    return { errors, diagnostics };
}

/**
 * Run contract verification in a worker thread.
 * The worker initialises its own Z3 context and runs only the
 * uncached verifications. Returns serializable results.
 */
async function verifyInWorker(
    module: EdictModule,
    uncachedWork: { fn: FunctionDef; hash: string; phase: "post" | "callsite" }[],
): Promise<VerifyFunctionResult> {
    const verifyModuleUrl = import.meta.url;

    // Serialize the uncached work items: fn names + phases
    // (the full FunctionDef is already in the module)
    const workItems = uncachedWork.map(w => ({
        fnName: w.fn.name,
        phase: w.phase,
    }));

    return new Promise<VerifyFunctionResult>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const workerScript = `
            import { workerData, parentPort } from "node:worker_threads";

            const url = workerData.verifyModuleUrl;

            // In dev/vitest (.ts files), register tsx ESM loader
            if (url.endsWith(".ts")) {
                const { register } = await import("tsx/esm/api");
                register();
            }

            try {
                const mod = await import(url);
                const result = await mod.contractVerifyWorkerEntry(
                    workerData.module,
                    workerData.workItems,
                );
                parentPort.postMessage({ type: "result", data: result });
            } catch (e) {
                parentPort.postMessage({
                    type: "error",
                    message: e instanceof Error ? e.message : String(e),
                });
            }
        `;

        // Only register tsx ESM loader when running from TypeScript source (dev/vitest).
        // In production (.js), tsx is not needed and may not be installed.
        const isDevMode = verifyModuleUrl.endsWith(".ts");

        const worker = new Worker(workerScript, {
            eval: true,
            workerData: { module, verifyModuleUrl, workItems },
            ...(isDevMode ? { execArgv: ["--import", "tsx"] } : {}),
        });

        function settle(result: VerifyFunctionResult): void {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(result);
        }

        // Timeout — kill the worker
        timer = setTimeout(() => {
            worker.terminate().then(() => {
                // Return timeout errors for all pending work
                settle({
                    errors: [verificationTimeout("worker", "worker", "<worker>", WORKER_TIMEOUT_MS)],
                    diagnostics: [],
                });
            });
        }, WORKER_TIMEOUT_MS);

        worker.on("message", (msg: { type: string; data?: VerifyFunctionResult; message?: string }) => {
            if (msg.type === "result" && msg.data) {
                settle(msg.data);
            } else if (msg.type === "error") {
                settle({
                    errors: [],
                    diagnostics: [],
                });
            }
        });

        worker.on("error", () => {
            settle({ errors: [], diagnostics: [] });
        });

        worker.on("exit", (code) => {
            if (code !== 0) {
                settle({ errors: [], diagnostics: [] });
            }
        });
    });
}

/**
 * Worker entry point — called from the inline worker script.
 * Receives the module and a list of work items specifying which
 * functions to verify and which phase (post or callsite).
 * Exported so the worker can import and call it.
 */
export async function contractVerifyWorkerEntry(
    module: EdictModule,
    workItems: { fnName: string; phase: "post" | "callsite" }[],
): Promise<VerifyFunctionResult> {
    const ctx = await getZ3();
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Build function defs map
    const functionDefs = new Map<string, FunctionDef>();
    for (const def of module.definitions) {
        if (def.kind === "fn") functionDefs.set(def.name, def);
    }

    for (const item of workItems) {
        const fn = functionDefs.get(item.fnName);
        if (!fn) continue;

        if (item.phase === "post") {
            const result = await verifyFunction(ctx, fn, module);
            errors.push(...result.errors);
            diagnostics.push(...result.diagnostics);
        } else {
            const result = await verifyCallSitePreconditions(ctx, fn, functionDefs, module);
            errors.push(...result.errors);
            diagnostics.push(...result.diagnostics);
        }
    }

    return { errors, diagnostics };
}

/**
 * Collect callee FunctionDefs that have preconditions, from an expression list.
 */
function collectCalleeDeps(
    exprs: Expression[],
    functionDefs: Map<string, FunctionDef>,
    out: Map<string, FunctionDef>,
): void {
    for (const expr of exprs) walkForDeps(expr, functionDefs, out);
}

function walkForDeps(
    expr: Expression,
    functionDefs: Map<string, FunctionDef>,
    out: Map<string, FunctionDef>,
): void {
    walkExpression(expr, {
        enter(node) {
            if (node.kind === "call" && node.fn.kind === "ident") {
                const callee = functionDefs.get(node.fn.name);
                if (callee && callee.contracts.some(c => c.kind === "pre") && !out.has(node.fn.name)) {
                    out.set(node.fn.name, callee);
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Per-function verification
// ---------------------------------------------------------------------------

interface VerifyFunctionResult {
    errors: StructuredError[];
    diagnostics: AnalysisDiagnostic[];
}

/**
 * Verify all contracts for a single function using Z3.
 *
 * For each postcondition: translates preconditions + body + negated postcondition
 * into Z3 constraints. If unsatisfiable → proven; if satisfiable → counterexample.
 *
 * @param ctx - Z3 context instance
 * @param fn - The function definition whose contracts to verify
 * @param module - The containing module (needed for callsite precondition analysis)
 * @returns `{ errors, diagnostics }` — contract violation errors and skipped-check diagnostics
 */
export async function verifyFunction(
    ctx: SolverContext,
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
        if (!pre.condition) continue; // semantic assertions are postcondition-only
        const z3Pre = translateExpr(tctx, pre.condition, pre.id, fn.name);
        if (z3Pre === null) {
            // Can't translate precondition — all postconditions become undecidable
            for (const post of postconds) {
                errors.push(undecidablePredicate(fn.id, post.id, fn.name, "untranslatable_precondition"));
            }
            flushTranslationErrors(tctx, fn.id, errors);
            return { errors, diagnostics };
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
        // Translate: either semantic assertion or manual condition
        let z3Post: any | null = null;
        if (post.semantic) {
            z3Post = translateSemanticAssertion(tctx, post.semantic);
        } else if (post.condition) {
            z3Post = translateExpr(tctx, post.condition, post.id, fn.name);
        }
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
            solver.add(ctx.Not(z3Post as unknown as ReturnType<SolverContext["Bool"]["val"]>));
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

            errors.push(contractFailure(fn.id, post.id, fn.name, "post", counterexample, post.semantic?.assertion));
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
            case "forall":
            case "exists":
                walk(expr.range.from, conditions);
                walk(expr.range.to, conditions);
                walk(expr.body, conditions);
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
export async function verifyCallSitePreconditions(
    ctx: SolverContext,
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
        if (c.kind === "pre" && c.condition) {
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
            if (!pre.condition) continue; // semantic assertions not used in preconditions
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
                        solver.add(z3PathCond as unknown as ReturnType<SolverContext["Bool"]["val"]>);
                    } catch {
                        // Non-boolean path condition — skip
                    }
                }
            }

            try {
                solver.add(ctx.Not(z3Pre as unknown as ReturnType<SolverContext["Bool"]["val"]>));
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
// Synchronous Contract Verification (built-in solver only)
// ---------------------------------------------------------------------------
// Used by the QuickJS self-hosted bundle where async/await is unavailable.
// Calls solver.checkSync!() instead of await solver.check(). No caching
// or worker threads — QuickJS runs single-shot evaluations.

/**
 * Synchronous contract verification using a solver with checkSync() support.
 *
 * Same semantics as contractVerify() but fully synchronous — designed for
 * environments like QuickJS where async/await is unavailable.
 *
 * @param module - A validated, resolved, type-checked, and effect-checked Edict module
 * @param ctx - A SolverContext whose Solver implements checkSync()
 * @returns `{ errors, diagnostics }` — contract violations and skipped-check diagnostics
 */
export function contractVerifySync(
    module: EdictModule,
    ctx: SolverContext,
): ContractVerifyResult {
    const functionDefs = new Map<string, FunctionDef>();
    const allFunctions: FunctionDef[] = [];
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            functionDefs.set(def.name, def);
            allFunctions.push(def);
        }
    }

    const fnsWithContracts = allFunctions.filter(fn => fn.contracts.length > 0);
    const hasPreconditions = fnsWithContracts.some(fn =>
        fn.contracts.some(c => c.kind === "pre"),
    );

    if (fnsWithContracts.length === 0 && !hasPreconditions) {
        return { errors: [], diagnostics: [] };
    }

    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    // Verify postconditions
    for (const fn of fnsWithContracts) {
        const result = verifyFunctionSync(ctx, fn, module);
        errors.push(...result.errors);
        diagnostics.push(...result.diagnostics);
    }

    // Verify callsite preconditions
    if (hasPreconditions) {
        for (const fn of allFunctions) {
            const result = verifyCallSitePreconditionsSync(ctx, fn, functionDefs, module);
            errors.push(...result.errors);
            diagnostics.push(...result.diagnostics);
        }
    }

    return { errors, diagnostics };
}

/**
 * Synchronous version of verifyFunction — uses solver.checkSync!().
 */
function verifyFunctionSync(
    ctx: SolverContext,
    fn: FunctionDef,
    module: EdictModule,
): VerifyFunctionResult {
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    const tctx: TranslationContext = {
        ctx, variables: new Map(), errors: [], module,
    };

    const allParamsSupported = createParamVariables(tctx, fn.params);
    if (!allParamsSupported) {
        diagnostics.push(analysisDiagnostic(
            "contract_skipped_unsupported_params", fn.name, fn.id, "contracts",
            fn.params.map(p => p.name).join(", "),
        ));
        return { errors, diagnostics };
    }

    const firstContract = fn.contracts[0]!;
    const cachedBodyExpr = translateExprList(tctx, fn.body, firstContract.id, fn.name);
    if (cachedBodyExpr !== null) {
        const sortName = cachedBodyExpr.sort.name();
        const resultVar = sortName === "Int"
            ? ctx.Int.const("result")
            : sortName === "Real"
                ? ctx.Real.const("result")
                : sortName === "Bool"
                    ? ctx.Bool.const("result")
                    : null;
        if (resultVar !== null) tctx.variables.set("result", resultVar);
    }
    tctx.errors = [];

    const preconds: Contract[] = [];
    const postconds: Contract[] = [];
    for (const c of fn.contracts) {
        if (c.kind === "pre") preconds.push(c);
        else postconds.push(c);
    }

    if (postconds.length === 0) return { errors, diagnostics };

    const translatedPres: any[] = [];
    for (const pre of preconds) {
        if (!pre.condition) continue;
        const z3Pre = translateExpr(tctx, pre.condition, pre.id, fn.name);
        if (z3Pre === null) {
            for (const post of postconds) {
                errors.push(undecidablePredicate(fn.id, post.id, fn.name, "untranslatable_precondition"));
            }
            flushTranslationErrors(tctx, fn.id, errors);
            return { errors, diagnostics };
        }
        translatedPres.push(z3Pre);
    }

    let resultBinding: any | null = null;
    if (cachedBodyExpr !== null && tctx.variables.has("result")) {
        resultBinding = tctx.variables.get("result")!.eq(cachedBodyExpr);
    }

    for (const post of postconds) {
        let z3Post: any | null = null;
        if (post.semantic) {
            z3Post = translateSemanticAssertion(tctx, post.semantic);
        } else if (post.condition) {
            z3Post = translateExpr(tctx, post.condition, post.id, fn.name);
        }
        if (z3Post === null) {
            const relevantErrors = tctx.errors.filter(e => e.contractId === post.id);
            for (const te of relevantErrors) {
                errors.push(undecidablePredicate(fn.id, te.contractId, fn.name, te.unsupportedNodeKind));
            }
            tctx.errors = tctx.errors.filter(e => e.contractId !== post.id);
            continue;
        }

        const solver = new ctx.Solver();
        solver.set("timeout", TIMEOUT_MS);

        for (const pre of translatedPres) solver.add(pre);
        if (resultBinding !== null) solver.add(resultBinding);

        try {
            solver.add(ctx.Not(z3Post as unknown as ReturnType<SolverContext["Bool"]["val"]>));
        } catch {
            errors.push(undecidablePredicate(fn.id, post.id, fn.name, "non_boolean_postcondition"));
            continue;
        }

        const result = solver.checkSync!();

        if (result === "sat") {
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
            errors.push(contractFailure(fn.id, post.id, fn.name, "post", counterexample, post.semantic?.assertion));
        } else if (result === "unknown") {
            errors.push(verificationTimeout(fn.id, post.id, fn.name, TIMEOUT_MS));
        }
    }

    flushTranslationErrors(tctx, fn.id, errors);
    return { errors, diagnostics };
}

/**
 * Synchronous version of verifyCallSitePreconditions — uses solver.checkSync!().
 */
function verifyCallSitePreconditionsSync(
    ctx: SolverContext,
    callerFn: FunctionDef,
    functionDefs: Map<string, FunctionDef>,
    module: EdictModule,
): VerifyFunctionResult {
    const errors: StructuredError[] = [];
    const diagnostics: AnalysisDiagnostic[] = [];

    const callSites = collectCallSites(callerFn.body);
    if (callSites.length === 0) return { errors, diagnostics };

    const relevantSites = callSites.filter(site => {
        const callee = functionDefs.get(site.calleeName);
        return callee && callee.contracts.some(c => c.kind === "pre");
    });
    if (relevantSites.length === 0) return { errors, diagnostics };

    const tctx: TranslationContext = {
        ctx, variables: new Map(), errors: [], module,
    };

    const allParamsSupported = createParamVariables(tctx, callerFn.params);
    if (!allParamsSupported) {
        diagnostics.push(analysisDiagnostic(
            "contract_skipped_unsupported_params", callerFn.name, callerFn.id, "contracts",
            callerFn.params.map(p => p.name).join(", "),
        ));
        return { errors, diagnostics };
    }

    const callerPres: any[] = [];
    for (const c of callerFn.contracts) {
        if (c.kind === "pre" && c.condition) {
            const z3Pre = translateExpr(tctx, c.condition, c.id, callerFn.name);
            if (z3Pre !== null) callerPres.push(z3Pre);
        }
    }
    tctx.errors = [];

    for (const site of relevantSites) {
        const callee = functionDefs.get(site.calleeName)!;
        const calleePres = callee.contracts.filter(c => c.kind === "pre");

        const translatedArgs: any[] = [];
        let argsOk = true;
        for (const arg of site.args) {
            const z3Arg = translateExpr(tctx, arg, "callsite", callerFn.name);
            if (z3Arg === null) { argsOk = false; break; }
            translatedArgs.push(z3Arg);
        }
        tctx.errors = [];
        if (!argsOk) continue;

        if (translatedArgs.length !== callee.params.length) continue;

        for (const pre of calleePres) {
            const savedVars = new Map(tctx.variables);

            for (let i = 0; i < callee.params.length; i++) {
                tctx.variables.set(callee.params[i]!.name, translatedArgs[i]);
            }

            if (!pre.condition) continue;
            const z3Pre = translateExpr(tctx, pre.condition, pre.id, callerFn.name);
            tctx.variables = savedVars;
            tctx.errors = [];

            if (z3Pre === null) continue;

            const solver = new ctx.Solver();
            solver.set("timeout", TIMEOUT_MS);

            for (const cp of callerPres) solver.add(cp);

            for (const pathCond of site.pathConditions) {
                const z3PathCond = translateExpr(tctx, pathCond, "callsite", callerFn.name);
                tctx.errors = [];
                if (z3PathCond !== null) {
                    try {
                        solver.add(z3PathCond as unknown as ReturnType<SolverContext["Bool"]["val"]>);
                    } catch { /* Non-boolean path condition — skip */ }
                }
            }

            try {
                solver.add(ctx.Not(z3Pre as unknown as ReturnType<SolverContext["Bool"]["val"]>));
            } catch {
                continue;
            }

            const result = solver.checkSync!();

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
                    callerFn.id, site.callSiteId, callerFn.name,
                    site.calleeName, pre.id, counterexample,
                ));
            } else if (result === "unknown") {
                errors.push(verificationTimeout(
                    callerFn.id, pre.id, callerFn.name, TIMEOUT_MS,
                ));
            }
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
