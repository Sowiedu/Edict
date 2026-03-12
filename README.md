# Edict

[![CI](https://github.com/Sowiedu/Edict/actions/workflows/ci.yml/badge.svg)](https://github.com/Sowiedu/Edict/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8A2BE2)](https://modelcontextprotocol.io/)

<a href="https://glama.ai/mcp/servers/Sowiedu/Edict"><img width="380" height="200" src="https://glama.ai/mcp/servers/Sowiedu/Edict/badge" /></a>

**A programming language designed for AI agents.** No parser. No syntax. Agents produce AST directly as JSON.

Edict is a statically-typed, effect-tracked programming language where the canonical program format is a JSON AST. It's purpose-built so AI agents can write, verify, and execute programs through a structured pipeline — no text parsing, no human-readable syntax, no ambiguity.

```
Agent (LLM)
  │  produces JSON AST via MCP tool call
  ↓
Schema Validator ─── invalid? → StructuredError → Agent retries
  ↓
Name Resolver ────── undefined? → StructuredError + candidates → Agent retries
  ↓
Type Checker ─────── mismatch? → StructuredError + expected type → Agent retries
  ↓
Effect Checker ───── violation? → StructuredError + propagation chain → Agent retries
  ↓
Contract Verifier ── unproven? → StructuredError + counterexample → Agent retries
  (Z3/SMT)            ↓
                  Code Generator (binaryen) → WASM → Execute
```

## Features

- **JSON AST** — Programs are JSON objects, not text files. No lexer, no parser.
- **Structured errors** — Every error is a typed JSON object with enough context for an agent to self-repair.
- **Type system** — `Int`, `Float`, `String`, `Bool`, `Array<T>`, `Option<T>`, `Result<T,E>`, records, enums, refinement types.
- **Effect tracking** — Functions declare `pure`, `reads`, `writes`, `io`, `fails`. The compiler verifies consistency.
- **Contract verification** — Pre/post conditions verified at compile time by Z3 (via SMT). Failing contracts return concrete counterexamples.
- **WASM compilation** — Verified programs compile to WebAssembly via binaryen and run in Node.js.
- **MCP interface** — All tools exposed via [Model Context Protocol](https://modelcontextprotocol.io/) for direct agent integration.
- **Schema migration** — ASTs from older schema versions are auto-migrated. No breakage when the language evolves.

## Execution Model

Edict compiles to **WebAssembly** and runs in a sandboxed VM. This is a deliberate security decision — not a limitation:

- **No ambient authority** — compiled WASM cannot access the filesystem, network, or OS unless the host explicitly provides those capabilities via the pluggable `EdictHostAdapter` interface
- **Compile-time capability declaration** — the effect system (`io`, `reads`, `writes`, `fails`) lets the host inspect what a program requires _before_ running it
- **Runtime enforcement** — `RunLimits` controls execution timeout, memory ceiling, and filesystem sandboxing
- **Defense-in-depth** — agent-generated code that runs immediately needs stronger isolation than human-reviewed code. The effect system + WASM sandbox + host adapter pattern provides exactly that

Host capabilities available through adapters: filesystem (sandboxed), HTTP, crypto (SHA-256, MD5, HMAC), environment variables, CLI arguments. New capabilities are added by extending `EdictHostAdapter`.

## Quick Start

### For AI Agents (MCP)

The fastest way to use Edict is through the **MCP server** — it exposes the entire compiler pipeline as tool calls:

```bash
npx edict-lang          # start MCP server (stdio transport, no install needed)
```

Or install locally:

```bash
npm install edict-lang
npx edict-lang          # start MCP server
```

**Two calls to get started**: `edict_schema` (learn the AST format) → `edict_check` (submit a program). See [MCP Tools](#mcp-tools) for the full tool list.

### For Development

```bash
npm install
npm test          # 2000 tests across 115 files
npm run mcp       # start MCP server (stdio transport)
```

## Docker

Run the Edict MCP server in a container — no local Node.js required:

```bash
# stdio transport (default — for local MCP clients)
docker run -i ghcr.io/sowiedu/edict

# HTTP transport (for remote/networked MCP clients)
docker run -p 3000:3000 -e EDICT_TRANSPORT=http ghcr.io/sowiedu/edict
```

Supported platforms: `linux/amd64`, `linux/arm64`.

## Browser

Run the Edict compiler entirely in the browser — no server required:

| Bundle | Size | Phases | Use case |
|---|---|---|---|
| `edict-lang/browser` | 318 KB | 1–3 (validate, resolve, typecheck, effects, lint, patch) | Lightweight checking |
| `edict-lang/browser-full` | ~14 MB | 1–5 (+ binaryen codegen, Z3 contracts, WASM execution) | Full compile & run |

```javascript
import { compileBrowser, runBrowserDirect } from 'edict-lang/browser-full';

const result = compileBrowser(astJson);
if (result.ok) {
    const run = await runBrowserDirect(result.wasm);
    console.log(run.output);  // "Hello, World!"
}
```

> **Note**: ESM modules require HTTP serving. Use `npx serve .` or any static server — `file://` won't work.

See [`examples/browser/index.html`](examples/browser/index.html) for a working example.

## MCP Tools

| Tool | Description |
|---|---|
| `edict_schema` | Returns the full AST JSON Schema — the spec for how to write programs |
| `edict_version` | Returns compiler version and capability info |
| `edict_examples` | Returns 40 example programs as JSON ASTs |
| `edict_validate` | Validates AST structure (field names, types, node kinds) |
| `edict_check` | Full pipeline: validate → resolve names → type check → effect check → verify contracts |
| `edict_compile` | Compiles a checked AST to WASM (returns base64-encoded binary) |
| `edict_run` | Executes a compiled WASM binary, returns output and exit code |
| `edict_patch` | Applies targeted AST patches by nodeId and re-checks |
| `edict_errors` | Returns machine-readable catalog of all error types |
| `edict_lint` | Runs non-blocking quality analysis and returns warnings |
| `edict_debug` | Execution tracing and crash diagnostics |
| `edict_compose` | Combines composable program fragments into a module |
| `edict_explain` | Explains AST nodes, errors, or compiler behavior |
| `edict_export` | Packages a program as a UASF portable skill |
| `edict_import_skill` | Imports and executes a UASF skill package |
| `edict_generate_tests` | Generates tests from Z3-verified contracts |
| `edict_replay` | Records and replays deterministic execution traces |

### MCP Resources

| URI | Description |
|---|---|
| `edict://schema` | The full AST JSON Schema |
| `edict://schema/minimal` | Minimal schema variant for token-efficient bootstrap |
| `edict://examples` | All example programs |
| `edict://errors` | Machine-readable error catalog |
| `edict://schema/patch` | JSON Schema for the AST patch protocol |

## Example Program

A "Hello, World!" in Edict's JSON AST:

```json
{
  "kind": "module",
  "id": "mod-hello-001",
  "name": "hello",
  "imports": [],
  "definitions": [
    {
      "kind": "fn",
      "id": "fn-main-001",
      "name": "main",
      "params": [],
      "effects": ["io"],
      "returnType": { "kind": "basic", "name": "Int" },
      "contracts": [],
      "body": [
        {
          "kind": "call",
          "id": "call-print-001",
          "fn": { "kind": "ident", "id": "ident-print-001", "name": "print" },
          "args": [
            { "kind": "literal", "id": "lit-msg-001", "value": "Hello, World!" }
          ]
        },
        { "kind": "literal", "id": "lit-ret-001", "value": 0 }
      ]
    }
  ]
}
```

## The Agent Loop

The core design: an agent submits an AST → the compiler validates it → if wrong, returns a `StructuredError` with enough context for the agent to self-repair → the agent fixes it → resubmits.

```typescript
// 1. Agent reads the schema to learn the AST format
const schema = edict_schema();

// 2. Agent writes a program (may contain errors)
const program = agentWritesProgram(schema);

// 3. Compile — returns structured errors or WASM
const result = edict_compile(program);

if (!result.ok) {
  // 4. Agent reads errors and fixes the program
  //    Errors include: nodeId, expected type, candidates, counterexamples
  const fixed = agentFixesProgram(program, result.errors);
  // 5. Resubmit
  return edict_compile(fixed);
}

// 6. Run the WASM
const output = edict_run(result.wasm);
```

## Architecture

```
src/
├── ast/           # TypeScript interfaces for every AST node
├── validator/     # Schema validation (structural correctness)
├── resolver/      # Name resolution (scope-aware, with Levenshtein suggestions)
├── checker/       # Type checking (bidirectional, with unit types)
├── effects/       # Effect checking (call-graph propagation)
├── contracts/     # Contract verification (Z3/SMT integration)
├── codegen/       # WASM code generation (binaryen)
│   ├── codegen.ts       # AST → WASM module orchestration
│   ├── compile-expr.ts  # Expression compilation
│   ├── compile-*.ts     # Specialized compilers (calls, data, match, scalars)
│   ├── runner.ts        # WASM execution (Node.js WebAssembly API)
│   ├── host-adapter.ts  # EdictHostAdapter interface + platform adapters
│   ├── closures.ts      # Closure capture and compilation
│   ├── hof-generators.ts # Higher-order function WASM generators
│   ├── recording-adapter.ts # Execution recording for replay
│   ├── replay-adapter.ts  # Deterministic replay from recorded traces
│   └── string-table.ts  # String interning for WASM memory
├── builtins/      # Builtin registry and domain-specific builtins
├── compact/       # Compact AST format (token-efficient for agents)
├── compose/       # Composable program fragments
├── incremental/   # Incremental checking (dependency graph + diff)
├── lint/          # Non-blocking quality warnings
├── patch/         # Surgical AST patching by nodeId
├── migration/     # Schema version migration (auto-upgrade older ASTs)
├── mcp/           # MCP server (tools + resources + prompts)
└── errors/        # Structured error types

tests/             # 2000 tests across 115 files
examples/          # 40 example programs (⭐→⭐⭐⭐ difficulty in README)
schema/            # Auto-generated JSON Schema
```

## Type System

| Type | Example |
|---|---|
| Basic | `Int`, `Int64`, `Float`, `String`, `Bool` |
| Array | `Array<Int>` |
| Option | `Option<String>` |
| Result | `Result<String, String>` |
| Record | `Point { x: Float, y: Float }` |
| Enum | `Shape = Circle { radius: Float } \| Rectangle { w: Float, h: Float }` |
| Refinement | `{ i: Int \| i > 0 }` — predicates verified by Z3 |
| Function | `(Int, Int) -> Int` |

## Effect System

Functions declare their effects. The compiler enforces:

- A `pure` function cannot call an `io` function
- Effects propagate through the call graph
- Missing effects are detected and reported

Effects: `pure`, `reads`, `writes`, `io`, `fails`

## Contract Verification

Pre/post conditions are verified at compile time using Z3:

```json
{
  "kind": "post",
  "id": "post-001",
  "condition": {
    "kind": "binop", "id": "binop-001", "op": ">",
    "left": { "kind": "ident", "id": "ident-result-001", "name": "result" },
    "right": { "kind": "ident", "id": "ident-x-001", "name": "x" }
  }
}
```

Z3 either proves `unsat` (contract holds ✅) or returns `sat` with a concrete counterexample the agent can reason about.

## Contributing

We welcome contributions from agents and humans alike. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, coding standards, and the PR workflow.

**Looking for a place to start?** Check issues labeled [`good first issue`](https://github.com/Sowiedu/Edict/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full development plan, [FEATURE_SPEC.md](FEATURE_SPEC.md) for the language specification, and [Crystallized Intelligence](docs/crystallized-intelligence.md) for how agents store and reuse verified WASM skills.

## Support

Edict is free and open source under the MIT license. If your agents find it valuable, consider [sponsoring its development](https://github.com/sponsors/Sowiedu).

## License

[MIT](LICENSE)
