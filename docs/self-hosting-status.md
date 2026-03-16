# Self-Hosting Status — Edict Compiler in WASM

> Definitive status of WASM self-hosting: what works, what's blocked, and conditions for full self-hosting.

**Date**: 2026-03-16
**Parent issue**: [#81](https://github.com/Sowiedu/Edict/issues/81)
**Related**: [#134](https://github.com/Sowiedu/Edict/issues/134) (feasibility study), [#156](https://github.com/Sowiedu/Edict/issues/156) (check-only PoC), [#198](https://github.com/Sowiedu/Edict/issues/198) (binaryen replacement)

---

## Executive Summary

The Edict compiler's **check + compile pipeline (phases 1–5)** is self-hostable today via QuickJS-WASM. The binaryen dependency was replaced with a pure-JS WASM binary encoder (#198), eliminating the primary blocker for WASM codegen self-hosting.

The `EdictQuickJS` class provides two modes:
- **Check-only** (phases 1–3): schema validation, name resolution, type checking, effect checking at **3.7x slowdown** vs native Node.js, in a **365.7 KB** bundle.
- **Full compile** (phases 1–5): check + WASM codegen in an **860.5 KB** bundle. Produces valid WASM binaries verified via `WebAssembly.compile()`.

**Remaining blocker**: Contract verification (phase 4, Z3) and WASM _execution_ (phase 6) inside QuickJS. Both require the `WebAssembly` API which QuickJS lacks.

---

## What Works

| Pipeline Stage | Status | Notes |
|----------------|--------|-------|
| Schema validation (phase 1) | ✅ Works | Full structural + semantic validation |
| Name resolution (phase 2a) | ✅ Works | Levenshtein suggestions included |
| Type checking (phase 2b) | ✅ Works | Bidirectional type inference |
| Effect checking (phase 3) | ✅ Works | Call-graph propagation |
| **WASM codegen (phase 5)** | ✅ **Works** | **Pure-JS WASM encoder — no binaryen dependency** |
| Lint engine | ✅ Works | Included in check bundle |
| Patch engine | ✅ Works | Surgical AST patching by nodeId |
| Fragment composition | ✅ Works | Composable program fragments |
| Compact AST expansion | ✅ Works | Token-efficient format support |
| Schema migration | ✅ Works | Auto-upgrade older ASTs |
| Contract verification (phase 4) | ❌ Blocked | Z3 requires worker threads + WebAssembly API |
| WASM execution (phase 6) | ❌ Blocked | QuickJS lacks WebAssembly API |

---

## Bundle Sizes

| Bundle | Format | Size | Contents |
|--------|--------|------|----------|
| **Check-only** | IIFE | **365.7 KB** | Phases 1–3: validate, resolve, typeCheck, effectCheck, lint, patch, compose |
| **Full (compile)** | IIFE | **860.5 KB** | Phases 1–5: check + WASM codegen via pure-JS encoder |
| Browser check-only | ESM | 340.5 KB | Same scope as IIFE check bundle |
| Browser full | ESM | 811.4 KB | Full pipeline with WASM encoder |

The IIFE bundles are built by `scripts/build-quickjs-bundle.ts`. Node.js modules are shimmed to empty stubs via esbuild. Z3 is excluded entirely.

### Dependency Size Breakdown (estimated)

| Dependency | Size | Self-hostable? |
|------------|------|----------------|
| QuickJS engine (WASM) | ~1 MB | ✅ Host runtime |
| Edict compiler JS (full) | 860.5 KB | ✅ IIFE bundle |
| Edict compiler JS (check-only) | 365.7 KB | ✅ IIFE bundle |
| Z3 solver (WASM) | ~5 MB | ❌ Requires WebAssembly API + worker threads |

---

## Performance

| Metric | QuickJS (WASM) | Native (Node.js) | Ratio |
|--------|---------------|-------------------|-------|
| QuickJS init | 9.3 ms | — | — |
| Bundle load | 30.6 ms | — | — |
| `checkBrowser(fibonacci)` | **2.3 ms** | **0.6 ms** | **3.7x** |

- 5 runs, median values
- Platform: darwin-arm64 (Apple Silicon), Node v22.14.0
- Test program: `fibonacci.edict.json` (~40 AST nodes, recursive with contracts)
- Native Node.js uses JIT compilation; QuickJS is a pure interpreter in WASM — 3.7x is excellent

### Memory Footprint

| Category | Count | Size |
|----------|-------|------|
| Memory allocated | 12,823 blocks | ~100 KB |
| Memory used | — | **683 KB** |
| Atoms (interned strings) | 2,075 | ~82 KB |
| Objects | 3,770 | ~181 KB |
| Bytecode functions | 437 | ~219 KB |

---

## Remaining Blockers

### 1. Z3 — WebAssembly + Worker Threads (Critical)

The Z3 solver WASM package requires the `WebAssembly` API (QuickJS doesn't implement it) and worker threads for timeout handling.

**Impact**: Contract verification (phase 4) cannot run in QuickJS.

### 2. WASM Execution — No `WebAssembly` API (Critical)

QuickJS is a pure JavaScript interpreter — it does not implement the `WebAssembly` global. Compiled WASM bytes cannot be instantiated and executed inside QuickJS.

**Impact**: The compiler can produce WASM binaries inside QuickJS, but executing them requires a runtime with `WebAssembly` support (e.g., Node.js, browser, Deno).

### 3. Missing Web APIs (Mitigated)

QuickJS lacks `TextEncoder` and `TextDecoder`. These are polyfilled with minimal UTF-8 implementations (~40 lines) injected at startup. This is a solved problem.

### 4. No ESM Support (Mitigated)

QuickJS doesn't support `import`/`export`. Solved by using IIFE format bundles via esbuild.

---

## Paths to Full Self-Hosting

### Path A: QuickJS WebAssembly API (Watch)

The `quickjs-emscripten` project is working on WebAssembly API support. When available, WASM execution and Z3 might work with minimal changes.

**Pros**: Zero Edict changes needed, enables execution + contract verification
**Cons**: Uncertain timeline, may not support all WASM features
**Effort**: 0 (waiting only)

### Path B: QuickJS Bytecode Backend (Long-Term)

Add a QuickJS bytecode backend alongside WASM. The compiler runs in QuickJS, and programs compile to QuickJS bytecode for execution in the same runtime.

**Pros**: Fully self-contained, no external dependencies
**Cons**: New backend, not interoperable with non-QuickJS runtimes
**Effort**: 4–8 weeks

### Path C: V8 Isolates (Alternative)

Use V8 isolates (`isolated-vm`) instead of QuickJS. Full JavaScript and WebAssembly API compatibility at the cost of larger binary size.

**Pros**: Full API compatibility, JIT performance
**Cons**: Large binary (~40 MB), heavier runtime, not truly self-hosted in WASM
**Effort**: 2–3 weeks

---

## Recommended Strategy

1. **Now**: Ship check + compile self-hosting via `EdictQuickJS` (`src/quickjs/edict-quickjs.ts`). Phases 1–5 in 860.5 KB is immediately useful for compiling Edict programs in sandboxed/edge environments. The WASM output can be executed in any runtime with `WebAssembly` support.

2. **Watch**: Monitor QuickJS WebAssembly API progress (Path A). If it ships, WASM execution and Z3 contract verification become available with zero code changes.

---

## Files and Resources

| File | Purpose |
|------|---------|
| [`src/quickjs/edict-quickjs.ts`](../src/quickjs/edict-quickjs.ts) | `EdictQuickJS` class — check-only and full compile self-hosting |
| [`scripts/build-quickjs-bundle.ts`](../scripts/build-quickjs-bundle.ts) | esbuild script for IIFE bundles |
| [`tests/quickjs/quickjs-check.test.ts`](../tests/quickjs/quickjs-check.test.ts) | Integration tests (check + compile, 18 tests) |
| [`docs/quickjs-feasibility-report.md`](quickjs-feasibility-report.md) | Original feasibility study results |
| [`dist/edict-quickjs-check.js`](../dist/edict-quickjs-check.js) | Pre-built check-only IIFE bundle (365.7 KB) |
| [`dist/edict-quickjs-full.js`](../dist/edict-quickjs-full.js) | Pre-built full compile IIFE bundle (860.5 KB) |
