# Edict Feature Specification v1

> **Status**: All phases implemented (v1.8.0) — AST → Validate → Resolve → Type Check → Effect Check → Contracts → Codegen → Execute
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
| **Compilation target** | WASM only | WASM's sandboxed execution model is a **security requirement** for agent-generated code — programs run in an isolated VM with no ambient authority. Filesystem, network, and crypto access are only available through explicit host-provided adapters (see §7.1). This is defense-in-depth: the effect system declares capabilities at compile time, the sandbox enforces them at runtime. LLVM can be Phase 7 if performance demands it. |
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
`Int`, `Int64`, `Float`, `String`, `Bool`, `Array<T>`, `Option<T>`

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

#### Multi-Module Compilation

Multiple Edict modules can be compiled together into a single WASM binary. The `edict_compile` MCP tool accepts an array of modules via the `modules` parameter. Cross-module references are resolved during name resolution, and all modules are linked at the WASM level.

#### Typed Imports

Imports can include type declarations for cross-module (and cross-WASM) type safety:

```json
{
  "kind": "import",
  "id": "imp-1",
  "module": "math_ext",
  "names": ["sqrt", "pow"],
  "types": {
    "sqrt": { "kind": "fn_type", "params": [{ "kind": "basic", "name": "Float" }], "effects": ["pure"], "returnType": { "kind": "basic", "name": "Float" } },
    "pow": { "kind": "fn_type", "params": [{ "kind": "basic", "name": "Float" }, { "kind": "basic", "name": "Float" }], "effects": ["pure"], "returnType": { "kind": "basic", "name": "Float" } }
  }
}
```

When `types` is provided, the type checker uses these declarations for type-safe cross-module calls. Without `types`, import signatures are inferred heuristically from call sites (backwards-compatible fallback).

---

## 5. AST Schema

The entire language is defined as TypeScript interfaces. The schema _is_ the specification.

### 5.1 Core Node Types

```typescript
// Top level
interface EdictModule {
  kind: "module"
  id: string
  name: string
  schemaVersion?: string   // e.g. "1.1" — omit to default to "1.0" (auto-migrated)
  imports: Import[]
  definitions: Definition[]
}

interface Import {
  kind: "import"
  id: string
  module: string
  names: string[]
  types?: Record<string, TypeExpr>  // typed imports for cross-module type safety
}

// Definitions
type Definition = FunctionDef | TypeDef | RecordDef | EnumDef | ConstDef | ToolDef

interface FunctionDef {
  kind: "fn"
  id: string
  name: string
  params: Param[]
  effects: Effect[]
  returnType?: TypeExpr       // optional — inferred from body when omitted
  contracts: Contract[]
  constraints?: ComplexityConstraints  // per-function complexity limits
  intent?: IntentDeclaration           // structured "what, not how" metadata
  approval?: ApprovalGate              // requires explicit host approval before execution
  blame?: BlameAnnotation              // error attribution metadata
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

// Tool definition — declares a named external tool with a typed interface.
// The host provides the actual implementation at runtime.
// Tool names are in scope like functions; tool_call expressions reference them by name.
interface ToolDef {
  kind: "tool"
  id: string
  name: string           // agent-facing name: "get_weather", "create_issue"
  uri: string            // tool URI: "mcp://github/create_issue"
  params: Param[]        // typed parameters
  returnType: TypeExpr   // Ok payload; tool_call returns Result<returnType, String>
  effects: Effect[]      // must include "io"; may include others
  blame?: BlameAnnotation
}

interface RetryPolicy {
  maxRetries: number
  backoff: "fixed" | "linear" | "exponential"
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
  type?: TypeExpr              // optional — inferred from context (lambda args)
}

// Effects
type Effect = "pure" | "reads" | "writes" | "io" | "fails"

// Contracts
interface Contract {
  kind: "pre" | "post"
  id: string
  condition?: Expression  // optional — omit for marker-only contracts
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
  | NamedType         // reference to a RecordDef or EnumDef
  | TupleType
  | ConfidenceType    // Tier 3: LLM uncertainty tracking
  | ProvenanceType    // Tier 3: data origin tracking
  | CapabilityType    // Tier 3: compile-time permission tokens
  | FreshnessType     // Tier 3: temporal validity tracking

interface BasicType {
  kind: "basic"
  name: "Int" | "Int64" | "Float" | "String" | "Bool"
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

// Confidence — tracks LLM uncertainty at the type level.
// Erased after type checking. Structurally transparent: Confidence<T, 0.9> ≈ T.
interface ConfidenceType {
  kind: "confidence"
  base: TypeExpr
  confidence: number   // 0.0–1.0
}

// Provenance — tracks data origin at the type level.
// Erased after type checking. Sources are sorted, deduplicated.
interface ProvenanceType {
  kind: "provenance"
  base: TypeExpr
  sources: string[]    // ["api:weather", "db:users"]
}

// Capability token — compile-time verified, unforgeable permission.
// Not a type wrapper. The host mints them; agents cannot forge them.
// Permissions are hierarchical: "net:smtp" subsumes "net:smtp:max_10".
interface CapabilityType {
  kind: "capability"
  permissions: string[]  // ["net:smtp", "secret:api_key"]
}

// Freshness — tracks temporal validity at the type level.
// Erased after type checking. maxAge is a duration string.
interface FreshnessType {
  kind: "fresh"
  base: TypeExpr
  maxAge: string       // "30s", "5m", "1h", "200ms"
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
  | StringInterp
  | ForallExpr        // contract-only: universal quantifier
  | ExistsExpr        // contract-only: existential quantifier
  | ToolCallExpr      // invokes a declared ToolDef

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
  fn: Expression              // Expression (not string) — enables higher-order calls
  args: Expression[]
}

interface IfExpr {
  kind: "if"
  id: string
  condition: Expression
  then: Expression[]
  else?: Expression[]         // optional — omit for if-without-else
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
  fields: FieldInit[]
}

interface EnumConstructor {
  kind: "enum_constructor"
  id: string
  enumName: string     // name of the EnumDef
  variant: string      // name of the variant
  fields: FieldInit[]
}

interface FieldInit {
  kind: "field_init"
  name: string
  value: Expression
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

interface StringInterp {
  kind: "string_interp"
  id: string
  parts: Expression[]  // all parts must evaluate to String
}

// Universal quantifier — contract-only.
// forall variable in [from, to): body must hold.
// Translates to Z3 ForAll.
interface ForallExpr {
  kind: "forall"
  id: string
  variable: string
  range: { from: Expression; to: Expression }
  body: Expression
}

// Existential quantifier — contract-only.
interface ExistsExpr {
  kind: "exists"
  id: string
  variable: string
  range: { from: Expression; to: Expression }
  body: Expression
}

// Tool call expression — invokes a declared tool by name.
// Named args via FieldInit (same pattern as RecordExpr).
// Always returns Result<T, String> where T is the tool's returnType.
interface ToolCallExpr {
  kind: "tool_call"
  id: string
  tool: string           // references a ToolDef.name
  args: FieldInit[]      // named args
  timeout?: number       // ms
  retryPolicy?: RetryPolicy
  fallback?: Expression  // must type-check as Result<T, String>
}
```

### 5.2 Structured Errors

Every compiler error is a structured JSON object. No human-readable strings. Each error provides enough context for an agent to self-repair.

```typescript
type StructuredError =
  | DuplicateIdError
  | UnknownNodeKindError
  | MissingFieldError
  | InvalidFieldTypeError
  | InvalidEffectError
  | InvalidOperatorError
  | InvalidBasicTypeName
  | ConflictingEffectsError
  | UndefinedReferenceError
  | DuplicateDefinitionError
  | UnknownRecordError
  | UnknownEnumError
  | UnknownVariantError
  | TypeMismatchError
  | UnitMismatchError
  | ArityMismatchError
  | NotAFunctionError
  | UnknownFieldError
  | MissingRecordFieldsError
  | FunctionComplexityExceededError
  | ModuleComplexityExceededError
  | EffectViolationError
  | EffectInPureError
  | ApprovalPropagationMissingError
  | ContractFailureError
  | VerificationTimeoutError
  | UndecidablePredicateError
  | PreconditionNotMetError
  | CapabilityMissingError
  | WasmValidationError
  | MissingEntryPointError
  | CircularImportError
  | UnresolvedModuleError
  | DuplicateModuleNameError
  | MissingExternalModuleError
  | MigrationFailedError
  | UnsupportedSchemaVersionError

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
edict.version()         → Compiler version and capability info
edict.examples()        → 38 example programs as AST JSON
edict.validate(ast)     → StructuredError[] | "ok"
edict.check(ast)        → StructuredError[] | "ok"         // types + effects + contracts
edict.compile(ast)      → { wasm: Base64 } | StructuredError[]
edict.run(wasm)         → { output: string, exitCode: number }
edict.patch(ast, ops)   → Apply targeted AST patches by nodeId and re-check
edict.errors()          → Machine-readable catalog of all error types
edict.lint(ast)         → Non-blocking quality warnings
edict.debug(wasm)       → Execution tracing and crash diagnostics
edict.compose(frags)    → Combine program fragments into a module
edict.explain(target)   → Explain AST nodes, errors, or compiler behavior
edict.export(ast)       → Package as UASF portable skill
edict.import_skill(pkg) → Import and execute a UASF skill package
edict.generate_tests(ast) → Generate tests from Z3-verified contracts
edict.replay(trace)     → Record and replay deterministic execution traces
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

**Agent onboarding**: The agent receives the AST schema (TypeScript interfaces) and 38 example programs as part of its system prompt or MCP resource. No documentation needed — the schema _is_ the spec.

---

## 7. WASM Code Generation

- **Target**: WASM bytecode via `binaryen` (npm)
- **Memory model**: Linear memory with bump allocator + arena pattern. Heap size configurable via `RunLimits.maxMemoryMb`.
- **Execution**: Node.js built-in `WebAssembly` API, with worker thread isolation for timeout enforcement

### 7.1 WASM Module Interop

Edict programs can import and call functions from external WASM modules. This enables interoperability with libraries compiled from C, Rust, or any WASM-targeting language.

**Two instantiation strategies:**

| Strategy | When used | How it works |
|---|---|---|
| **V1 — Isolated** | External module has no memory import (scalar returns only) | External module instantiated with its own memory. Function pointers passed directly. |
| **V2 — Shared memory** | External module imports memory (String/Array returns) | External module instantiated with Edict's linear memory + heap allocator. Pointers valid across module boundaries. |

Shared memory instantiation uses a two-phase approach:
1. **Phase 1**: Compile external modules, inspect imports. Create delegate functions for memory-dependent modules.
2. **Phase 2**: After Edict module instantiation, re-instantiate deferred modules with Edict's memory and allocator. Patch delegates with real function references.

External modules are provided via `RunLimits.externalModules` as base64-encoded WASM binaries, keyed by import namespace.

### 7.2 Debug Execution

Programs compiled with `debugMode: true` include call stack instrumentation (`__trace_enter` / `__trace_exit`). The `edict_debug` MCP tool provides:

- **Call stack tracking** at crash time
- **Crash location mapping** (function name → AST `nodeId` via `debugMetadata.fnMap`)
- **Step limiting** to catch infinite loops (`maxSteps`, default: 10,000)
- **Structured crash diagnostics** with `callStack`, `crashLocation`, and `stepsExecuted`

### 7.3 Execution Replay

Deterministic execution replay for debugging and reproducibility:

- **Record mode** (`record: true`): Captures all non-deterministic host responses (HTTP, file IO, crypto, randomness, timestamps) into a `ReplayToken`.
- **Replay mode** (`replayToken: {...}`): Replays from a saved token. All host calls return recorded values instead of calling real APIs.

This ensures bit-identical execution across runs — same inputs + same replay token → same output. Useful for debugging agent-generated programs that interact with external services.

### 7.4 Execution Model & Security

> WASM sandboxing with explicit host bridging is a **deliberate security feature**, not a limitation.

AI agents write Edict programs. Unlike human-authored code reviewed before deployment, agent-generated code may execute immediately and iteratively. This demands a security model where the _host_ controls what the code can do, not the code itself.

**Defense-in-depth model:**

| Layer | Mechanism | What it controls |
|---|---|---|
| **Compile-time** | Effect system (`io`, `reads`, `writes`, `fails`) | Declares what capabilities a program _requires_. The host can inspect effects before execution and reject programs that request unwanted capabilities. |
| **Runtime — adapter** | `EdictHostAdapter` interface | Pluggable contract that controls _how_ platform capabilities are provided. Implementations exist for Node.js (full-featured) and browser (restricted). Custom adapters can restrict, audit, or mock any capability. |
| **Runtime — limits** | `RunLimits` API | Fine-grained enforcement: execution timeout, memory ceiling, filesystem sandbox, HTTP host allowlist, external modules, and execution replay. |
| **Runtime — WASM VM** | WebAssembly sandbox | The WASM VM itself provides memory isolation, no ambient authority, and no access to host APIs unless explicitly imported. |

**`RunLimits` configuration:**

```typescript
interface RunLimits {
  timeoutMs?: number;          // Max execution time (default: 15_000, min: 100)
  maxMemoryMb?: number;        // Max WASM heap in MB (default: 1)
  sandboxDir?: string;         // Filesystem sandbox for readFile/writeFile
  allowedHosts?: string[];     // HTTP host allowlist (default: all allowed)
  adapter?: EdictHostAdapter;  // Custom host adapter (default: NodeHostAdapter)
  externalModules?: Record<string, string>;  // External WASM modules (base64)
  record?: boolean;            // Enable execution recording
  replayToken?: ReplayToken;   // Replay from saved token
}
```

**Available host capabilities (via adapters):**

| Capability | Effect required | Adapter method |
|---|---|---|
| File read/write | `io` | `readFile()`, `writeFile()` |
| HTTP requests | `io` | `fetch()` |
| Crypto (SHA-256, MD5, HMAC) | `pure` | `sha256()`, `md5()`, `hmac()` |
| Environment variables | `reads` | `env()` |
| CLI arguments | `reads` | `args()` |
| Process exit | `io` | `exit()` |

New capabilities are added by extending the `EdictHostAdapter` interface and implementing them per platform. The code inside the WASM module calls these through imported host functions — it never has direct access to the underlying APIs.

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

| Phase | Deliverable | Status |
|---|---|---|
| **1** | AST Schema + Validator | ✅ Complete |
| **2** | Name Resolution + Type Checker | ✅ Complete |
| **3** | Effect Checker | ✅ Complete |
| **4** | Contract Verifier (Z3) | ✅ Complete |
| **5** | WASM Code Generator | ✅ Complete |
| **6** | MCP Toolchain | ✅ Complete |

All 6 phases are implemented and shipping (v1.8.0+). The full pipeline is operational: agents write JSON AST, the compiler validates, type-checks, effect-checks, verifies contracts via Z3, compiles to WASM, and executes — all via MCP tool calls.

---

## 10. Acceptance Criteria (All Phases)

All pipeline phases are complete and verified:

- [x] TypeScript interfaces exist for every AST node type listed in §5
- [x] JSON Schema auto-generated from TypeScript interfaces for agent consumption
- [x] Schema-driven validation (Phase 1) — structural errors caught at submission time
- [x] Name resolution (Phase 2a) — undefined references with Levenshtein-distance suggestions
- [x] Type checking (Phase 2b) — bidirectional type inference, unit types, refinement types
- [x] Effect checking (Phase 3) — call-graph propagation, fixed-point analysis
- [x] Contract verification (Phase 4) — Z3/SMT with counterexamples, caching, worker offloading
- [x] WASM code generation (Phase 5) — binaryen codegen, closures, HOFs, records, enums, strings
- [x] MCP toolchain (Phase 6) — 17 MCP tools, 5 resources, schema/examples/errors access
- [x] 38 example programs covering all language features (beginner → advanced)
- [x] 1800+ tests across 105 test files
- [x] End-to-end smoke test: agent produces AST → compile → run via MCP

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
