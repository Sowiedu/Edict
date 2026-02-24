# Edict Feature Specification v1

> **Status**: Phase 1 — AST Schema & Validator
> **Implementation**: TypeScript · **Pipeline**: AST-first · **Users**: Agents only
> **Canonical format**: JSON AST · **Interface**: MCP structured output

---

## 1. Vision

Edict is a programming language designed exclusively for AI agents. No human writes Edict. No human reads Edict source. Agents produce programs as JSON AST, a compiler validates and transforms them with structured error feedback, and the agent self-corrects in a closed loop — no human in the loop.

The core differentiator: **every existing language was designed for human cognition**. Edict is designed for _agent cognition_ — optimized for what LLMs are good at (structured output, schema conformance, iterative refinement) and protected against what they're bad at (semantic errors, resource leaks, unchecked edge cases).

---

## 1.1 Design Decisions

These decisions were made by the agent (the primary user of this language). Rationale documented for future-me.

| Decision | Choice | Rationale |
|---|---|---|
| **User-defined data structures** | Records & Enums in Phase 1 | You can't write any real program without structs. Deferring this would make Phase 1 useless. |
| **Refinement type predicates** | Open (any `Expression`) | The AST should not encode Z3's capabilities. Keep predicates general; the contract verifier (Phase 4) reports `undecidable_predicate` for what it can't prove. Mixing concerns is worse than accepting some predicates will be rejected later. |
| **Compilation target** | WASM only | LLVM is premature optimization. WASM gives sandboxing (critical for agent-generated code), portability, and faster iteration. LLVM can be Phase 7 if performance demands it. |
| **Exhaustive pattern matching** | Required | One of my biggest error sources is missing edge cases. The compiler must reject non-exhaustive matches. |
| **Result type** | Built-in (not user-defined) | Error handling is too important to leave to user definition. `Result<T, E>` is first-class, interacts with the `"fails"` effect. |
| **JSON AST vs. compact syntax** | JSON AST | The research noted JSON is token-inefficient for reading, but I *produce* structured output natively. JSON is my native medium. The token cost is only relevant when reading code back (context window), and the schema is compact enough for that. |
| **Node IDs** | UUID-style, agent-generated | I generate the IDs when producing the AST. This gives me stable handles for targeted fixes when errors come back. |
| **Contracts** | Optional per function (not mandatory) | The roadmap said contracts are first-class. But making them mandatory on every function creates ceremony that slows me down. Contracts should be available and encouraged, not forced. The compiler can warn about missing contracts on public functions. |

---

## 2. Architecture

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

**No lexer. No parser.** Agents produce AST directly as JSON. The schema _is_ the spec.

---

## 3. Canonical Format

The canonical representation of an Edict program is a **JSON object** conforming to the AST schema. There are no text source files.

- **Storage**: `.edict.json` files or database records
- **Transmission**: JSON over MCP tool calls
- **Versioning**: Git-compatible (JSON diffs)
- **Identity**: Every AST node carries a stable `id` field for targeted error reporting and patching

---

## 4. Language Features

### 4.1 Type System

> Inspiration: F# Units of Measure, Liquid Haskell Refinement Types, Idris Dependent Types

#### Basic Types
`Int`, `Float`, `String`, `Bool`, `Array<T>`, `Option<T>`

#### Semantic Unit Types
Types carry domain meaning — not just structure. Prevents the entire class of "wrong units" bugs.

```typescript
// These are all Float at runtime, but distinct at compile time
currency<usd>, currency<eur>
temp<celsius>, temp<fahrenheit>
distance<meters>, distance<miles>
```

**Enforcement**: Adding `currency<usd>` to `temp<celsius>` is a compile error. Units compose through arithmetic: `distance / time = speed<m/s>`.

**Zero runtime cost**: Units are erased after type checking.

#### Refinement Types
Standard types decorated with logical predicates, verified by SMT solver (Z3).

```typescript
// A positive integer
{v: Int | v > 0}

// A non-zero divisor
{i: Int | i != 0}

// A non-empty array
{a: Array<T> | a.length > 0}
```

**Key insight**: Refinement types + Z3 = automated formal verification that agents can actually use. No proof tactics, no manual annotations. The agent writes `fn divide(a: Int, b: {Int | b != 0}) -> Float` and the compiler _proves_ no caller can pass zero.

#### Type Inference
Where unambiguous, the type checker fills in types the agent omitted. Reduces boilerplate without sacrificing safety.

---

### 4.2 Effect System

> Inspiration: Koka algebraic effects, simplified to 5 categories

Every function declares what it _does_ — not just what it returns. Effects are part of the function signature.

| Effect | Meaning |
|---|---|
| `"pure"` | No side effects |
| `"reads"` | Reads external state |
| `"writes"` | Mutates external state |
| `"io"` | Network, disk, or system calls |
| `"fails"` | Can throw/return error |

**Rules**:
- A `"pure"` function cannot call an `"io"` or `"fails"` function
- Effects propagate: if `foo` calls `bar` with effect `"io"`, then `foo` must also declare `"io"`
- Missing effect annotations are inferred and reported as warnings
- Circular call graphs resolved via iterative fixed-point analysis

**AST representation**:
```json
{
  "kind": "fn",
  "name": "fetch_data",
  "effects": ["io", "fails"],
  "params": [{"name": "url", "type": {"kind": "basic", "name": "String"}}],
  "returnType": {"kind": "basic", "name": "String"},
  "body": []
}
```

---

### 4.3 Contract System

> Inspiration: Eiffel Design by Contract, Dafny automated verification

Preconditions and postconditions are first-class language constructs, not optional annotations. Every function can declare what must be true _before_ it runs and what it promises _after_.

```json
{
  "kind": "fn",
  "name": "binary_search",
  "params": [
    {"name": "arr", "type": {"kind": "array", "element": "Int"}},
    {"name": "target", "type": {"kind": "basic", "name": "Int"}}
  ],
  "returnType": {"kind": "basic", "name": "Option<Int>"},
  "contracts": [
    {"kind": "pre", "condition": {"kind": "call", "fn": "sorted", "args": ["arr"]}},
    {"kind": "pre", "condition": {"kind": "binop", "op": ">", "left": {"kind": "access", "target": "arr", "field": "length"}, "right": {"kind": "literal", "value": 0}}},
    {"kind": "post", "condition": "..."}
  ],
  "body": []
}
```

**Verification flow**:
1. Extract contracts from AST
2. Translate Edict expressions → Z3 expressions (arithmetic, boolean, array ops)
3. Query Z3: "Is there any input satisfying the precondition where the postcondition fails?"
4. `unsat` → contract proven ✅
5. `sat` + model → structured error with concrete counterexample values

**Edge cases**:
- **Z3 timeout** (5s limit per contract): Report `"verification_timeout"` — agent can simplify the contract or add intermediate lemmas
- **Undecidable predicates**: Report `"undecidable_predicate"` with guidance to simplify

---

### 4.4 Module System

- Each module is one JSON AST with `kind: "module"` and a `name` field
- Imports reference other modules by name: `{ kind: "import", module: "math", names: ["sqrt", "pi"] }`
- The compiler receives all modules at once (no filesystem dependency resolution)
- Circular imports rejected at name resolution phase

---

## 5. AST Schema (Phase 1 — First Deliverable)

The entire language is defined as TypeScript interfaces. The schema _is_ the specification.

### 5.1 Core Node Types

```typescript
// Top level
interface EdictModule {
  kind: "module"
  id: string
  name: string
  imports: Import[]
  definitions: Definition[]
}

interface Import {
  kind: "import"
  id: string
  module: string
  names: string[]
}

// Definitions
type Definition = FunctionDef | TypeDef | RecordDef | EnumDef | ConstDef

interface FunctionDef {
  kind: "fn"
  id: string
  name: string
  params: Param[]
  effects: Effect[]
  returnType: TypeExpr
  contracts: Contract[]
  body: Expression[]
}

interface TypeDef {
  kind: "type"
  id: string
  name: string
  definition: TypeExpr
}

interface ConstDef {
  kind: "const"
  id: string
  name: string
  type: TypeExpr
  value: Expression
}

// Records (structs)
interface RecordDef {
  kind: "record"
  id: string
  name: string
  fields: RecordField[]
}

interface RecordField {
  kind: "field"
  id: string
  name: string
  type: TypeExpr
  defaultValue?: Expression
}

// Enums (sum types / tagged unions)
interface EnumDef {
  kind: "enum"
  id: string
  name: string
  variants: EnumVariant[]
}

interface EnumVariant {
  kind: "variant"
  id: string
  name: string
  fields: RecordField[]   // empty for unit variants like None
}

// Parameters
interface Param {
  kind: "param"
  id: string
  name: string
  type: TypeExpr
}

// Effects
type Effect = "pure" | "reads" | "writes" | "io" | "fails"

// Contracts
interface Contract {
  kind: "pre" | "post"
  id: string
  condition: Expression
}

// Types
type TypeExpr =
  | BasicType
  | ArrayType
  | OptionType
  | ResultType
  | UnitType
  | RefinedType
  | FunctionType
  | NamedType       // reference to a RecordDef or EnumDef
  | TupleType

interface BasicType {
  kind: "basic"
  name: "Int" | "Float" | "String" | "Bool"
}

interface ArrayType {
  kind: "array"
  element: TypeExpr
}

interface OptionType {
  kind: "option"
  inner: TypeExpr
}

interface UnitType {
  kind: "unit_type"
  base: "Int" | "Float"
  unit: string       // "usd", "celsius", "meters", etc.
}

interface RefinedType {
  kind: "refined"
  id: string
  base: TypeExpr
  variable: string
  predicate: Expression
}

interface ResultType {
  kind: "result"
  ok: TypeExpr
  err: TypeExpr
}

interface NamedType {
  kind: "named"
  name: string       // references a RecordDef or EnumDef by name
}

interface TupleType {
  kind: "tuple"
  elements: TypeExpr[]
}

interface FunctionType {
  kind: "fn_type"
  params: TypeExpr[]
  effects: Effect[]
  returnType: TypeExpr
}

// Expressions
type Expression =
  | Literal
  | Identifier
  | BinaryOp
  | UnaryOp
  | Call
  | IfExpr
  | LetExpr
  | MatchExpr
  | ArrayExpr
  | TupleExpr
  | RecordExpr
  | EnumConstructor
  | FieldAccess
  | LambdaExpr
  | BlockExpr

interface Literal {
  kind: "literal"
  id: string
  value: number | string | boolean
  type?: TypeExpr
}

interface Identifier {
  kind: "ident"
  id: string
  name: string
}

interface BinaryOp {
  kind: "binop"
  id: string
  op: "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "and" | "or" | "implies"
  left: Expression
  right: Expression
}

interface UnaryOp {
  kind: "unop"
  id: string
  op: "not" | "-"
  operand: Expression
}

interface Call {
  kind: "call"
  id: string
  fn: string
  args: Expression[]
}

interface IfExpr {
  kind: "if"
  id: string
  condition: Expression
  then: Expression[]
  else: Expression[]
}

interface LetExpr {
  kind: "let"
  id: string
  name: string
  type?: TypeExpr
  value: Expression
}

interface MatchExpr {
  kind: "match"
  id: string
  target: Expression
  arms: MatchArm[]
}

interface MatchArm {
  kind: "arm"
  id: string
  pattern: Pattern
  body: Expression[]
}

type Pattern =
  | { kind: "literal_pattern"; value: number | string | boolean }
  | { kind: "wildcard" }
  | { kind: "binding"; name: string }
  | { kind: "constructor"; name: string; fields: Pattern[] }

interface ArrayExpr {
  kind: "array"
  id: string
  elements: Expression[]
}

interface FieldAccess {
  kind: "access"
  id: string
  target: Expression
  field: string
}

interface TupleExpr {
  kind: "tuple_expr"
  id: string
  elements: Expression[]
}

interface RecordExpr {
  kind: "record_expr"
  id: string
  name: string         // name of the RecordDef
  fields: { name: string; value: Expression }[]
}

interface EnumConstructor {
  kind: "enum_constructor"
  id: string
  enumName: string     // name of the EnumDef
  variant: string      // name of the variant
  fields: { name: string; value: Expression }[]
}

interface LambdaExpr {
  kind: "lambda"
  id: string
  params: Param[]
  body: Expression[]
}

interface BlockExpr {
  kind: "block"
  id: string
  body: Expression[]   // last expression is the return value
}
```

### 5.2 Structured Errors

Every compiler error is a structured JSON object. No human-readable strings. Each error provides enough context for an agent to self-repair.

```typescript
type StructuredError =
  | DuplicateIdError
  | UnknownNodeKindError
  | MissingFieldError
  | UndefinedReferenceError
  | TypeMismatchError
  | EffectViolationError
  | ContractFailureError
  | VerificationTimeoutError

interface DuplicateIdError {
  error: "duplicate_id"
  nodeId: string
  firstOccurrence: string    // path in AST
  secondOccurrence: string
}

interface UnknownNodeKindError {
  error: "unknown_node_kind"
  nodeId: string
  received: string
  validKinds: string[]
}

interface MissingFieldError {
  error: "missing_field"
  nodeId: string
  field: string
  expectedType: string
}

interface UndefinedReferenceError {
  error: "undefined_reference"
  nodeId: string
  name: string
  candidates: string[]       // similar names (Levenshtein)
}

interface TypeMismatchError {
  error: "type_mismatch"
  nodeId: string
  expected: TypeExpr
  actual: TypeExpr
  hint: string
}

interface EffectViolationError {
  error: "effect_violation"
  nodeId: string
  callerEffects: Effect[]
  calleeEffects: Effect[]
  propagationChain: string[] // nodeIds showing the call path
}

interface ContractFailureError {
  error: "contract_failure"
  contractId: string
  counterexample: Record<string, unknown>  // concrete values that break the contract
}

interface VerificationTimeoutError {
  error: "verification_timeout"
  contractId: string
  timeoutMs: number
  suggestion: "simplify_predicate" | "add_lemma"
}
```

---

## 6. MCP Tool Interface

The complete agent interface. An MCP server exposing the Edict compiler as tools.

```
edict.schema()          → JSON Schema (the full AST spec)
edict.examples()        → 10 example programs as AST JSON
edict.validate(ast)     → StructuredError[] | "ok"
edict.check(ast)        → StructuredError[] | "ok"         // types + effects + contracts
edict.compile(ast)      → { wasm: Base64 } | StructuredError[]
edict.run(wasm)         → { output: string, exitCode: number }
```

**Example agent session**:
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

**Agent onboarding**: The agent receives the AST schema (TypeScript interfaces) and 5–10 few-shot example programs as part of its system prompt or MCP resource. No documentation needed — the schema _is_ the spec.

---

## 7. WASM Code Generation

- **Target**: WASM bytecode via `binaryen` (npm)
- **Memory model**: WASM GC proposal (reference types + garbage collection). No manual memory management. Fallback: linear memory with bump allocator + arena pattern
- **Execution**: Node.js built-in `WebAssembly` API

**Incremental build order**:
1. Arithmetic expressions and local variables
2. Function definitions and calls
3. Conditionals and pattern matching
4. Arrays and data structures (via WASM GC structs or linear memory)
5. IO effects (via WASI interface)

---

## 8. What We Explicitly Don't Build

| Dropped | Rationale |
|---|---|
| Lexer & Parser | Agents produce AST directly as JSON |
| Text-based `.ed` files | JSON AST is the canonical format |
| Human-readable errors | All errors are structured JSON |
| CLI interface | MCP protocol is the only interface |
| Pretty printer | No human review path |
| LLVM backend | WASM first; LLVM is a future optimization |
| Fix suggestion engine | Rich error context (expected types, candidates, counterexamples) replaces explicit fix suggestions |
| Intent-driven programming | Precision over ambiguity — agents write logic, not wishes |
| Self-learning runtime | Deterministic execution. Same input → same output. Always. |

---

## 9. Phased Delivery

| Phase | Deliverable | Duration | Cumulative |
|---|---|---|---|
| **1** | AST Schema + Validator | 2–3 weeks | ~3 weeks |
| **2** | Name Resolution + Type Checker | 4–6 weeks | ~9 weeks |
| **3** | Effect Checker | 1–2 weeks | ~11 weeks |
| **4** | Contract Verifier (Z3) | 4–6 weeks | ~17 weeks |
| **5** | WASM Code Generator | 4–8 weeks | ~25 weeks |
| **6** | MCP Toolchain | 2–3 weeks | ~28 weeks |

**MVP** (Phases 1–3): ~11 weeks — agents can produce, validate, type-check, and effect-check Edict programs with structured error feedback.

**Full pipeline** (Phases 1–6): ~7 months — agents write, verify, compile, and run Edict programs end-to-end via MCP.

---

## 10. Phase 1 Acceptance Criteria

Phase 1 is complete when:

- [x] TypeScript interfaces exist for every AST node type listed in §5.1
- [x] JSON Schema auto-generated via `typescript-json-schema` for agent consumption
- [x] `validate(ast: unknown): EdictModule | StructuredError[]` function implemented
- [x] Validator catches: duplicate node IDs, unknown `kind` values, missing required fields
- [x] Every error type in §5.2 (Phase 1 subset: `duplicate_id`, `unknown_node_kind`, `missing_field`) returns structured JSON with enough context for agent self-repair
- [x] 10 example programs defined as JSON ASTs covering all node types
- [x] Unit tests for every AST node type — valid and invalid inputs
- [x] 100% statement/line/function coverage on the validator (97.5% branch)
- [ ] One end-to-end smoke test: give an LLM the schema, have it produce a valid AST, validate it

---

## 11. Design Principles

These are non-negotiable across all phases:

| # | Principle | Notes |
|---|---|---|
| 1 | **AST-first** | Structured representation is canonical. No text source. |
| 2 | **Schema-validated = compilable** | If it passes validation, it runs. No surprises. |
| 3 | **Semantic types** | Types carry intent: `currency`, `duration`, `url` |
| 4 | **First-class contracts** | Pre/post/invariant are language constructs, encouraged but not forced |
| 5 | **Structured errors** | Every diagnostic is JSON with repair context |
| 6 | **Declared effects** | All I/O through typed, declared interfaces |
| 7 | **One canonical form** | Exactly one way to represent any construct |
| 8 | **Deterministic** | Same input → same output. Always. |
| 9 | **Agent-to-agent** | No human in the loop. Schema is the documentation. |
