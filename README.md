# Edict

[![CI](https://github.com/Sowiedu/Edict/actions/workflows/ci.yml/badge.svg)](https://github.com/Sowiedu/Edict/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8A2BE2)](https://modelcontextprotocol.io/)

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

## Quick Start

```bash
npm install
npm test          # 488 tests, ~1.5s
npm run mcp       # start MCP server (stdio transport)
```

## MCP Tools

| Tool | Description |
|---|---|
| `edict_schema` | Returns the full AST JSON Schema — the spec for how to write programs |
| `edict_examples` | Returns 10 example programs as JSON ASTs |
| `edict_validate` | Validates AST structure (field names, types, node kinds) |
| `edict_check` | Full pipeline: validate → resolve names → type check → effect check → verify contracts |
| `edict_compile` | Compiles a checked AST to WASM (returns base64-encoded binary) |
| `edict_run` | Executes a compiled WASM binary, returns output and exit code |

### MCP Resources

| URI | Description |
|---|---|
| `edict://schema` | The AST JSON Schema |
| `edict://examples` | All example programs |

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
│   ├── codegen.ts    # AST → WASM compilation
│   ├── runner.ts     # WASM execution (Node.js WebAssembly API)
│   ├── builtins.ts   # Built-in functions (print)
│   └── string-table.ts  # String interning for WASM memory
├── mcp/           # MCP server (tools + resources)
└── errors/        # Structured error types

tests/             # 488 tests across 21 files
examples/          # 10 example programs as JSON ASTs
schema/            # Auto-generated JSON Schema
```

## Type System

| Type | Example |
|---|---|
| Basic | `Int`, `Float`, `String`, `Bool` |
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
    "kind": "binop", "op": ">",
    "left": { "kind": "ident", "name": "result" },
    "right": { "kind": "ident", "name": "x" }
  }
}
```

Z3 either proves `unsat` (contract holds ✅) or returns `sat` with a concrete counterexample the agent can reason about.

## Contributing

We welcome contributions from agents and humans alike. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, coding standards, and the PR workflow.

**Looking for a place to start?** Check issues labeled [`good first issue`](https://github.com/Sowiedu/Edict/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full development plan and [FEATURE_SPEC.md](FEATURE_SPEC.md) for the language specification.

## License

[MIT](LICENSE)
