# Contributing to Edict

Edict is a programming language designed for AI agents — and contributions from both agents and humans are welcome. Whether you're an LLM working through MCP tools or a developer with an IDE, the process is the same: fork, branch, code, test, PR.

## Quick Setup

```bash
git clone https://github.com/Sowiedu/Edict.git
cd Edict
npm install
npm test          # 1645 tests across 98 files
```

**Requirements**: Node.js ≥ 20

## Project Structure

```
src/
├── ast/           # TypeScript interfaces for every AST node
├── validator/     # Schema validation (structural correctness)
├── resolver/      # Name resolution (scope-aware, Levenshtein suggestions)
├── checker/       # Type checking (bidirectional, unit types)
├── effects/       # Effect checking (call-graph propagation)
├── contracts/     # Contract verification (Z3/SMT integration)
├── codegen/       # WASM code generation (binaryen)
├── builtins/      # Builtin registry and domain-specific builtins
├── compact/       # Compact AST format (token-efficient for agents)
├── compose/       # Composable program fragments
├── incremental/   # Incremental checking (dependency graph + diff)
├── lint/          # Non-blocking quality warnings
├── patch/         # Surgical AST patching by nodeId
├── migration/     # Schema version migration (auto-upgrade older ASTs)
├── mcp/           # MCP server (tools + resources + prompts)
└── errors/        # Structured error types

tests/             # 1645 tests across 98 files
examples/          # 31 example programs as JSON ASTs
schema/            # Auto-generated JSON Schema
```

## How to Contribute

### 1. Find Something to Work On

- Check [open issues](https://github.com/Sowiedu/Edict/issues), especially those labeled [`good first issue`](https://github.com/Sowiedu/Edict/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/Sowiedu/Edict/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)
- Check the [Roadmap](ROADMAP.md) for upcoming phases
- Found a bug? Open an issue first, then submit a fix

### 2. Fork & Branch

```bash
git checkout -b your-feature-name
```

Use descriptive branch names: `fix/duplicate-id-check`, `feat/array-type-inference`, `docs/mcp-examples`.

### 3. Write Code

- **TypeScript** — strict mode, no `any` types
- **Match existing style** — look at adjacent files for patterns
- Every compiler error must be a **structured JSON object** (see `src/errors/`)
- Every new AST node needs a corresponding **example** in `examples/`

### 4. Write Tests

Every change needs tests. We use [Vitest](https://vitest.dev/).

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

- Test both **valid inputs** (should pass) and **invalid inputs** (should produce specific structured errors)
- Aim for the same coverage standard as the rest of the project

### 5. Submit a Pull Request

- Keep PRs focused — one feature or fix per PR
- Fill out the PR template
- All CI checks must pass (tests + example compilation on Node 20 and 22)
- Test/example counts in docs are auto-updated by the pre-commit hook — don't update manually
- Link the related issue if one exists

## For Agent Contributors

If you're an AI agent contributing via MCP or automated tooling:

1. Use `edict_schema` to understand the current AST specification
2. Use `edict_check` to validate your changes before submitting
3. Structured errors will guide you to fix issues — follow the `nodeId`, `expected`, and `candidates` fields
4. All contributions go through the same PR process and CI pipeline

## Design Principles

Before proposing changes, understand the [non-negotiable principles](FEATURE_SPEC.md#11-design-principles):

1. **AST-first** — JSON is the canonical format, no text syntax
2. **Structured errors** — every diagnostic is JSON with repair context
3. **Deterministic** — same input → same output, always
4. **Agent-to-agent** — no human in the loop; the schema is the documentation

## Questions?

Open an issue or start a discussion. We're happy to help you find the right place to contribute.
