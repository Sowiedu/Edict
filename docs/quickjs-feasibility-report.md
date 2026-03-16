# QuickJS Feasibility Study — Results Report

> Self-hosting the Edict compiler: can the full compiler pipeline run inside QuickJS WASM?

**Date**: 2026-03-13 (original study) — **Updated**: 2026-03-16  
**Issue**: [#134](https://github.com/Sowiedu/Edict/issues/134)  
**Platform**: darwin-arm64 (Apple Silicon), Node v22.14.0  
**QuickJS**: `quickjs-emscripten` (WASM build of QuickJS 2025-09-13)

> [!NOTE]
> This report was the original feasibility study. For the definitive current status of self-hosting, see [self-hosting-status.md](self-hosting-status.md). For contract verification research, see [self-hosting-contracts-research.md](self-hosting-contracts-research.md).

---

## Executive Summary

The Edict compiler's **check + compile pipeline (phases 1–5)** runs successfully inside QuickJS WASM. The check pipeline (phases 1–3) achieves a **3.7x slowdown** vs native Node.js — viable for real-time agent use in sandboxed environments.

The original study identified binaryen (WASM codegen) as a critical blocker. **This blocker has been resolved**: binaryen was replaced with a pure-JS WASM binary encoder ([#198](https://github.com/Sowiedu/Edict/issues/198)), enabling WASM codegen inside QuickJS.

The **remaining blockers** are contract verification (phase 4, Z3 — requires `WebAssembly` API + worker threads) and WASM _execution_ (phase 6, requires `WebAssembly` API). See the [Z3 research document](self-hosting-contracts-research.md) for detailed analysis of contract verification paths.

---

## Bundle Sizes

| Bundle | Entry Point | Size | Contents |
|--------|-------------|------|----------|
| Check-only | `dist/edict-quickjs-check.js` | **365.7 KB** | Phases 1–3: validate, resolve, typeCheck, effectCheck, lint, patch, compose |
| Full (compile) | `dist/edict-quickjs-full.js` | **860.5 KB** | Phases 1–5: check + WASM codegen via pure-JS encoder |

Both bundles use IIFE format (QuickJS doesn't support ESM `import`). Node.js modules are shimmed to empty stubs via esbuild. Z3 is excluded.

For comparison: the browser ESM bundles are 340.5 KB (phases 1–3) and 811.4 KB (full with WASM encoder).

---

## Performance Comparison

| Metric | QuickJS (WASM) | Native (Node.js) | Ratio |
|--------|---------------|-------------------|-------|
| QuickJS init | 9.3ms | — | — |
| Bundle load | 30.6ms | — | — |
| `checkBrowser(fibonacci)` | **2.3ms** | **0.6ms** | **3.7x** |

- **5 runs**, median values
- Sample program: `fibonacci.edict.json` (recursive fibonacci with contracts, ~40 AST nodes)
- Native Node.js uses JIT compilation; QuickJS is a pure interpreter running in WASM — 3.7x is remarkably good

### Individual Runs (ms)

| Run | QuickJS | Native |
|-----|---------|--------|
| 1 | 3.2 | 3.4 |
| 2 | 2.2 | 0.6 |
| 3 | 2.4 | 0.7 |
| 4 | 2.1 | 0.6 |
| 5 | 2.3 | 0.3 |

First run includes JIT warmup (Node) and bytecode compilation (QuickJS).

---

## Memory Usage

QuickJS runtime memory after loading bundle + running 5 checks:

| Category | Count | Size |
|----------|-------|------|
| Memory allocated | 12,823 blocks | ~100 KB |
| Memory used | — | **683 KB** |
| Atoms (interned strings) | 2,075 | ~82 KB |
| Objects | 3,770 | ~181 KB |
| Bytecode functions | 437 | ~219 KB |

Total memory footprint: **~684 KB** — very lightweight.

---

## Resolved Blockers

### ~~Binaryen Incompatible with QuickJS~~ → ✅ Resolved

**Original blocker**: Binaryen's npm package used top-level `await` (incompatible with IIFE format) and required the `WebAssembly` API to load its own WASM binary.

**Resolution**: Binaryen was replaced with a pure-JS WASM binary encoder ([#198](https://github.com/Sowiedu/Edict/issues/198)). The encoder implements the ~75 binaryen API methods Edict actually uses (~730 call sites), producing valid WASM MVP binaries without any native dependencies. See [binaryen-api-audit.md](binaryen-api-audit.md) for the audit that guided this replacement.

### Missing Web APIs → ✅ Mitigated

QuickJS lacks `TextEncoder` and `TextDecoder`. These are polyfilled with minimal UTF-8 implementations (~40 lines). Solved.

### No ESM Support in QuickJS → ✅ Mitigated

QuickJS doesn't support `import`/`export` in `evalCode`. Solved by using IIFE format bundles.

---

## Remaining Blockers

### 1. Contract Verification — Z3 (Critical)

Z3's npm package requires `WebAssembly.instantiate()` (QuickJS lacks) and worker threads for timeout handling.

**Impact**: Contract verification (phase 4) cannot run in QuickJS.

**Research**: Five paths were evaluated in the [Z3 research document](self-hosting-contracts-research.md). Recommended strategy: ship without contracts first, evaluate a custom QF-LIA solver medium-term.

### 2. WASM Execution — No `WebAssembly` API (Critical)

QuickJS is a pure JavaScript interpreter — it does not implement the `WebAssembly` global. The compiler can _produce_ WASM binaries inside QuickJS, but _executing_ them requires a runtime with `WebAssembly` support (e.g., Node.js, browser, Deno).

---

## What Works

| Feature | Status |
|---------|--------|
| Schema validation (phase 1) | ✅ Works |
| Name resolution (phase 2a) | ✅ Works |
| Type checking (phase 2b) | ✅ Works |
| Effect checking (phase 3) | ✅ Works |
| **WASM codegen (phase 5)** | ✅ **Works** (pure-JS encoder) |
| Lint | ✅ Works |
| Patch engine | ✅ Works |
| Fragment composition | ✅ Works |
| Compact AST expansion | ✅ Works |
| Schema migration | ✅ Works |
| Contract verification (phase 4) | ❌ Blocked (Z3) |
| WASM execution (phase 6) | ❌ Blocked (WebAssembly API) |

---

## Recommendations

### Immediate (Done ✅)

1. **Check + codegen self-hosting**: The 860.5 KB full bundle runs phases 1–5 inside QuickJS. The compiler validates, type-checks, effect-checks, and compiles to WASM — all self-hosted. WASM output can be executed in any runtime with `WebAssembly` support.

### Medium-Term

2. **Contract verification**: Evaluate a custom quantifier-free linear integer arithmetic (QF-LIA) solver to cover ~70% of contract patterns. See [analysis](self-hosting-contracts-research.md).

3. **WASM execution inside QuickJS**: Monitor `quickjs-emscripten` for WebAssembly API support. When available, programs compiled inside QuickJS could also be executed there.

### Long-Term

4. **QuickJS bytecode backend**: Instead of WASM output, add a QuickJS bytecode backend for full compile-and-execute self-hosting without `WebAssembly` dependency.

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [self-hosting-status.md](self-hosting-status.md) | Definitive current status of self-hosting |
| [self-hosting-contracts-research.md](self-hosting-contracts-research.md) | Z3/contract verification research (#199) |
| [binaryen-api-audit.md](binaryen-api-audit.md) | API audit that informed the binaryen replacement |

## Files Created (Original Study)

| File | Purpose |
|------|---------|
| `scripts/build-quickjs-bundle.ts` | esbuild script for IIFE bundles |
| `scripts/quickjs-feasibility.ts` | Benchmark harness |
| `docs/quickjs-feasibility-report.md` | This report |
| `quickjs-feasibility-results.json` | Machine-readable results |

---

## Conclusion

**The Edict compiler is self-hostable in QuickJS for the check + compile pipeline** (phases 1–5). The binaryen blocker has been fully resolved by replacing it with a pure-JS WASM encoder. An 860.5 KB bundle with 684 KB memory footprint is lightweight enough for edge deployment.

The remaining gaps are contract verification (Z3, requires a custom solver or QuickJS WebAssembly API) and WASM execution (requires `WebAssembly` API). The check + compile self-hosted compiler is immediately useful — agents can validate, type-check, and compile Edict programs in sandboxed WASM environments, with the output WASM executed in any standard runtime.
