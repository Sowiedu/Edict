# Self-Hosting Contracts Research — Z3 in QuickJS WASM

> Research document for [#199](https://github.com/Sowiedu/Edict/issues/199): viable paths for contract verification in a fully self-hosted WASM compiler.

**Date**: 2026-03-16
**Parent issue**: [#81](https://github.com/Sowiedu/Edict/issues/81) (Self-Hosting via WASM)
**Prerequisites**: [#198](https://github.com/Sowiedu/Edict/issues/198) (binaryen replaced with pure-JS WASM encoder — ✅ landed)

---

## Summary

Contract verification (phase 4) is the **last remaining blocker** for full compiler self-hosting in QuickJS WASM. With PR #198 replacing binaryen with a pure-JS WASM encoder, codegen (phase 5) is now unblocked. This document analyzes five paths forward and recommends a two-phase strategy.

---

## 1. Z3 API Surface Audit

Edict uses Z3 through 6 files (~1,700 lines) in `src/contracts/`:

| File | Z3 Features Used |
|------|-----------------|
| `z3-context.ts` | `init()`, `Context("main")` — singleton initialization |
| `translate.ts` | `Int.const`, `Real.const`, `Bool.const`, `Int.val`, `Real.val`, `Bool.val`, `If`, `Not`, `And`, `Or`, `Implies`, `ForAll`, `Exists`, arithmetic ops (`.add`, `.sub`, `.mul`, `.div`, `.mod`), comparison ops (`.eq`, `.neq`, `.lt`, `.gt`, `.le`, `.ge`) |
| `translate-semantic.ts` | `Array.const(name, IntSort, IntSort)`, `.select()`, `Function.declare()`, `ForAll`, `Exists` with multi-variable quantification |
| `verify.ts` | `new Solver()`, `solver.set("timeout", N)`, `solver.add()`, `solver.check()` → `"sat"/"unsat"/"unknown"`, `solver.model()`, `model.eval()` |
| `generate-tests.ts` | Same solver API + model extraction for test generation |
| `hash.ts` | No Z3 usage (pure hashing) |

### Complexity Tiers

| Tier | Z3 Feature | Used For |
|------|-----------|----------|
| **Basic** | Int/Bool/Real constants + arithmetic + comparisons | Pre/postcondition translation |
| **Intermediate** | Solver create/add/check, model extraction | Verification core loop |
| **Advanced** | `ForAll`/`Exists` quantifiers | Quantified contracts (∀i, ∃j patterns) |
| **Expert** | `Array.const` (SMT arrays), uninterpreted functions | Semantic assertions (sorted, permutation, subset, etc.) |

### Worker Thread Usage

Current code uses `node:worker_threads` in `verify.ts` for two purposes:

1. **Timeout isolation**: Kill runaway Z3 solving via `worker.terminate()`
2. **Event loop responsiveness**: Keep MCP server responsive during Z3 solving

**Key finding**: Z3 already supports cooperative timeouts via `solver.set("timeout", 5000)`. The timeout parameter is passed to Z3's internal solver, which returns `"unknown"` if it exceeds the limit. This means worker threads are not strictly required — they're an optimization for responsiveness, not correctness.

---

## 2. Answering the Research Questions

### Q1: Is contract verification optional?

**Yes, for a useful self-hosted compiler.** The check-only pipeline (phases 1–3) already runs in QuickJS and covers the highest-value use case: schema validation, name resolution, type checking, and effect checking. These catch the vast majority of agent errors.

Contracts are Edict's differentiator — "formally verified functions" — but they're **verification, not validation**. A program rejected by phases 1–3 is broken. A program that passes phases 1–3 but fails contracts has a logic error the agent would otherwise miss. In practice:

- Most example programs don't use contracts
- Agents can iterate on contracts later (check first, verify later)
- The check-only compiler is immediately useful for sandboxed/edge environments

**Recommendation**: Ship self-hosted compiler **without** contracts first. Document the limitation clearly. Add contracts when a viable path is proven.

### Q2: Lightweight SMT alternatives

No pure-JS library covers Edict's contract needs:

| Library | Capabilities | Edict Fit |
|---------|-------------|-----------|
| `logic-solver` | Boolean SAT + small-integer sums/inequalities | ❌ No quantifiers, no reals, no model extraction |
| `@problem-solving/sat` | Pure boolean SAT (DPLL) | ❌ No arithmetic at all |
| `javascript-lp-solver` | Integer Linear Programming | ❌ Optimization, not satisfiability |
| `YALPS` | LP/MIP solver | ❌ Same — optimization, not SMT |
| `smtlib` | Node.js API to external Z3/CVC5 | ❌ Requires native solver binary |

**Analysis**: Edict's contract subset looks deceptively simple (integer arithmetic + boolean logic), but the **quantifier support** (`ForAll`, `Exists`) and **array theories** (semantic assertions) push it firmly into SMT territory. No pure-JS library provides even basic `ForAll`/`Exists`. Building one from scratch would be a research project, not an engineering task.

### Q3: QuickJS WebAssembly API timeline

The `quickjs-emscripten` project is actively maintained (latest vendor: Feb 2026) but has **no confirmed timeline** for WebAssembly API support. The project focuses on:
- Sandboxed JS execution via Emscripten
- ESM packaging improvements
- `quickjs-ng` variant integration

There's no open issue or PR adding `WebAssembly.instantiate()` to QuickJS. This is a fundamental engine limitation — QuickJS is a pure JS interpreter, and adding WASM support would require embedding a WASM runtime (e.g., wasm3, wasmtime) inside the Emscripten-compiled QuickJS binary.

**Assessment**: Uncertain timeline. Could be 6+ months or never. Not a reliable path to plan around.

### Q4: Worker thread alternatives

**Already solved.** Z3's `solver.set("timeout", N)` is a cooperative timeout that makes the solver return `"unknown"` after N milliseconds. Edict already uses this (`TIMEOUT_MS = 5000` in `verify.ts`). Worker threads are used for an additional `WORKER_TIMEOUT_MS = 30_000` hard kill, but this is a safety net, not the primary mechanism.

For QuickJS self-hosting, the cooperative timeout alone is sufficient:
- Z3 respects the timeout internally
- QuickJS is single-threaded, so the solver blocks the event loop anyway
- A 5-second timeout prevents runaway solving
- The `"unknown"` result maps to `VerificationTimeoutError` with full structured context

### Q5: V8 isolates fallback

Using `isolated-vm` for contract verification is technically viable but architecturally problematic:

| Pro | Con |
|-----|-----|
| Full WebAssembly + worker thread support | ~40 MB binary (vs 1.3 MB for QuickJS) |
| JIT performance | Not truly self-hosted (V8 is a native dependency) |
| No code changes to Z3 integration | Defeats the "zero dependency" goal of self-hosting |

**Assessment**: V8 isolates are a reasonable **deployment option** (use QuickJS for check-only, V8 for full pipeline) but not a self-hosting solution.

---

## 3. Viable Paths

### Path A: "Check + Codegen" Self-Hosting (No Contracts)

Ship a self-hosted compiler that runs phases 1–3 + phase 5 (codegen via pure-JS encoder). Skip phase 4 (contracts). Document that contract verification requires a full Node.js/Deno runtime.

| Aspect | Detail |
|--------|--------|
| **Effort** | ~1 week (bundle the new WASM encoder, update QuickJS IIFE build, test) |
| **Bundle size** | ~400 KB estimated (357 KB check + ~50 KB encoder) |
| **Coverage** | 4 of 5 pipeline phases |
| **Limitation** | No contract verification; programs compile and run but aren't formally verified |

### Path B: Custom Miniature SMT Solver (Quantifier-Free Fragment)

Build a pure-JS solver that handles Edict's **quantifier-free** contracts only. This covers the basic tier:

- Integer arithmetic assertions: `pre x > 0`, `post result >= 0`
- Boolean logic: `and`, `or`, `not`, `implies`
- Comparison chains: `x > 0 and x < 100`
- If-then-else in contracts
- Result binding: `result == x + y`

Exclude quantifiers (`ForAll`/`Exists`) and semantic assertions (sorted, permutation, etc.).

| Aspect | Detail |
|--------|--------|
| **Effort** | 3–5 weeks |
| **Approach** | DPLL(T) architecture: Boolean SAT core + linear integer arithmetic theory solver |
| **Coverage** | ~70% of contracts in example programs (most use simple pre/post conditions) |
| **Limitation** | No quantified contracts, no semantic assertions |
| **Maintenance** | New solver to maintain; risk of subtle soundness bugs |

### Path C: Z3 WASM-in-WASM (Double Embedding)

Load Z3's WASM binary inside QuickJS by providing a minimal `WebAssembly` polyfill that delegates to the host's WASM runtime.

| Aspect | Detail |
|--------|--------|
| **Effort** | 4–8 weeks (polyfill + Z3 integration + testing) |
| **Approach** | Implement `WebAssembly.instantiate()` as a QuickJS host function that calls the actual WASM runtime |
| **Coverage** | 100% of contracts (full Z3) |
| **Limitation** | Requires host to have WASM support; adds ~5 MB for Z3 WASM binary; complex debugging |
| **Risk** | Z3's WASM build may use features (threads, SIMD) that the host polyfill can't handle |

### Path D: SMT-LIB Text Protocol to External Solver

Instead of embedding Z3, generate SMT-LIB2 text and shell out to an external solver process.

| Aspect | Detail |
|--------|--------|
| **Effort** | 2–3 weeks |
| **Approach** | Translate Edict AST → SMT-LIB2 text, invoke `z3`/`cvc5` via process spawn |
| **Coverage** | 100% of contracts |
| **Limitation** | Requires external `z3` binary on system; eliminates self-hosting benefit |
| **Use case** | Good for environments where Z3 is installed but `z3-solver` npm won't load |

### Path E: Wait for QuickJS WebAssembly API

Do nothing. Monitor `quickjs-emscripten` for WebAssembly API support.

| Aspect | Detail |
|--------|--------|
| **Effort** | 0 |
| **Coverage** | 100% when available |
| **Risk** | Uncertain timeline (6+ months or never) |

---

## 4. Recommendation

### Phase 1: Ship Check + Codegen Self-Hosting (Path A)

**Immediate priority.** With binaryen replaced (#198), the main blocker for codegen self-hosting is gone. Build an IIFE bundle that includes phases 1–3 + phase 5 (pure-JS WASM encoder). The `EdictQuickJS` class gets a `compileBrowser()` method in addition to `checkBrowser()`.

This gives agents a fully self-contained compiler that **validates, type-checks, effect-checks, and compiles to WASM** — all in ~400 KB. Contract verification is deferred with a clear error: `contract_verification_unavailable` with `reason: "self_hosted_environment"`.

### Phase 2: Evaluate Custom QF-LIA Solver (Path B)

**Medium-term.** Assess whether a quantifier-free linear integer arithmetic (QF-LIA) solver is worth building. This is the realistic middle ground:

- Covers the most common contract patterns (simple pre/post conditions)
- ~3–5 weeks of effort
- Pure JS, no external dependencies
- Can be tested against Z3 for correctness

Before committing, audit the example programs and real-world usage to measure what percentage of contracts are quantifier-free. If >80% are QF-LIA, this is worth building.

### Not Recommended

- **Path C** (WASM-in-WASM): High complexity, high risk of edge-case failures with Z3's WASM build. Only pursue if QuickJS gains native WebAssembly support (making it trivial).
- **Path D** (external solver): Defeats self-hosting purpose.
- **Path E** (wait): Not actionable.

---

## 5. Summary Table

| Path | Effort | Coverage | Self-Hosted? | Recommended? |
|------|--------|----------|-------------|-------------|
| **A: Check + Codegen (no contracts)** | 1 week | 4/5 phases | ✅ | ✅ **Immediate** |
| **B: Custom QF-LIA solver** | 3–5 weeks | ~70% contracts | ✅ | ✅ **Medium-term** |
| **C: Z3 WASM-in-WASM** | 4–8 weeks | 100% contracts | ⚠️ Partial | ❌ Too risky |
| **D: External solver** | 2–3 weeks | 100% contracts | ❌ | ❌ Defeats purpose |
| **E: Wait for QuickJS WASM** | 0 | 100% eventually | ✅ | ❌ Unreliable |

---

## Files Referenced

| File | Purpose |
|------|---------|
| [`src/contracts/z3-context.ts`](../src/contracts/z3-context.ts) | Z3 singleton initialization |
| [`src/contracts/translate.ts`](../src/contracts/translate.ts) | AST → Z3 expression translation |
| [`src/contracts/translate-semantic.ts`](../src/contracts/translate-semantic.ts) | Semantic assertion → Z3 (arrays, quantifiers) |
| [`src/contracts/verify.ts`](../src/contracts/verify.ts) | Verification orchestration + worker thread |
| [`src/contracts/generate-tests.ts`](../src/contracts/generate-tests.ts) | Z3-powered test generation |
| [`docs/self-hosting-status.md`](self-hosting-status.md) | Current self-hosting status |
| [`docs/quickjs-feasibility-report.md`](quickjs-feasibility-report.md) | QuickJS feasibility study |
