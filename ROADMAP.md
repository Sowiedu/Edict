# Edict Development Roadmap

> Implementation: **TypeScript** · Pipeline: **AST-first** · Users: **Agents only**
> Canonical format: **JSON AST** · Transmission: **MCP structured output**

---

## The Pipeline

No lexer. No parser. No human review. Agents produce AST directly as JSON.

```
Agent (LLM)
  │  produces structured AST (JSON via MCP tool call)
  ↓
Schema Validator ─── invalid? → StructuredError + template fix → Agent retries
  ↓ valid
Name Resolver ────── undefined? → StructuredError + candidates → Agent retries
  ↓ resolved
Type Checker ─────── mismatch? → StructuredError + expected type → Agent retries
  ↓ passes
Effect Checker ───── violation? → StructuredError + propagation chain → Agent retries
  ↓ passes
Contract Verifier ── unproven? → StructuredError + counterexample → Agent retries
  (Z3/SMT)            ↓ proven
                  Code Generator (binaryen)
                       ↓
                  WASM binary → Execute (Node WASM runtime)
```

**The core loop**: Agent submits AST → compiler validates → if wrong, return a `StructuredError` with enough context for the agent to self-repair → agent fixes → resubmit.

**Agent onboarding**: The agent receives the AST schema (TypeScript interfaces) and 40 example programs as part of its system prompt or MCP resource. No documentation needed — the schema *is* the spec.

---

## Canonical Format

The canonical representation of an Edict program is a **JSON object** conforming to the AST schema. There are no `.ed` text files.

- **Storage**: JSON files (`.edict.json`) or database records
- **Transmission**: JSON over MCP tool calls
- **Versioning**: Git-compatible (JSON diffs are readable enough for version control)
- **Identity**: Each AST node carries a stable `id` field for targeted error reporting and patching

---

## Phase 1: AST Schema & Validator ✅
**What**: Define every valid Edict program as TypeScript interfaces + a runtime validator.

**Deliverables**:
- TypeScript interfaces for every AST node
- A `validate(ast: unknown): EdictModule | StructuredError[]` function
- JSON Schema auto-generated via `typescript-json-schema` for agent consumption

**Example AST node**:
```typescript
interface FunctionDef {
  kind: "fn"
  id: string                  // stable node ID for error targeting
  name: string
  params: Param[]
  effects: Effect[]           // "pure" | "reads" | "writes" | "io" | "fails"
  returnType: TypeExpr
  contracts: Contract[]
  body: Expression[]
}

interface RefinedType {
  kind: "refined"
  id: string
  base: string
  variable: string
  predicate: Expression
}

interface Contract {
  kind: "pre" | "post"
  id: string
  condition: Expression
}
```

**Edge cases handled**:
- Duplicate node IDs → validator rejects with `"duplicate_id"` error
- Unknown `kind` values → validator rejects with `"unknown_node_kind"` + list of valid kinds
- Missing required fields → validator rejects with `"missing_field"` + field name and expected type

> **Time**: 2–3 weeks
> **Verification**: Unit tests for every AST node type — valid and invalid inputs. 100% branch coverage on the validator.

---

## Phase 2: Name Resolution + Type Checker ✅
**What**: Walk the AST and verify all names resolve and types are consistent.

### 2a. Name Resolution
- Every identifier reference must point to a declared name (function, parameter, type)
- Cross-module references resolved via the module system (see below)
- **Error**: `"undefined_reference"` with `candidates` field listing similar names (Levenshtein distance)

### 2b. Type Checker (build incrementally)
1. **Basic types**: `Int`, `Float`, `String`, `Bool`, `Array<T>`, `Option<T>`
2. **Semantic units**: `currency<usd>`, `temp<celsius>` — can't mix incompatible units
3. **Refinement types**: `{i: Int | i != 0}` — predicates recorded, checked in Phase 4
4. **Type inference**: Fill in types the agent omitted (where unambiguous)

**Error output** (structured, never text):
```typescript
{
  error: "type_mismatch",
  location: { nodeId: "fn_convert_param_1" },
  expected: { kind: "unit_type", base: "Float", unit: "usd" },
  actual: { kind: "unit_type", base: "Float", unit: "eur" },
  hint: "Parameter expects currency<usd> but received currency<eur>"
}
```

> **Time**: 4–6 weeks
> **Verification**: Test suite of ~50 programs: 25 valid (should pass), 25 invalid (should produce specific errors). Each error category tested.

---

## Phase 3: Effect Checker ✅
**What**: Verify effect annotations are consistent through the call graph.

**Effect categories** (canonical strings):
- `"pure"` — no side effects
- `"reads"` — reads external state
- `"writes"` — mutates external state
- `"io"` — network, disk, or system calls
- `"fails"` — can throw/return error

**Rules**:
- A `"pure"` function cannot call an `"io"` or `"fails"` function
- Effects propagate: if `foo` calls `bar` with effect `"io"`, then `foo` must also declare `"io"`
- Missing effect annotations are inferred and reported as warnings

**Edge case**: Circular call graphs (A calls B calls A). Resolved by iterative fixed-point analysis — propagate effects until no changes occur.

> **Time**: 1–2 weeks
> **Verification**: Test cases for effect propagation chains, circular calls, and missing annotations.

---

## Phase 4: Contract Verifier (Z3 Integration) ✅
**What**: Take `[pre]` and `[post]` contracts, translate to SMT formulas, prove them with Z3.

**How it works**:
1. Extract contracts from AST
2. Translate Edict expressions → Z3 expressions (arithmetic, boolean, array operations)
3. Query Z3: "Is there any input satisfying the precondition where the postcondition fails?"
4. Z3 says `unsat` → contract proven ✅
5. Z3 says `sat` + model → return structured error with concrete counterexample values

**Dependency**: `z3-solver` npm package (Z3 compiled to WASM, runs in Node.js)

**Build incrementally**:
1. Arithmetic predicates (`x > 0`, `a != b`)
2. Boolean logic (`and`, `or`, `implies`, `not`)
3. Array properties (`arr.length > 0`)
4. Quantifiers (`forall i in 0..n: arr[i] > 0`) — limited support

**Edge cases**:
- **Z3 timeout**: Set a 5-second timeout per contract. If exceeded, report `"verification_timeout"` with the contract that couldn't be proven. Agent can simplify the contract or add intermediate lemmas.
- **Undecidable predicates**: Some predicates (e.g., involving non-linear arithmetic) may be outside Z3's decidable fragment. Report `"undecidable_predicate"` with guidance to simplify.

> **Time**: 4–6 weeks
> **Verification**: 20 contracts that should prove, 10 that should fail with known counterexamples, 5 that should timeout.

---

## Phase 5: WASM Code Generator ✅
**What**: Translate verified AST → WASM bytecode via `binaryen` (npm).

**Memory model**: Edict targets the **WASM GC proposal** (reference types + garbage collection). No manual memory management. If WASM GC support is insufficient, fall back to linear memory with a simple bump allocator + arena pattern.

**Build incrementally**:
1. Arithmetic expressions and local variables
2. Function definitions and calls
3. Conditionals and pattern matching
4. Arrays and data structures (via WASM GC structs or linear memory)
5. IO effects (via WASI interface)

**Execution**: Run WASM output via Node.js built-in `WebAssembly` API.

> **Time**: 4–8 weeks
> **Verification**: Compile and execute the same 25 valid test programs from Phase 2. Compare output against expected values.

---

## Phase 6: MCP Toolchain (Agent Interface) ✅
**What**: An MCP server exposing Edict's compiler as tools.

**Tools exposed**:
```
edict.schema()          → JSON Schema (the full AST spec)
edict.version()         → Compiler version and capability info
edict.examples()        → 40 example programs as AST JSON
edict.validate(ast)     → StructuredError[] | "ok"
edict.check(ast)        → StructuredError[] | "ok"       // types + effects + contracts
edict.compile(ast)      → { wasm: Base64 } | StructuredError[]
edict.run(wasm)         → { output: string, exitCode: number }
edict.patch(ast, ops)   → Apply targeted AST patches by nodeId and re-check
edict.errors()          → Machine-readable catalog of all error types
edict.lint(ast)         → Non-blocking quality warnings
```

**The full agent loop**:
```
Agent: edict.schema()
Edict: { /* full JSON Schema */ }

Agent: edict.compile({ kind: "module", ... })
Edict: { errors: [{ error: "type_mismatch", nodeId: "...", expected: ..., actual: ... }] }

Agent: edict.compile({ kind: "module", ... })   // fixed version
Edict: { wasm: "AGFzbQEAAAA..." }

Agent: edict.run("AGFzbQEAAAA...")
Edict: { output: "42", exitCode: 0 }
```

> **Time**: 2–3 weeks
> **Verification**: End-to-end test: give an LLM the schema, ask it to write a program, compile and run it via MCP tools.

---

## Module System

Multi-file programs use a simple module system:

- Each module is one JSON AST with `kind: "module"` and a `name` field
- Imports reference other modules by name: `{ kind: "import", module: "math", names: ["sqrt", "pi"] }`
- The compiler receives all modules at once (no filesystem dependency resolution)
- Circular imports are rejected at the name resolution phase

---

## Timeline

| Phase | What | Status |
|---|---|---|
| **1** | AST Schema + Validator | ✅ Complete |
| **2** | Name Resolution + Type Checker | ✅ Complete |
| **3** | Effect Checker | ✅ Complete |
| **4** | Contract Verifier (Z3) | ✅ Complete |
| **5** | WASM Code Gen | ✅ Complete |
| **6** | MCP Toolchain | ✅ Complete |

All 6 phases are implemented and shipping (v1.14.0+). 2245+ tests across 122 test files. 40 example programs.

---

## What We Dropped (and Why)

| Dropped | Why |
|---|---|
| Lexer & Parser | Agents produce AST directly as JSON |
| Text-based `.ed` files | JSON AST is the canonical format |
| Human-readable errors | All errors are structured JSON |
| CLI interface | MCP protocol is the interface |
| Pretty printer | No human review path |
| LLVM backend | WASM first; LLVM is a future optimization |
| Fix suggestion engine | Replaced by rich error context (expected types, candidates, counterexamples) that agents can reason about directly |

---

## Open Challenges

With the full pipeline operational, these are the open areas for further development:

| Area | Issues | Impact |
|---|---|---|
| **Mid-level IR** | #89 | Introduce IR between AST and WASM for optimizations and retargetability. |
| **Effect polymorphism** | #94 | ✅ Complete — effect variables in fn_type, inference at call sites, codegen (erased). |
| **Edge deployment** | #77 | Deploy compiled WASM to Cloudflare Workers, Deno Deploy, etc. |
| **Deploy pipeline** | #78 | One-step `edict_deploy` MCP tool: AST → WASM → live service. |
| **Self-hosting** | #81 | Compile the Edict compiler itself to WASM (moonshot). |

### Recently Completed

| Area | Issues | Outcome |
|---|---|---|
| **Type system reconciliation** | #87 ✅ | Resolved via honest monomorphism: `unsupported_container` lint warning derived from builtin registry. |
| **Browser compilation** | #75 ✅ | Full pipeline in browser: phases 1-5, binaryen codegen, Z3 contract verification, WASM execution. |
