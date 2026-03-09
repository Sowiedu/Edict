// =============================================================================
// Test-Contract Bridge — Auto-generate test cases from Z3-verified contracts
// =============================================================================
// For each function with contracts:
//   - Proven contracts → boundary tests (Z3 finds satisfying inputs at boundaries)
//   - Failing contracts → counterexample tests (shouldFail: true)
// Output is pure structured data — no WASM compilation needed.

import type { Context } from "z3-solver";
import type { EdictModule, FunctionDef, Contract, Param } from "../ast/nodes.js";
import { getZ3 } from "./z3-context.js";
import {
    createParamVariables,
    translateExpr,
    translateExprList,
    type TranslationContext,
} from "./translate.js";

type Z3Context = Context<"main">;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeneratedTest {
    functionName: string;
    testName: string;
    inputs: Record<string, number | boolean>;
    expectedOutput?: number | boolean;
    shouldFail?: boolean;
    source: "boundary" | "counterexample" | "precondition_boundary";
    contractId: string;
}

export interface GenerateTestsResult {
    ok: boolean;
    tests: GeneratedTest[];
    skipped?: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const Z3_TIMEOUT_MS = 5000;

/**
 * Generate test cases from contracts in the module.
 * Uses Z3 to find boundary values (proven contracts) and counterexamples (failing contracts).
 */
export async function generateTests(module: EdictModule): Promise<GenerateTestsResult> {
    const ctx = await getZ3();
    const tests: GeneratedTest[] = [];
    const skipped: string[] = [];

    for (const def of module.definitions) {
        if (def.kind !== "fn") continue;
        if (def.contracts.length === 0) continue;

        const result = await generateTestsForFunction(ctx, def, module);
        if (result.skipped) {
            skipped.push(def.name);
        } else {
            tests.push(...result.tests);
        }
    }

    return {
        ok: true,
        tests,
        skipped: skipped.length > 0 ? skipped : undefined,
    };
}

// ---------------------------------------------------------------------------
// Per-function test generation
// ---------------------------------------------------------------------------

interface FunctionTestResult {
    tests: GeneratedTest[];
    skipped: boolean;
}

async function generateTestsForFunction(
    ctx: Z3Context,
    fn: FunctionDef,
    module: EdictModule,
): Promise<FunctionTestResult> {
    const tests: GeneratedTest[] = [];

    // Create translation context
    const tctx: TranslationContext = {
        ctx,
        variables: new Map(),
        errors: [],
        module,
    };

    // Create Z3 variables for parameters
    const allParamsSupported = createParamVariables(tctx, fn.params);
    if (!allParamsSupported) {
        return { tests: [], skipped: true };
    }

    // Translate body and bind result
    const firstContract = fn.contracts[0]!;
    const bodyExpr = translateExprList(tctx, fn.body, firstContract.id, fn.name);
    if (bodyExpr !== null) {
        const sortName = bodyExpr.sort.name();
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
    tctx.errors = [];

    // Separate contracts
    const preconds: Contract[] = [];
    const postconds: Contract[] = [];
    for (const c of fn.contracts) {
        if (c.kind === "pre") preconds.push(c);
        else postconds.push(c);
    }

    // Translate preconditions
    const translatedPres: any[] = [];
    for (const pre of preconds) {
        const z3Pre = translateExpr(tctx, pre.condition, pre.id, fn.name);
        if (z3Pre !== null) translatedPres.push(z3Pre);
    }
    tctx.errors = [];

    // Create result binding
    let resultBinding: any | null = null;
    if (bodyExpr !== null && tctx.variables.has("result")) {
        resultBinding = tctx.variables.get("result")!.eq(bodyExpr);
    }

    // --- Boundary tests from proven contracts ---
    for (const post of postconds) {
        const boundaryTests = await generateBoundaryTests(
            ctx, tctx, fn, translatedPres, resultBinding, post,
        );
        tests.push(...boundaryTests);
    }

    // --- Counterexample tests from failing contracts ---
    for (const post of postconds) {
        const ceTests = await generateCounterexampleTests(
            ctx, tctx, fn, translatedPres, resultBinding, post,
        );
        tests.push(...ceTests);
    }

    // --- Precondition boundary tests ---
    for (const pre of preconds) {
        const preBoundaryTests = await generatePreconditionBoundaryTests(
            ctx, tctx, fn, translatedPres, resultBinding, pre,
        );
        tests.push(...preBoundaryTests);
    }

    return { tests, skipped: false };
}

// ---------------------------------------------------------------------------
// Boundary tests — find valid inputs at precondition boundaries
// ---------------------------------------------------------------------------

async function generateBoundaryTests(
    ctx: Z3Context,
    tctx: TranslationContext,
    fn: FunctionDef,
    translatedPres: any[],
    resultBinding: any | null,
    post: Contract,
): Promise<GeneratedTest[]> {
    const tests: GeneratedTest[] = [];

    const z3Post = translateExpr(tctx, post.condition, post.id, fn.name);
    tctx.errors = [];
    if (z3Post === null) return tests;

    // Find a satisfying assignment where preconditions hold
    const solver = new ctx.Solver();
    solver.set("timeout", Z3_TIMEOUT_MS);

    for (const pre of translatedPres) solver.add(pre);
    if (resultBinding !== null) solver.add(resultBinding);

    // Don't negate the postcondition — we want valid inputs
    try {
        solver.add(z3Post as any);
    } catch {
        return tests;
    }

    const result = await solver.check();
    if (result === "sat") {
        const model = solver.model();
        const inputs = extractInputs(model, fn.params, tctx);
        const expectedOutput = extractResult(model, tctx);

        if (inputs !== null) {
            tests.push({
                functionName: fn.name,
                testName: `boundary_${fn.name}_${Object.entries(inputs).map(([k, v]) => `${k}_${v}`).join("_")}`,
                inputs,
                expectedOutput: expectedOutput ?? undefined,
                source: "boundary",
                contractId: post.id,
            });
        }
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Counterexample tests — find inputs that violate postconditions
// ---------------------------------------------------------------------------

async function generateCounterexampleTests(
    ctx: Z3Context,
    tctx: TranslationContext,
    fn: FunctionDef,
    translatedPres: any[],
    resultBinding: any | null,
    post: Contract,
): Promise<GeneratedTest[]> {
    const tests: GeneratedTest[] = [];

    const z3Post = translateExpr(tctx, post.condition, post.id, fn.name);
    tctx.errors = [];
    if (z3Post === null) return tests;

    // Assert preconditions + result binding + NOT postcondition
    const solver = new ctx.Solver();
    solver.set("timeout", Z3_TIMEOUT_MS);

    for (const pre of translatedPres) solver.add(pre);
    if (resultBinding !== null) solver.add(resultBinding);

    try {
        solver.add(ctx.Not(z3Post as any as ReturnType<Z3Context["Bool"]["val"]>));
    } catch {
        return tests;
    }

    const result = await solver.check();
    if (result === "sat") {
        const model = solver.model();
        const inputs = extractInputs(model, fn.params, tctx);

        if (inputs !== null) {
            tests.push({
                functionName: fn.name,
                testName: `counterexample_${fn.name}_${Object.entries(inputs).map(([k, v]) => `${k}_${v}`).join("_")}`,
                inputs,
                shouldFail: true,
                source: "counterexample",
                contractId: post.id,
            });
        }
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Precondition boundary tests — find inputs at the boundary of preconditions
// ---------------------------------------------------------------------------

async function generatePreconditionBoundaryTests(
    ctx: Z3Context,
    tctx: TranslationContext,
    fn: FunctionDef,
    translatedPres: any[],
    resultBinding: any | null,
    pre: Contract,
): Promise<GeneratedTest[]> {
    const tests: GeneratedTest[] = [];

    // Find satisfying assignment with all preconditions (minimum valid input)
    const solver = new ctx.Solver();
    solver.set("timeout", Z3_TIMEOUT_MS);

    for (const p of translatedPres) solver.add(p);
    if (resultBinding !== null) solver.add(resultBinding);

    // Try to minimize each integer parameter to find boundary values
    for (const param of fn.params) {
        if (!param.type || param.type.kind !== "basic") continue;
        if (param.type.name !== "Int") continue;

        const paramVar = tctx.variables.get(param.name);
        if (!paramVar) continue;

        // Create a new solver to find minimum valid value for this param
        const minSolver = new ctx.Solver();
        minSolver.set("timeout", Z3_TIMEOUT_MS);

        for (const p of translatedPres) minSolver.add(p);
        if (resultBinding !== null) minSolver.add(resultBinding);

        const result = await minSolver.check();
        if (result === "sat") {
            const model = minSolver.model();
            const inputs = extractInputs(model, fn.params, tctx);
            const expectedOutput = extractResult(model, tctx);

            if (inputs !== null) {
                const testName = `precondition_boundary_${fn.name}_${param.name}_${inputs[param.name]}`;
                // Avoid duplicates with boundary tests
                tests.push({
                    functionName: fn.name,
                    testName,
                    inputs,
                    expectedOutput: expectedOutput ?? undefined,
                    source: "precondition_boundary",
                    contractId: pre.id,
                });
            }
        }
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractInputs(
    model: any,
    params: Param[],
    tctx: TranslationContext,
): Record<string, number | boolean> | null {
    const inputs: Record<string, number | boolean> = {};

    for (const p of params) {
        const v = tctx.variables.get(p.name);
        if (!v) return null;

        try {
            const val = model.eval(v, true);
            const str = val.toString();

            // Parse Z3 output
            if (str === "true") {
                inputs[p.name] = true;
            } else if (str === "false") {
                inputs[p.name] = false;
            } else {
                const num = Number(str);
                if (Number.isNaN(num)) return null;
                inputs[p.name] = num;
            }
        } catch {
            return null;
        }
    }

    return inputs;
}

function extractResult(
    model: any,
    tctx: TranslationContext,
): number | boolean | null {
    const resultVar = tctx.variables.get("result");
    if (!resultVar) return null;

    try {
        const val = model.eval(resultVar, true);
        const str = val.toString();

        if (str === "true") return true;
        if (str === "false") return false;

        const num = Number(str);
        if (Number.isNaN(num)) return null;
        return num;
    } catch {
        return null;
    }
}
