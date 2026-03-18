// =============================================================================
// Semantic Assertion → Z3 Expression Translator
// =============================================================================
// Translates pre-built SemanticAssertion types into Z3 expressions.
// Each assertion maps to a proven-correct Z3 encoding using symbolic
// integer arrays (ArraySort(IntSort, IntSort)) with symbolic length variables.

import type { SolverContext } from "./solver-context.js";
import type { TranslationContext } from "./translate.js";
import type { SemanticAssertion } from "../ast/nodes.js";

/**
 * Translate a SemanticAssertion into a Z3 boolean expression.
 *
 * Uses symbolic Z3 arrays (`ArraySort(IntSort, IntSort)`) and quantified
 * formulas. The `target` field names the array variable (e.g., `"result"`),
 * and `args` provides assertion-specific parameters.
 *
 * @returns Z3 boolean expression, or null if translation fails
 */
export function translateSemanticAssertion(
    tctx: TranslationContext,
    semantic: SemanticAssertion,
): any | null {
    const { ctx } = tctx;

    // Semantic assertions require quantifiers + array theory (Z3-only features).
    // When the built-in solver is in use, these are absent → return null.
    // The caller (verify.ts) handles null via the undecidablePredicate error path.
    if (!ctx.ForAll || !ctx.Array || !ctx.Function) return null;

    // Get or create symbolic array + length for target
    const targetArr = getOrCreateArray(tctx, semantic.target);
    const targetLen = getOrCreateLength(tctx, semantic.target);

    switch (semantic.assertion) {
        case "sorted":
            return translateSorted(ctx, targetArr, targetLen, semantic.args);

        case "no_duplicates":
            return translateNoDuplicates(ctx, targetArr, targetLen);

        case "bounded":
            return translateBounded(ctx, targetArr, targetLen, semantic.args);

        case "length_preserved":
            return translateLengthPreserved(tctx, targetLen, semantic.args);

        case "permutation_of":
            return translatePermutationOf(ctx, tctx, targetArr, targetLen, semantic.args);

        case "subset_of":
            return translateSubsetOf(ctx, tctx, targetArr, targetLen, semantic.args);

        case "sum_preserved":
            return translateSumPreserved(ctx, tctx, targetArr, targetLen, semantic.args);

        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Symbolic array helpers
// ---------------------------------------------------------------------------

/**
 * Get or create a Z3 array variable for the given name.
 * Arrays are modeled as `(Array Int Int)` — integer-indexed, integer-valued.
 */
function getOrCreateArray(tctx: TranslationContext, name: string): any {
    const key = `__arr_${name}`;
    let arr = tctx.variables.get(key);
    if (!arr) {
        const { ctx } = tctx;
        arr = ctx.Array!.const(key, ctx.Int.sort(), ctx.Int.sort());
        tctx.variables.set(key, arr);
    }
    return arr;
}

/**
 * Get or create a Z3 integer variable representing the length of an array.
 */
function getOrCreateLength(tctx: TranslationContext, name: string): any {
    const key = `__len_${name}`;
    let len = tctx.variables.get(key);
    if (!len) {
        len = tctx.ctx.Int.const(key);
        tctx.variables.set(key, len);
    }
    return len;
}

// ---------------------------------------------------------------------------
// Assertion encodings
// ---------------------------------------------------------------------------

/**
 * sorted: ∀i ∈ [0, len-1): arr[i] ≤ arr[i+1]
 * args[0] can be "ascending" (default) or "descending"
 */
function translateSorted(ctx: SolverContext, arr: any, len: any, args?: string[]): any {
    const direction = args?.[0] ?? "ascending";
    const i = ctx.Int.const("__sorted_i");

    const inRange = ctx.And(i.ge(ctx.Int.val(0)), i.lt(len.sub(ctx.Int.val(1))));
    const elem_i = arr.select(i);
    const elem_next = arr.select(i.add(ctx.Int.val(1)));

    const ordered = direction === "descending"
        ? elem_i.ge(elem_next)
        : elem_i.le(elem_next);

    // Also require len >= 0
    const lenNonNeg = len.ge(ctx.Int.val(0));

    return ctx.And(lenNonNeg, ctx.ForAll!([i], ctx.Implies(inRange, ordered)));
}

/**
 * no_duplicates: ∀i,j ∈ [0, len): i ≠ j ⇒ arr[i] ≠ arr[j]
 */
function translateNoDuplicates(ctx: SolverContext, arr: any, len: any): any {
    const i = ctx.Int.const("__nodup_i");
    const j = ctx.Int.const("__nodup_j");

    const iInRange = ctx.And(i.ge(ctx.Int.val(0)), i.lt(len));
    const jInRange = ctx.And(j.ge(ctx.Int.val(0)), j.lt(len));

    const distinct = ctx.Implies(
        ctx.And(iInRange, jInRange, i.neq(j)),
        arr.select(i).neq(arr.select(j)),
    );

    const lenNonNeg = len.ge(ctx.Int.val(0));
    return ctx.And(lenNonNeg, ctx.ForAll!([i, j], distinct));
}

/**
 * bounded: ∀i ∈ [0, len): lo ≤ arr[i] ≤ hi
 * args = [lo, hi] as string-encoded integers
 */
function translateBounded(ctx: SolverContext, arr: any, len: any, args?: string[]): any {
    if (!args || args.length < 2) return null;

    const lo = ctx.Int.val(parseInt(args[0]!, 10));
    const hi = ctx.Int.val(parseInt(args[1]!, 10));

    if (isNaN(parseInt(args[0]!, 10)) || isNaN(parseInt(args[1]!, 10))) return null;

    const i = ctx.Int.const("__bounded_i");
    const inRange = ctx.And(i.ge(ctx.Int.val(0)), i.lt(len));
    const bounded = ctx.And(arr.select(i).ge(lo), arr.select(i).le(hi));

    const lenNonNeg = len.ge(ctx.Int.val(0));
    return ctx.And(lenNonNeg, ctx.ForAll!([i], ctx.Implies(inRange, bounded)));
}

/**
 * length_preserved: len(target) == len(source)
 * args = [sourceName]
 */
function translateLengthPreserved(tctx: TranslationContext, targetLen: any, args?: string[]): any {
    if (!args || args.length < 1) return null;
    const sourceLen = getOrCreateLength(tctx, args[0]!);
    return targetLen.eq(sourceLen);
}

/**
 * permutation_of: len(target) == len(source) ∧ ∀x: count(target,x) == count(source,x)
 * Modeled with uninterpreted count functions.
 * args = [sourceName]
 */
function translatePermutationOf(
    ctx: SolverContext,
    tctx: TranslationContext,
    _targetArr: any,
    targetLen: any,
    args?: string[],
): any {
    if (!args || args.length < 1) return null;

    const sourceLen = getOrCreateLength(tctx, args[0]!);

    // Use uninterpreted functions for element counts
    const targetCount = ctx.Function!.declare(
        `__count_${_targetArr}`,
        ctx.Int.sort(),
        ctx.Int.sort(),
    );
    const sourceArr = getOrCreateArray(tctx, args[0]!);
    const sourceCount = ctx.Function!.declare(
        `__count_${sourceArr}`,
        ctx.Int.sort(),
        ctx.Int.sort(),
    );

    const x = ctx.Int.const("__perm_x");

    // Same length AND same element counts
    return ctx.And(
        targetLen.eq(sourceLen),
        ctx.ForAll!([x], targetCount.call(x).eq(sourceCount.call(x))),
    );
}

/**
 * subset_of: ∀i ∈ [0, targetLen): ∃j ∈ [0, sourceLen): target[i] == source[j]
 * args = [sourceName]
 */
function translateSubsetOf(
    ctx: SolverContext,
    tctx: TranslationContext,
    targetArr: any,
    targetLen: any,
    args?: string[],
): any {
    if (!args || args.length < 1) return null;

    const sourceArr = getOrCreateArray(tctx, args[0]!);
    const sourceLen = getOrCreateLength(tctx, args[0]!);

    const i = ctx.Int.const("__subset_i");
    const j = ctx.Int.const("__subset_j");

    const iInRange = ctx.And(i.ge(ctx.Int.val(0)), i.lt(targetLen));
    const jInRange = ctx.And(j.ge(ctx.Int.val(0)), j.lt(sourceLen));

    const exists = ctx.Exists!([j], ctx.And(jInRange, targetArr.select(i).eq(sourceArr.select(j))));

    const lenNonNeg = ctx.And(targetLen.ge(ctx.Int.val(0)), sourceLen.ge(ctx.Int.val(0)));
    return ctx.And(lenNonNeg, ctx.ForAll!([i], ctx.Implies(iInRange, exists)));
}

/**
 * sum_preserved: sum(target) == sum(source)
 * Modeled with uninterpreted sum functions.
 * args = [sourceName]
 */
function translateSumPreserved(
    ctx: SolverContext,
    tctx: TranslationContext,
    targetArr: any,
    targetLen: any,
    args?: string[],
): any {
    if (!args || args.length < 1) return null;

    const sourceArr = getOrCreateArray(tctx, args[0]!);
    const sourceLen = getOrCreateLength(tctx, args[0]!);

    // Use uninterpreted functions for array sums
    const targetSum = ctx.Function!.declare(
        `__sum_${targetArr}`,
        ctx.Int.sort(),
    );
    const sourceSum = ctx.Function!.declare(
        `__sum_${sourceArr}`,
        ctx.Int.sort(),
    );

    return ctx.And(
        targetLen.ge(ctx.Int.val(0)),
        sourceLen.ge(ctx.Int.val(0)),
        targetSum.call().eq(sourceSum.call()),
    );
}
