# Edict — Critical Rules

> **Edict is a programming language where the programmer is an AI agent, not a human.**
> The agent produces JSON AST. The compiler validates and returns structured errors. The agent self-repairs. No human in the loop.

---

## The North Star

Edict's reason to exist is a single bet: **a language designed for how agents think will make agents dramatically better programmers than any language designed for how humans think.**

That bet is Edict's moat. Every human-centric feature we add erodes it. Every agent-first innovation we ship widens it. If Edict drifts toward human convenience, it becomes just another language with a JSON mode — and there's no reason for it to exist.

---

## The Razor

When evaluating ANY design decision, ask one question:

**"If no human ever saw this, would I still build it this way?"**

If the answer changes when you remove the human audience, the design is contaminated. Redesign it for the agent.

---

## What We Optimize For

These are the forces that shape every decision, in priority order:

| Priority | Metric | Why it matters |
|---|---|---|
| **1** | **Agent-compiler round-trips** | The #1 cost of programming is iteration. Every round-trip the compiler eliminates — through better errors, stronger types, clearer schema — is a direct improvement. |
| **2** | **Error actionability** | An error the agent can't act on is the same as no error. Every `StructuredError` must contain enough context (nodeId, expected vs actual, candidates, counterexamples) for the agent to produce a fix without guessing. |
| **3** | **Token efficiency** | Tokens are the agent's budget. The schema the agent reads, the AST it produces, the errors it receives — every unnecessary field, every redundant node, every verbose pattern burns budget. Measure design choices in tokens. |
| **4** | **Correctness surface** | Move correctness into the compiler. Types, effects, contracts, exhaustive matching — if the compiler can reject bad programs, the agent doesn't have to reason about them. The compiler is cheaper than agent inference. |

---

## Hard Boundaries

These are load-bearing walls, not guidelines.

| Never build | Because |
|---|---|
| Text source format / parser | Agents produce structure natively. Text is a detour through human representation. |
| Human-readable error messages | `StructuredError` fields ARE the message. Prose is a human interface. |
| CLI for human use | MCP tool calls are the only interface to the compiler. |
| Pretty-printer / formatter | No one looks at the output. Tokens wasted on aesthetics. |
| Documentation aimed at humans | The JSON Schema is the spec. Example ASTs are the tutorial. |
| Syntax sugar for readability | Readability is a human concern. One canonical form per construct. |
| IDE / LSP integration | No editor. No highlighting. No autocomplete. The MCP server IS the IDE. |
| Comments in the AST | No one reads them. They cost tokens and add schema surface. |
| Playground / REPL for humans | A web UI where humans type Edict is a category error. |

---

## What Agent-First Looks Like (Positive Examples)

It's not just about what we reject. These are examples of agent-first decisions done right:

- **Structured errors with `candidates` array** — when a name is undefined, the error includes similar names ranked by Levenshtein distance. The agent picks the closest match without guessing.
- **JSON Schema as the sole spec** — no prose documentation to parse. The agent reads the schema, sees the types, learns the format. Schema IS documentation.
- **Node IDs on every AST node** — when an error comes back referencing `nodeId: "fn-main-001"`, the agent knows exactly which node to patch. No line numbers, no character offsets, no parsing.
- **Effect declarations** — instead of the agent having to track what's pure and what does IO, the compiler enforces it. One less thing the agent reasons about = one less thing to get wrong.
- **Counterexample values in contract failures** — not just "postcondition failed" but `{ x: -1, result: -2 }` — concrete inputs that break the contract. The agent sees the failing case and fixes the logic.

---

## Subtle Drift — The Real Danger

The obvious violations (adding a parser) are easy to catch. Drift happens gradually through changes that seem reasonable in isolation:

- **"Let's add a human-readable summary field to errors"** → No. The structured fields ARE the summary. A prose field is a human interface smuggled into an agent interface.
- **"Let's add a text representation for debugging"** → No. The JSON AST is the program. If debugging is hard, improve the structured error, not add a parallel representation.
- **"This would help human contributors understand the language"** → The implementation (TypeScript compiler code) should be readable. The language itself is not for human understanding.
- **"Let's add optional string-based type annotations"** → Types are AST nodes, not strings. String encoding is a human shorthand.
- **"Should we add a --verbose flag?"** → Verbose output is human debugging. Return richer structured data instead.
- **"Let's make the AST more compact with shorthand keys"** → Compactness is good (tokens!) but cryptic keys hurt agent schema comprehension. Optimize for clarity at the schema level, compactness at the instance level.
- **"Let's add a web playground so people can try Edict"** → Who is trying it? Humans don't write Edict. An agent doesn't need a playground — it has MCP tools.

**Pattern to watch for**: any proposal whose motivation includes the words "readable", "intuitive", "user-friendly", or "easy to understand" is likely human-centric. Challenge it.

---

## Scope of This Rule

| What this rule governs | What it does NOT govern |
|---|---|
| The Edict language: AST format, node types, type system | The TypeScript compiler implementation (clean code, comments, tests = fine) |
| Error output format and content | The README and GitHub project page (these market Edict to humans who might deploy it) |
| MCP tool interface design | Contributing guidelines (humans and agents both contribute to the compiler) |
| Feature design and roadmap | Internal dev tooling for testing the compiler |

The compiler is infrastructure built by engineers. The language is a product consumed by agents. This rule protects the product.

---

## Architectural Invariants

- **JSON AST is the only program representation** — no text, no binary, no IR
- **No lexer, no parser** — agents produce structure directly
- **Deterministic** — same AST → same WASM → same output, always
- **One canonical form** — exactly one way to represent each construct
- **Structured everything** — errors, results, diagnostics: typed JSON objects, never prose
- **MCP is the sole interface** — no CLI, no API, no library — MCP tools only
- **Schema = spec = docs** — the JSON Schema is both the validation rule and the documentation
- **Automate over hand-write** — if an existing artifact (schema, types, config) already encodes information, derive behavior from it at build/runtime. Never hand-write logic that duplicates a machine-readable source of truth.

---

## Process Rules

These are non-negotiable workflow constraints. Violating them is as serious as violating the hard boundaries above.

| Rule | Why |
|---|---|
| **Run `/review` at least twice on every implementation plan before presenting to the user** | Catches gaps, violations, and stale references. A plan that hasn't been self-reviewed is not ready. No exceptions. |
| **Never call `notify_user` with an implementation plan that hasn't been `/review`'d** | The `/review` workflow is the quality gate. Skipping it ships unvetted plans. |
