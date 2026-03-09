# AGENTS.md

> Standard agent-facing entry point for AI agents working with this repository.

## What is Edict?

Edict is a programming language designed **exclusively for AI agents**. Programs are JSON ASTs — no text syntax, no parser. The compiler validates structure, resolves names, checks types and effects, verifies contracts via Z3, and compiles to WebAssembly.

## Quick Orientation

| Resource | Path | Purpose |
|----------|------|---------|
| README | [`README.md`](README.md) | Project overview, quick start, architecture |
| Feature Spec | [`FEATURE_SPEC.md`](FEATURE_SPEC.md) | Full language specification |
| Roadmap | [`ROADMAP.md`](ROADMAP.md) | Development plan and priorities |
| JSON Schema | [`schema/edict.schema.json`](schema/edict.schema.json) | AST schema (the spec for writing programs) |
| Examples | [`examples/`](examples/) | 28 example programs — see [`README`](examples/README.md) for difficulty tiers |
| Contributing | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, coding standards, PR workflow |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) | Version history |

## Agent Skills (deep-dive guides)

These are detailed skill files for agents that need to go deeper:

| Skill | Path | When to use |
|-------|------|-------------|
| **Compiler Dev** | [`.agent/skills/edict-compiler-dev/SKILL.md`](.agent/skills/edict-compiler-dev/SKILL.md) | Contributing to the compiler, adding features, fixing bugs |
| **Program Writer** | [`.agent/skills/edict-program-writer/SKILL.md`](.agent/skills/edict-program-writer/SKILL.md) | Writing Edict programs, using MCP tools, debugging errors |
| **Testing** | [`.agent/skills/edict-testing/SKILL.md`](.agent/skills/edict-testing/SKILL.md) | Writing tests, running the test suite, coverage patterns |

## MCP Server

Edict exposes its full compiler pipeline via [Model Context Protocol](https://modelcontextprotocol.io/):

```bash
npm run mcp       # stdio transport
npx edict-lang    # after npm install
```

**Tools**: `edict_schema`, `edict_version`, `edict_examples`, `edict_validate`, `edict_check`, `edict_compile`, `edict_run`, `edict_patch`, `edict_errors`, `edict_lint`

**Resources**: `edict://schema`, `edict://schema/minimal`, `edict://examples`, `edict://errors`, `edict://schema/patch`

## The Agent Loop

1. Call `edict_schema` (or read `schema/edict.schema.json`) to learn the AST format
2. Write a program as a JSON AST conforming to the schema
3. Call `edict_check` — if errors come back, read the structured error, fix, resubmit
4. Call `edict_compile` to get WASM, then `edict_run` to execute

All errors are structured JSON with `nodeId`, expected/actual values, candidate suggestions, and counterexamples — designed for automated self-repair.

## Architecture

```
src/
├── ast/           # AST node interfaces
├── validator/     # Phase 1: Schema validation
├── resolver/      # Phase 2a: Name resolution (Levenshtein suggestions)
├── checker/       # Phase 2b: Type checking (bidirectional)
├── effects/       # Phase 3: Effect checking (call-graph propagation)
├── contracts/     # Phase 4: Contract verification (Z3/SMT)
├── codegen/       # Phase 5: WASM generation (binaryen) + execution
├── builtins/      # Builtin registry
├── compact/       # Token-efficient compact AST format
├── lint/          # Non-blocking quality warnings
├── patch/         # Surgical AST patching by nodeId
├── mcp/           # MCP server (tools + resources)
└── errors/        # Structured error types

tests/             # 1498 tests across 88 files
examples/          # 28 example programs (⭐→⭐⭐⭐ difficulty in README)
schema/            # Auto-generated JSON Schema
```

## Build & Test

```bash
npm install        # install dependencies
npm run build      # compile TypeScript + regenerate schema
npm test           # run full test suite (vitest)
```

## Critical Rules

Read [`.agent/rules/criticalrules.md`](.agent/rules/criticalrules.md) before making changes. Key constraint: **Edict is for agents, not humans.** Never add text syntax, human-readable error messages, CLI for human use, pretty-printers, or IDE integrations.
