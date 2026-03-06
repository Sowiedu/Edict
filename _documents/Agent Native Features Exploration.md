# Agent-Native Language Features — Deep Exploration

> **Goal**: Identify language features that make *unique* sense for Edict — features that bring insane value to the core problem (agents programming agents), that no or few other languages offer. Not "features every language has" but "features only an agent-first language *should* have."

---

## The Frame: What Does Edict Already Do That's Unique?

Before proposing new things, let's acknowledge what's already unprecedented:

| Feature | Why it's unique |
|---------|----------------|
| JSON AST as canonical format | No parser needed — agents produce structure natively |
| Structured errors with repair context | Errors are machine-actionable, not human-readable |
| Z3 contract verification | Compile-time formal proofs without human proof tactics |
| Effect system | Compiler tracks IO/mutation/failure — agent doesn't reason about it |
| Node IDs on every AST node | Targeted patching — no line numbers, no text coordinates |

These are all *amazing*. But they're still things you'd build if you were making a "really good language" — just designed for machines instead of humans. The question is: **what features only make sense because the programmer is an LLM?**

---

## 🔥 Tier 1: Game-Changing, Only-Makes-Sense-For-Agents Features

### 1. Capability Tokens (First-Class Permissions)

**The Problem Agents Have That Humans Don't**: When a human writes code, they implicitly know what they're allowed to do. An agent doesn't — and *shouldn't*. Agents get delegated authority. The security model of "the process can do whatever the user can do" is insane for autonomous code.

**The Feature**: First-class capability tokens in the type system.

```json
{
  "kind": "fn",
  "name": "send_email",
  "params": [
    {"name": "cap", "type": {"kind": "capability", "permissions": ["net:smtp", "secret:api_key"]}},
    {"name": "to", "type": {"kind": "basic", "name": "String"}},
    {"name": "body", "type": {"kind": "basic", "name": "String"}}
  ],
  "effects": ["io"],
  "returnType": {"kind": "result", "ok": {"kind": "basic", "name": "Bool"}, "err": {"kind": "basic", "name": "String"}}
}
```

- **Capabilities are values** — you can pass them, but not create them from nothing
- **The host (runtime) mints them** — the agent program can't escalate privileges
- **The type checker enforces them** — calling `send_email` without a valid `net:smtp` capability is a *compile error*, not a runtime crash
- **Capabilities are unforgeable** — no string manipulation can create one
- **Capabilities are scopeable** — `net:smtp:max_10_per_day` restricts volume

**Why no other language does this**: Human programmers tolerate ambient authority ("if I can run the program, it can do anything"). Agents shouldn't. This is the *principle of least privilege* baked into the type system.

**Unique value**: An orchestrator spins up an Edict agent program with *exactly* the capabilities it needs. The compiler *proves* the program can't exceed its authority. This is the security model agent deployments *need*.

---

### 2. Provenance / Data Lineage Tracking

**The Problem**: When an agent-written program produces output, you can't trace *where the data came from*. Did it come from a trusted API? Was it transformed correctly? Did the agent hallucinate a value?

**The Feature**: Compile-time provenance tracking via the type system.

```json
{
  "kind": "let",
  "name": "price",
  "type": {"kind": "provenance", "base": {"kind": "basic", "name": "Float"}, "source": "api:coinbase", "freshness": "5m"}
}
```

- Every value carries a **provenance tag**: where it came from (API, user input, computation, literal)
- Provenance propagates through computation: `api_price * literal_quantity = derived(api:coinbase, literal)`
- You can write **provenance contracts**: `post: result.provenance != "literal"` — "this output must come from real data, not hardcoded values"
- Provenance is *type-level* — erased at runtime, zero cost

**Why this is agent-specific**: Humans can audit their own code. When an agent writes a program that fetches stock prices and makes trading decisions, you need *machine-verifiable proof* that the output is grounded in real data, not hallucinated constants. No existing language tracks this.

**Unique value**: Trust layer for agent-produced code. "This program provably derives its output from these sources" — auditable without reading the code.

---

### 3. Token Budget / Complexity Quotas (Resource-Bounded Computation)

**The Problem**: Agent inference is expensive. Every AST node the agent produces costs tokens. Every error round-trip costs tokens. But there's no way to express "this function shouldn't be more than N nodes complex" or "this module should fit within X tokens of AST."

**The Feature**: Built-in complexity constraints.

```json
{
  "kind": "fn",
  "name": "classify",
  "constraints": {
    "maxAstNodes": 50,
    "maxCallDepth": 3,
    "maxBranches": 8
  },
  "body": [...]
}
```

- **Compile-time enforcement**: the compiler rejects functions exceeding complexity quotas
- **Module-level budgets**: `"budget": {"totalNodes": 500, "totalFunctions": 20}`
- **Structured error**: `{"error": "complexity_exceeded", "nodeId": "fn-001", "metric": "astNodes", "limit": 50, "actual": 73, "suggestion": "extract_helper_function"}`

**Why this is agent-specific**: Human programmers use code review to manage complexity. Agents don't have taste — they'll happily generate a 500-line function. Complexity constraints are the agent equivalent of "keep it simple."

**Unique value**: Prevents agent bloat. Forces decomposition. Reduces debugging surface. The compiler becomes the code reviewer.

---

### 4. Intent Declarations (What, Not Just How)

**The Problem**: Every program encodes *how* to do something. But the *why* — the intent — is lost. When agent code fails, or needs modification, there's no machine-readable record of what it was *trying* to accomplish.

**The Feature**: First-class intent declarations that are preserved, verified, and queryable.

```json
{
  "kind": "fn",
  "name": "process_order",
  "intent": {
    "goal": "calculate_total_with_tax_and_discount",
    "inputs": ["order_items", "tax_rate", "discount_code"],
    "outputs": ["total_amount_usd"],
    "invariants": ["total >= 0", "total includes tax", "discount applied before tax"]
  },
  "contracts": [
    {"kind": "post", "condition": "...total >= 0..."}
  ],
  "body": [...]
}
```

- **Intents are structured metadata** — not comments, not strings, not prose
- **The compiler verifies intent-contract consistency** — if the intent says "total >= 0" but there's no postcondition enforcing it, warning
- **Intents survive AST transformations** — they're attached to functions, not to specific implementations 
- **Intents enable re-synthesis** — if the body is wrong, the agent can re-generate from the intent without losing the specification
- **Intents are diffable** — "the intent changed from v1 to v2" is a structured delta

**Why no other language does this**: Human programmers use comments and docs for intent. But comments are free-form text — not machine-verifiable, not preserved through refactoring. In an agent world, intent is *the spec* and the code is *the implementation*. They should be separate, typed, and verified against each other.

**Unique value**: Self-documenting at the semantic level. Enables the "regenerate body from intent" pattern. Makes code review by other agents tractable — they compare intent to contracts to body.

---

### 5. Blame Tracking / Error Attribution

**The Problem**: When a multi-agent system produces bad code, which agent is responsible? When an Edict program is composed from multiple modules written by different agents, and it fails at runtime, who should fix it?

**The Feature**: Compile-time and runtime blame annotation.

```json
{
  "kind": "module",
  "name": "payment_processor",
  "blame": {
    "author": "agent://payment-specialist-v3",
    "generatedAt": "2025-03-05T22:00:00Z",
    "confidence": 0.92,
    "sourcePrompt": "sha256:abc123..."
  }
}
```

- **Every module and function carries a `blame` annotation** — which agent produced it, when, with what confidence 
- **Runtime errors include blame chain**: `{"error": "division_by_zero", "blame": ["agent://orchestrator", "agent://math-helper"], "nodeId": "binop-001"}`
- **Confidence propagates**: if a function has confidence 0.7 and it calls a function with confidence 0.5, the compound confidence is tracked
- **The compiler can enforce minimum confidence thresholds**: `"moduleConstraints": {"minConfidence": 0.85}`

**Why this is agent-specific**: Human code doesn't need blame annotations — you check `git blame`. Agent code is generated dynamically, often by multiple agents in a pipeline. Attribution is a *system need*, not a nice-to-have.

**Unique value**: Enables trustworthy multi-agent composition. "This payment module was written by a specialized agent with 0.95 confidence" vs "this was generated by a general-purpose model with 0.6 confidence."

---

## 🔷 Tier 2: Extremely Valuable Agent-First Features

### 6. Versioned Schemas with Migration Contracts

**The Problem** (already partially tracked as issue #14): As the AST schema evolves, agents holding stale schemas break. But the deeper issue is: *how do you express that v2 is a valid evolution of v1?*

**The Feature**: Built-in schema migration with verification.

- Schema versions are first-class
- Each version bump includes a **migration transform** (old AST → new AST) 
- The compiler can verify: "this v1 program, when migrated, produces a valid v2 program"
- Agents can declare which schema version they target; the compiler auto-migrates

**Unique value**: Schema evolution without breaking deployed agents — the compiler handles migration, not the agent.

---

### 7. Execution Replay / Deterministic Snapshot

**The Problem**: Debugging agent-generated code is hard. You need to reproduce exact execution.

**The Feature**: First-class execution recording.

```json
{
  "tool": "edict_run",
  "args": {
    "wasm": "...",
    "record": true
  }
}
```

Returns a *replay token* — a complete, deterministic snapshot of execution (inputs, random seeds, IO responses) that can be replayed identically. Combined with the `edict_debug` tool (issue #41), this creates a full time-travel debugging experience for agents.

**Unique value**: Agent can replay exact execution, inspect state at any point, and iterate on fixes against a frozen execution — no flaky reproduction.

---

### 8. Semantic Assertions (Beyond Contracts)

**The Problem**: Contracts verify structural properties (`x > 0`). But agents need to verify *semantic* properties: "this function sorts the array", "this function preserves the sum", "the output is a valid JSON string."

**The Feature**: Built-in semantic assertion library verified by Z3.

```json
{
  "kind": "post",
  "semantic": "sorted",
  "target": "result",
  "args": ["ascending"]
}
```

- Pre-built semantic predicates: `sorted`, `permutation_of`, `subset_of`, `sum_preserved`, `valid_json`, `no_duplicates`
- Each has a Z3 encoding
- Agents don't need to write raw predicates — they pick from a catalog
- The catalog is extensible: agents can define new semantic assertions in terms of existing ones

**Unique value**: Dramatically reduces the barrier to formal verification. Agents select from a menu of properties instead of encoding Z3 formulas manually. More contracts written → more bugs caught → fewer round-trips.

---

### 9. Auto-Decomposition Suggestions

**The Problem**: Large functions are hard for agents to get right. The compiler can detect when a function is doing too much.

**The Feature**: Compiler suggests decomposition.

```json
{
  "warning": "decomposition_suggested",
  "nodeId": "fn-process-001",
  "reason": "function_has_3_distinct_phases",
  "suggestedSplit": [
    {"name": "validate_input", "nodeRange": ["let-001", "if-003"]},
    {"name": "transform_data", "nodeRange": ["let-004", "call-007"]},
    {"name": "format_output", "nodeRange": ["let-008", "lit-ret"]}
  ]
}
```

- Not just "too big" — **structural analysis** identifies distinct phases (validation, transformation, output)
- Suggestions include the exact node ranges for each extracted function
- Agent can accept the suggestion and the compiler applies the refactoring

**Unique value**: The compiler doing code review that agents can't do for themselves. This is the "senior developer looking over your shoulder" except it's automated.

---

### 10. First-Class Tool Call Type

**The Problem**: Agents write programs that call external tools (APIs, databases, MCP tools). Every language treats these as "just a function call." But tool calls have unique properties: they can fail, they have latency, they have rate limits, they return structured data.

**The Feature**: A dedicated `tool_call` expression kind.

```json
{
  "kind": "tool_call",
  "id": "tc-001",
  "tool": "mcp://github/create_issue",
  "args": {
    "owner": {"kind": "ident", "name": "org"},
    "repo": {"kind": "ident", "name": "repo_name"},
    "title": {"kind": "ident", "name": "issue_title"}
  },
  "timeout": 10000,
  "retryPolicy": {"maxRetries": 3, "backoff": "exponential"},
  "fallback": {"kind": "enum_constructor", "enumName": "Result", "variant": "Err", "fields": [{"name": "value", "value": {"kind": "literal", "value": "tool_unavailable"}}]}
}
```

- **Built-in retry, timeout, fallback** — not boilerplate the agent writes every time
- **Tool signatures are registered** — the compiler type-checks tool call arguments
- **Effect is always `io`** — but the compiler can distinguish tool calls from other IO for analysis
- **Rate limiting is type-level**: `{"kind": "tool_call", "rateLimit": {"max": 10, "per": "minute"}}`

**Why this is agent-specific**: Agents orchestrate tool calls constantly. In normal languages, this is "write a try-catch around a fetch." In an agent language, tool calling is a first-class operation with its own semantics, error handling, and compile-time verification.

**Unique value**: 80% of agent programs are "call some tools, process results." Making tool calls a first-class language feature with built-in retry/timeout/type-checking eliminates the #1 source of agent boilerplate and bugs.

---

## 🟢 Tier 3: Interesting & Worth Exploring

### 11. Confidence-Typed Values

Values carry a confidence score (0.0–1.0) indicating the agent's certainty. The compiler can enforce `minConfidence` thresholds on output and warn when high-confidence outputs depend on low-confidence inputs. Useful for making LLM uncertainty explicit and machine-tracked.

### 12. Approval Gates

Certain operations require explicit human or system approval before execution. The compiler marks functions with `"approval": "required"` and emits an approval request to the host before running that code path. Enables human-in-the-loop at the language level.

### 13. Data Freshness Types  

Types that encode temporal validity: `{"kind": "fresh", "base": "Float", "maxAge": "5m", "source": "api:weather"}`. The compiler warns if stale data is used in computations that assume freshness. Prevents agents from caching data beyond its validity window.

### 14. Composable Program Fragments (AST Templates)

Agents don't always generate complete programs. Sometimes they generate fragments — a function body, a type definition, a set of contracts. Support first-class program fragments that can be composed, validated independently, and merged into a complete module.

### 15. Test-as-Contract Bridge

Convert Z3-verified contracts into executable test cases automatically. If a postcondition has a counterexample, generate a test case from it. If a contract is proven, generate a passing test that exercises the boundary conditions. Agents get tests for free from their contracts.

---

## Evaluation Matrix

| Feature | Agent Uniqueness | Implementation Complexity | Value-to-Cost Ratio | Priority |
|---------|:---:|:---:|:---:|:---:|
| **Capability Tokens** | ★★★★★ | Medium-High | Very High | 🔴 P0 |
| **Provenance Tracking** | ★★★★★ | High | High | 🟠 P1 |
| **Intent Declarations** | ★★★★★ | Medium | Very High | 🔴 P0 |
| **Blame Tracking** | ★★★★☆ | Low-Medium | High | 🟠 P1 |
| **Tool Call Type** | ★★★★☆ | Medium | Very High | 🔴 P0 |
| **Complexity Quotas** | ★★★★☆ | Low | High | 🟢 P2 |
| **Semantic Assertions** | ★★★☆☆ | Medium-High | High | 🟠 P1 |
| **Auto-Decomposition** | ★★★☆☆ | High | Medium | 🟡 P3 |
| **Execution Replay** | ★★★☆☆ | Medium | Medium | 🟡 P3 |
| **Confidence Types** | ★★★★☆ | Medium | Medium | 🟡 P3 |
| **Approval Gates** | ★★★★☆ | Low | Medium | 🟢 P2 |
| **Data Freshness** | ★★★★☆ | Medium | Medium | 🟡 P3 |
| **AST Templates** | ★★★☆☆ | Medium | High | 🟢 P2 |
| **Test-Contract Bridge** | ★★★☆☆ | Medium | High | 🟢 P2 |

---

## The Big Bet: What Would Make Edict *Irreplaceable*?

If I had to pick **three features** that would make Edict impossible to replicate in Python/JS/Rust:

1. **Capability Tokens** — no language has compile-time verified, unforgeable, scopeable permissions
2. **Intent Declarations** — the gap between "what the agent meant" and "what the code does" is *the* unsolved problem in agent coding
3. **First-Class Tool Calls** — 80% of agent programs are tool orchestration; making it a language primitive with built-in retry/timeout/type-checking is a category-defining move

These three form a coherent story: **Edict is the language where agent programs are secure (capabilities), understandable (intents), and reliable (typed tool calls)**.

---

## What NOT to Build

Staying true to criticalrules.md:

- ❌ Natural language in intents (structured fields only)
- ❌ Capability UIs (the host grants capabilities, not a human dashboard)
- ❌ Human-readable blame reports (structured JSON only)
- ❌ Visual decomposition suggestions (structured error format only)
- ❌ Approval gates with human UIs (the host mediates approval, language just models the gate)

Every feature above follows the razor: **"If no human ever saw this, would I still build it this way?"** — Yes. Every one of these features makes the agent→compiler→runtime loop better, not the human→code loop.
