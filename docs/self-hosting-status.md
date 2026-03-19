# Self-Hosting Status — Edict Compiler in WASM

> Definitive status of WASM self-hosting: what works, what's shipped, and remaining limitations.

**Date**: 2026-03-19
**Parent issue**: [#81](https://github.com/Sowiedu/Edict/issues/81)
**Related**: [#134](https://github.com/Sowiedu/Edict/issues/134) (feasibility study), [#156](https://github.com/Sowiedu/Edict/issues/156) (check-only PoC), [#198](https://github.com/Sowiedu/Edict/issues/198) (binaryen replacement), [#200](https://github.com/Sowiedu/Edict/issues/200) (packaging), [#205](https://github.com/Sowiedu/Edict/issues/205)–[#208](https://github.com/Sowiedu/Edict/issues/208) (custom QF-LIA solver)

---

## Executive Summary

**The Edict compiler is fully self-hosted inside QuickJS-WASM.** The complete pipeline — schema validation, name resolution, type checking, effect checking, contract verification (QF-LIA), WASM codegen, and WASM execution — runs entirely within a QuickJS sandbox via `EdictQuickJS.compileAndRun()`.

This was achieved through three key innovations:
1. **Pure-JS WASM encoder** (#198) — replaced binaryen, enabling WASM codegen without `WebAssembly` API
2. **Built-in QF-LIA solver** (#205–#208) — replaced Z3 for quantifier-free linear arithmetic contracts
3. **Pure-JS WASM interpreter** — stack-based MVP interpreter enabling WASM execution without the `WebAssembly` API

The `EdictQuickJS` class provides three modes:
- **Check-only** (phases 1–3): schema validation, name resolution, type checking, effect checking at **3.7x slowdown** vs native Node.js, in a **365.7 KB** bundle.
- **Full compile** (phases 1–5): check + WASM codegen + contract verification (QF-LIA) in a **925 KB** bundle.
- **Compile and run** (phases 1–6): full self-hosting loop — JSON AST → check → compile → execute, all inside QuickJS.

Available as `edict-lang/quickjs` sub-export (#200). 2673 tests across 136 files.

---

## What Works

| Pipeline Stage | Status | Notes |
|----------------|--------|-------|
| Schema validation (phase 1) | ✅ Works | Full structural + semantic validation |
| Name resolution (phase 2a) | ✅ Works | Levenshtein suggestions included |
| Type checking (phase 2b) | ✅ Works | Bidirectional type inference |
| Effect checking (phase 3) | ✅ Works | Call-graph propagation |
| Contract verification (phase 4) | ⚡ Partial | QF-LIA contracts via built-in solver (#208) — quantified/array contracts degrade to `undecidable_predicate` |
| WASM codegen (phase 5) | ✅ Works | Pure-JS WASM encoder — no binaryen dependency |
| **WASM execution (phase 6)** | ✅ **Works** | **Pure-JS WASM interpreter — no `WebAssembly` API needed** |
| Lint engine | ✅ Works | Included in check bundle |
| Patch engine | ✅ Works | Surgical AST patching by nodeId |
| Fragment composition | ✅ Works | Composable program fragments |
| Compact AST expansion | ✅ Works | Token-efficient format support |
| Schema migration | ✅ Works | Auto-upgrade older ASTs |

### End-to-End Execution Proof

Programs compiled and executed entirely inside QuickJS-WASM via `compileAndRun()`:

| Program | Expected | Actual | Status |
|---------|----------|--------|--------|
| arithmetic.edict.json | `main()` → 7 | 7 | ✅ |
| fibonacci.edict.json | `main()` → 55 | 55 | ✅ |
| hello.edict.json | prints "Hello, World!" | output captured | ✅ |
| constants.edict.json | `main()` → 85 | 85 | ✅ |

---

## Bundle Sizes

| Bundle | Format | Size | Contents |
|--------|--------|------|----------|
| **Check-only** | IIFE | **365.7 KB** | Phases 1–3: validate, resolve, typeCheck, effectCheck, lint, patch, compose |
| **Full (compile + run)** | IIFE | **925 KB** | Phases 1–6: check + WASM codegen + QF-LIA contract verification + WASM interpreter |
| Browser check-only | ESM | 340.5 KB | Same scope as IIFE check bundle |
| Browser full | ESM | 811.4 KB | Full pipeline with WASM encoder |

The IIFE bundles are built by `scripts/build-quickjs-bundle.ts`. Node.js modules are shimmed to empty stubs via esbuild. Z3 is excluded entirely.

### Dependency Size Breakdown (estimated)

| Dependency | Size | Self-hostable? |
|------------|------|----------------|
| QuickJS engine (WASM) | ~1 MB | ✅ Host runtime |
| Edict compiler JS (full) | 925 KB | ✅ IIFE bundle (includes QF-LIA solver + WASM interpreter) |
| Edict compiler JS (check-only) | 365.7 KB | ✅ IIFE bundle |
| Z3 solver (WASM) | ~5 MB | ❌ Not needed for QF-LIA; required only for quantified/array contracts |

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

## Resolved Blockers

### 1. ~~Binaryen — top-level await + WebAssembly API~~ ✅ Resolved (#198)

Replaced with pure-JS WASM binary encoder. Edict codegen produces valid WASM MVP binaries without any native dependencies.

### 2. ~~Z3 — WebAssembly + Worker Threads~~ ✅ Resolved (#208)

Contract verification for QF-LIA (quantifier-free linear integer/boolean/real arithmetic) now runs via the built-in pure-JS solver. Full Z3 is only needed for quantified contracts (`forall`/`exists`) and array theory — these degrade gracefully to `undecidable_predicate` diagnostics.

### 3. ~~WASM Execution — No WebAssembly API~~ ✅ Resolved

A pure-JS WASM interpreter (`src/codegen/wasm-interpreter.ts`) parses and executes WASM binaries without the native `WebAssembly` API. The interpreter implements WASM MVP instructions including i32/i64 arithmetic, control flow, memory operations, function calls, and host import bridging.

### 4. Missing Web APIs → ✅ Mitigated

QuickJS lacks `TextEncoder` and `TextDecoder`. These are polyfilled with minimal UTF-8 implementations (~40 lines) injected at startup. Solved.

### 5. No ESM Support → ✅ Mitigated

QuickJS doesn't support `import`/`export`. Solved by using IIFE format bundles via esbuild.

---

## Known Limitations

### Interpreter Host Builtins

The WASM interpreter provides a minimal set of host builtins (`print`, `println`, basic arithmetic). Programs using advanced builtins (e.g., `array_map`, `array_get`, `array_filter`) will receive an `unimplemented host builtin` error. This can be extended by adding more builtins to the interpreter's host import set.

### Contract Verification Scope

The built-in QF-LIA solver covers quantifier-free linear integer/boolean/real arithmetic — this handles 100% of current example program contracts (14/14). Quantified contracts (`forall`/`exists`) and array theory contracts degrade to `undecidable_predicate` diagnostics. Full Z3 is available in Node.js/browser environments.

### Interpreter Performance

The WASM interpreter is slower than native `WebAssembly.instantiate()` execution. For production use where performance matters, compile inside QuickJS and execute the WASM output in a runtime with native `WebAssembly` support.

---

## Files and Resources

| File | Purpose |
|------|---------|
| [`src/quickjs/edict-quickjs.ts`](../src/quickjs/edict-quickjs.ts) | `EdictQuickJS` class — check, compile, run, compileAndRun |
| [`src/codegen/wasm-interpreter.ts`](../src/codegen/wasm-interpreter.ts) | Pure-JS WASM interpreter |
| [`scripts/build-quickjs-bundle.ts`](../scripts/build-quickjs-bundle.ts) | esbuild script for IIFE bundles |
| [`tests/quickjs/quickjs-check.test.ts`](../tests/quickjs/quickjs-check.test.ts) | Integration tests (check + compile + run + contracts) |
| [`tests/codegen/wasm-interpreter.test.ts`](../tests/codegen/wasm-interpreter.test.ts) | WASM interpreter unit tests (32 tests) |
| [`docs/quickjs-feasibility-report.md`](quickjs-feasibility-report.md) | Original feasibility study results |
| [`dist/edict-quickjs-check.js`](../dist/edict-quickjs-check.js) | Pre-built check-only IIFE bundle (365.7 KB) |
| [`dist/edict-quickjs-full.js`](../dist/edict-quickjs-full.js) | Pre-built full IIFE bundle (925 KB) |
