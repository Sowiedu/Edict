---
name: edict-compiler-dev
description: >
  How to develop the Edict compiler — architecture, coding patterns, structured error conventions,
  and how to add new features end-to-end. Use this skill when contributing to the Edict TypeScript
  codebase, adding new AST node types, implementing new builtins, extending the compiler pipeline,
  fixing bugs in the validator/resolver/checker/effects/contracts/codegen, or working on the MCP
  server. Also use when someone asks about Edict's architecture or how the compiler works.
---

# Edict Compiler Development

Edict is a programming language designed **exclusively for AI agents**. Agents produce JSON AST, the compiler validates and returns structured errors, the agent self-repairs. No human in the loop.

## Critical Philosophy — The North Star

> **"If no human ever saw this, would I still build it this way?"**

Edict's moat is the bet that a language designed for agent cognition beats any language designed for human cognition. Every human-centric feature erodes this moat.

**Never build**: text syntax/parser, human-readable error messages, CLI for human use, pretty-printer, IDE/LSP integration, comments in AST, web playground/REPL.

**Priority order**: (1) minimize agent-compiler round-trips, (2) error actionability, (3) token efficiency, (4) correctness surface.

Read `.agent/rules/criticalrules.md` for the full set of hard boundaries.

---

## Architecture

```
src/
├── ast/           # TypeScript interfaces for every AST node (nodes.ts, types.ts)
├── validator/     # Phase 1: Schema validation (structural correctness)
├── resolver/      # Phase 2a: Name resolution (scope-aware, Levenshtein suggestions)
├── checker/       # Phase 2b: Type checking (bidirectional, unit types)
├── effects/       # Phase 3: Effect checking (call-graph propagation)
├── contracts/     # Phase 4: Contract verification (Z3/SMT integration)
├── codegen/       # Phase 5: WASM code generation (pure-JS encoder)
│   ├── codegen.ts    # AST → WASM compilation
│   ├── runner.ts     # WASM execution (Node.js WebAssembly API)
│   ├── builtins.ts   # Built-in functions (print, string ops)
│   └── string-table.ts  # String interning for WASM memory
├── mcp/           # Phase 6: MCP server (tools + resources)
│   ├── create-server.ts  # Tool/resource registration
│   ├── handlers.ts       # Tool handler implementations
│   └── server.ts         # Entry point (stdio + HTTP/SSE transports)
├── errors/        # Structured error types and constructors
│   └── structured-errors.ts
├── check.ts       # Full pipeline orchestrator (validate → resolve → check → effects → contracts)
├── compile.ts     # Compile + run convenience wrapper
└── index.ts       # Public API exports
```

## The Pipeline

Each stage runs in order. Errors from any stage halt the pipeline and return structured errors:

1. **Validator** — structural correctness (valid `kind`, required fields, valid IDs)
2. **Resolver** — name resolution (every identifier resolves to a declaration)
3. **Type Checker** — type consistency (bidirectional, supports unit types, refinement types)
4. **Effect Checker** — effect annotation consistency (propagation through call graph)
5. **Contract Verifier** — pre/postconditions proven via Z3 (returns counterexamples on failure)
6. **Code Generator** — AST → WASM via pure-JS encoder

The `check()` function in `src/check.ts` runs phases 1-5. The `compile()` function in `src/codegen/codegen.ts` runs phase 6.

---

## Structured Errors

Every error is a typed JSON object. **Never use prose/string messages.** Each error must have enough context for an agent to self-repair.

Error constructors live in `src/errors/structured-errors.ts`. Each constructor is a factory function returning a typed object.

**Pattern for adding a new error type:**

1. Add the TypeScript interface to `structured-errors.ts`
2. Add it to the `StructuredError` union type
3. Create a factory function (e.g., `export function myNewError(...)`)
4. Add a registry entry in `error-registry.ts` (type + stage + make)
5. Add examples in `error-catalog.ts` (example_cause + example_fix)
6. Export both the type and constructor from `src/index.ts`
7. Use the constructor in the relevant pipeline stage
8. Add tests

**Every error must include:**
- `error` — discriminator string (e.g., `"type_mismatch"`)
- `nodeId` — which AST node caused the error
- Enough context for the agent to fix it (expected vs actual, candidates, counterexamples)

---

## How to Add a New AST Node Type

1. **Define the interface** in `src/ast/nodes.ts` (or `src/ast/types.ts` for type nodes)
2. **Add to the union type** (`Definition`, `Expression`, `TypeExpr`, or `Pattern`)
3. **Validator** — add validation logic in `src/validator/validate.ts`
4. **Resolver** — handle in `src/resolver/resolve.ts` (resolve names within the new node)
5. **Type Checker** — handle in `src/checker/check.ts` (type inference/checking)
6. **Effect Checker** — handle if the node can introduce effects
7. **Contracts** — add Z3 translation if the node appears in predicates (`src/contracts/translate.ts`)
8. **Codegen** — add WASM generation in `src/codegen/codegen.ts`
9. **Schema** — regenerate: `npm run generate-schema`
10. **Schema Version** — bump `CURRENT_SCHEMA_VERSION` in `src/migration/migrate.ts`, run `npm run snapshot-schema` to save the new snapshot, then run `npm run diff-schemas` to auto-generate migration ops
11. **Examples** — add an example program using the new node
12. **Tests** — add tests for each pipeline stage
13. **Exports** — export the new type from `src/index.ts`

## Schema Migration

Edict auto-migrates agent ASTs from older schema versions. When the AST evolves:

1. Bump `CURRENT_SCHEMA_VERSION` in `src/migration/migrate.ts`
2. Run `npm run snapshot-schema` — stores current schema as `schema/snapshots/v{N}.json`
3. Run `npm run diff-schemas` — auto-generates migration ops by diffing snapshots
4. Migrations apply automatically in all pipeline entry points via `migrateToLatest()`

Migration ops are auto-derived: added properties → `add_field`, removed → `remove_field`. The `MIGRATION_REGISTRY` in `migrate.ts` can also hold manual overrides for complex transforms.

**Key files:** `src/migration/migrate.ts`, `scripts/diff-schemas.ts`, `scripts/snapshot-schema.ts`, `schema/snapshots/`

## How to Add a New Builtin Function

1. Add to `BUILTIN_FUNCTIONS` map in `src/codegen/builtins.ts`
2. Each builtin needs: name, param types, return type, effect, and WASM implementation
3. The resolver auto-registers builtins into the root scope
4. The type checker uses the param/return types from the builtin definition
5. Add tests in the codegen test files

---

## Host Adapter System

> **WASM sandboxing with explicit host bridging is a deliberate security feature, not a limitation.**
> Agent-generated code runs in an isolated WASM VM with zero ambient authority. Filesystem, network, and crypto access are only available through host-provided adapters. This is defense-in-depth: the effect system declares capabilities at compile time, the `EdictHostAdapter` controls what's actually available at runtime, and `RunLimits` enforces timeout/memory/sandbox constraints.

The host function layer uses a pluggable adapter pattern (`EdictHostAdapter`) to separate platform-specific operations from the WASM↔Host bridge.

**Architecture:**
```
createHostImports(state, adapter?)
  │
  ├── 12 platform-agnostic groups (Web Standard APIs — always shared)
  │   core, string, math, type-conversion, array, option, result,
  │   json, random, int64, datetime, regex
  │
  └── 3 platform-specific groups (delegated to adapter)
      crypto, HTTP, IO
```

**Available Adapters:**
- `NodeHostAdapter` — default, uses `node:crypto`, `node:fs`, `node:child_process`
- `BrowserHostAdapter` — stub with meaningful errors for unavailable operations

**How to implement a custom adapter:**
1. Create a class implementing `EdictHostAdapter` (from `src/codegen/host-adapter.ts`)
2. Implement all 10 methods: `sha256`, `md5`, `hmac`, `fetch`, `readFile`, `writeFile`, `env`, `args`, `exit`
3. Pass it via `RunLimits.adapter` or directly to `createHostImports(state, adapter)`

**Key files:** `src/codegen/host-adapter.ts`, `src/codegen/node-host-adapter.ts`, `src/codegen/browser-host-adapter.ts`, `src/codegen/host-functions.ts`

---

## Key Conventions

- **Node IDs**: Every AST node has a unique `id` string. Convention: `{kind}-{name}-{counter}` (e.g., `fn-main-001`, `param-n-001`)
- **Testing**: vitest, run with `npm test`. Test files live in `tests/` across subdirectories per pipeline stage
- **No human-facing output**: structured data only. No `console.log` in library code
- **TypeScript strict mode**: all code is strictly typed
- **Exports**: everything public goes through `src/index.ts`

---

## Reference Files

For the full language specification, read `FEATURE_SPEC.md` at the project root.
For the development roadmap, read `ROADMAP.md` at the project root.
For full critical rules, read `.agent/rules/criticalrules.md`.
