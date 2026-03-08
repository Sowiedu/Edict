# Contract Verification Coverage

> Baseline established: 2026-03-08 · Corpus: 55 contracts · Edict v1.7.0+

## Summary

| Metric | Count | Rate |
|---|---|---|
| **Proven** (Z3 unsat) | 38 | 71.7% |
| **Counterexample** (Z3 sat) | 13 | 24.5% |
| **Undecidable** (untranslatable) | 2 | 3.8% |
| **Skipped** (unsupported params) | 2 | — |
| **Timeout** (Z3 unknown) | 0 | 0.0% |
| **Total** | 55 | — |

> Rates exclude skipped contracts (denominator = 53 verifiable contracts).

## Per-Tier Breakdown

| Tier | Description | Proven | Counter | Undecidable | Total |
|---|---|---|---|---|---|
| T1 | Basic arithmetic | 7 | 3 | 0 | 10 |
| T2 | Boolean logic | 6 | 2 | 0 | 8 |
| T3 | Comparison chains | 4 | 2 | 0 | 6 |
| T4 | Multi-precondition | 5 | 1 | 0 | 6 |
| T5 | Body-dependent (if/let/match) | 7 | 1 | 0 | 8 |
| T6 | Callsite preconditions | 4 | 2 | 0 | 6 |
| T7 | Quantifiers (forall/exists) | 4 | 2 | 0 | 6 |
| T8 | Known limitations | 1 | 0 | 2 | 5 |

## Top 5 Undecidable Patterns

| # | Pattern | Root Cause | Potential Improvement |
|---|---|---|---|
| 1 | **String params** | Z3 has no String sort mapping | Add Z3 string theory support (SeqSort) |
| 2 | **Array params** | Z3 has no Array sort mapping | Add Z3 array theory support (ArraySort) |
| 3 | **Call expressions in contracts** | Unknown function bodies can't be inlined | Expand inline-able function set (pure + known body) |
| 4 | **String literals in predicates** | String values can't be translated | Map to Z3 string constants |
| 5 | **Non-linear arithmetic** | Z3 may timeout on `x*x*x` patterns | Accept timeout as expected for non-linear |

> Patterns 1–4 are addressable. Pattern 5 is inherent to SMT solving.

## Running Metrics

```bash
npx tsx scripts/contract-metrics.ts
```

## Corpus Location

- Test file: `tests/contracts/corpus.test.ts`
- Script: `scripts/contract-metrics.ts`
