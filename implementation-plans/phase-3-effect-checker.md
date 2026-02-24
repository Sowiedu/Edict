# Phase 3: Effect Checker

Phase 2 (Name Resolution + Type Checker) is complete. Phase 3 adds **effect checking**: verifying that each function's declared effects cover the effects of the functions it calls.

**Scope**: Walk a *validated, resolved, and type-checked* AST and produce `StructuredError[]` for effect violations.

---

## User Review Required

> [!WARNING]
> **Pipeline behavior change**: `check()` currently returns `{ ok: true }` after type checking passes. This change adds a Phase 3 gate — effect checking runs after type checking, and can now reject previously-passing programs that have effect inconsistencies. All 10 example programs pass clean (verified below).

> [!IMPORTANT]
> **FEATURE_SPEC deviation**: The FEATURE_SPEC defines `EffectViolationError` with `callerEffects`/`calleeEffects` fields. This plan uses a more agent-friendly shape: `missingEffects` (what to add) and `calleeName` (which call caused it). This provides the agent with a direct repair action instead of requiring a diff computation. We also add a second error type `effect_in_pure` for the distinct case where a `pure` function calls an effectful one (requires different repair: drop `pure` and add effects, vs. just adding effects).

---

## Design Decisions

1. **Single-pass, not fixed-point**. Each function checks its declared effects against the *declared* effects of its direct callees. No transitive propagation is needed — the callee's declared effects ARE its contract. If the callee's declaration is wrong, the callee gets its own error. The agent self-repair loop (submit → fix → resubmit) handles cascading naturally.

2. **Imported functions are effect-opaque**. Calls to imported functions are skipped — matching Phase 2's `unknown` type treatment.

3. **`pure` excludes ALL effects, not just `io`/`fails`**. The ROADMAP says "`pure` cannot call `io` or `fails`", but `pure` is exclusive with all effects (Phase 1 validates this). Calling any function with `reads`, `writes`, `io`, or `fails` from a `pure` function is an error.

4. **Lambdas are opaque to the caller's call graph**. Lambda bodies are not traced — they execute in the callee's context when passed as arguments. Only top-level `FunctionDef` nodes participate.

5. **Missing effects are errors**. The ROADMAP mentions "warnings" but Edict has no warning infrastructure — all output is `StructuredError[]`.

6. **`const` definitions and contracts excluded**. Constants don't participate in the call graph. Contract conditions (`pre`/`post`) are specifications for Z3, not runtime code.

7. **Only `ident`-based calls create edges**. `Call.fn` is an `Expression` — only `fn.kind === "ident"` resolving to a module-local `FunctionDef` creates call graph edges. Non-ident `fn` expressions and their sub-expressions are still walked for nested calls.

---

## Proposed Changes

### Structured Errors

#### [MODIFY] [structured-errors.ts](file:///Users/patrickprobst/Downloads/Edict/src/errors/structured-errors.ts)

Add `import type { Effect } from "../ast/nodes.js";` (file currently has no imports). Add `EffectViolationError | EffectInPureError` to the `StructuredError` union. Add interfaces and constructors:

```typescript
import type { Effect } from "../ast/nodes.js";

// === Phase 3 — Effect checking errors ===

export interface EffectViolationError {
    error: "effect_violation";
    nodeId: string | null;        // the FunctionDef id
    functionName: string;         // caller name
    missingEffects: Effect[];     // effects to add to declaration
    callSiteNodeId: string | null; // the Call expression id
    calleeName: string;           // which callee introduced the effects
}

export interface EffectInPureError {
    error: "effect_in_pure";
    nodeId: string | null;        // the FunctionDef id
    functionName: string;         // the pure function
    callSiteNodeId: string | null; // the Call expression id
    calleeName: string;           // which callee has effects
    calleeEffects: Effect[];      // the problematic effects
}

export function effectViolation(
    nodeId: string | null,
    functionName: string,
    missingEffects: Effect[],
    callSiteNodeId: string | null,
    calleeName: string,
): EffectViolationError {
    return { error: "effect_violation", nodeId, functionName, missingEffects, callSiteNodeId, calleeName };
}

export function effectInPure(
    nodeId: string | null,
    functionName: string,
    callSiteNodeId: string | null,
    calleeName: string,
    calleeEffects: Effect[],
): EffectInPureError {
    return { error: "effect_in_pure", nodeId, functionName, callSiteNodeId, calleeName, calleeEffects };
}
```

---

### Effect Checker

#### [NEW] [call-graph.ts](file:///Users/patrickprobst/Downloads/Edict/src/effects/call-graph.ts)

Call graph builder — walks expression trees and records function call edges.

```typescript
export interface CallEdge {
    calleeName: string;
    callSiteNodeId: string;
}

export type CallGraph = Map<string, CallEdge[]>;

/** Walk expressions and collect all ident-based function calls. */
export function collectCalls(exprs: Expression[]): CallEdge[];

/** Build module call graph: graph edges + function def map + imported name set. */
export function buildCallGraph(module: EdictModule): {
    graph: CallGraph;
    functionDefs: Map<string, FunctionDef>;
    importedNames: Set<string>;
};
```

**Expression walker** — `collectCalls` recurses into all 15 expression types:

| Expression kind | Recurse into |
|---|---|
| `call` (`fn.kind === "ident"`) | Record edge, recurse `args` |
| `call` (non-ident `fn`) | Recurse `fn`, `args` (no edge) |
| `if` | `condition`, `then`, `else` |
| `let` | `value` |
| `match` | `target`, each arm's `body` |
| `block` | `body` |
| `binop` | `left`, `right` |
| `unop` | `operand` |
| `array` | `elements` |
| `tuple_expr` | `elements` |
| `record_expr` | each `FieldInit.value` |
| `enum_constructor` | each `FieldInit.value` |
| `access` | `target` |
| `lambda` | ⛔ **do not recurse** (opaque) |
| `literal`, `ident` | leaf — no recursion |

---

#### [NEW] [effect-check.ts](file:///Users/patrickprobst/Downloads/Edict/src/effects/effect-check.ts)

Entry point: `effectCheck(module: EdictModule): StructuredError[]`

**Algorithm (single-pass):**

1. Build call graph via `buildCallGraph()`.
2. Build `declaredEffects: Map<string, Effect[]>` from each `FunctionDef`.
3. For each `FunctionDef`, iterate its call edges (skipping imported names):
   - **If caller is `pure`**: any callee with non-pure effects → `effect_in_pure` error per violating callee.
   - **If caller is not `pure`**: compute `missing = calleeEffects \ callerEffects` (set difference, excluding `pure`). If non-empty → `effect_violation` error with the missing effects.

Note: `buildCallGraph` walks only `FunctionDef.body` — it does NOT walk `FunctionDef.contracts[].condition` (contracts are Z3 specs, not runtime code).

```typescript
export function effectCheck(module: EdictModule): StructuredError[] {
    const { graph, functionDefs, importedNames } = buildCallGraph(module);
    const errors: StructuredError[] = [];

    for (const [fnName, fn] of functionDefs) {
        const edges = graph.get(fnName) ?? [];
        const callerEffects = new Set(fn.effects);
        const isPure = callerEffects.has("pure");

        for (const edge of edges) {
            if (importedNames.has(edge.calleeName)) continue;
            const callee = functionDefs.get(edge.calleeName);
            if (!callee) continue;

            const calleeNonPure = callee.effects.filter(e => e !== "pure");
            if (calleeNonPure.length === 0) continue;

            if (isPure) {
                errors.push(effectInPure(fn.id, fnName, edge.callSiteNodeId, edge.calleeName, calleeNonPure));
            } else {
                const missing = calleeNonPure.filter(e => !callerEffects.has(e));
                if (missing.length > 0) {
                    errors.push(effectViolation(fn.id, fnName, missing, edge.callSiteNodeId, edge.calleeName));
                }
            }
        }
    }
    return errors;
}
```

---

### Pipeline Integration

#### [MODIFY] [check.ts](file:///Users/patrickprobst/Downloads/Edict/src/check.ts)

```diff
+import { effectCheck } from "./effects/effect-check.js";

 export function check(ast: unknown): CheckResult {
     // Phase 1 — Structural validation
     ...
     // Phase 2a — Name resolution
     ...
     // Phase 2b — Type checking
     const typeErrors = typeCheck(module);
-    return { ok: typeErrors.length === 0, errors: typeErrors };
+    if (typeErrors.length > 0) return { ok: false, errors: typeErrors };
+
+    // Phase 3 — Effect checking
+    const effectErrors = effectCheck(module);
+    return { ok: effectErrors.length === 0, errors: effectErrors };
 }
```

Update JSDoc to mention Phase 3.

#### [MODIFY] [index.ts](file:///Users/patrickprobst/Downloads/Edict/src/index.ts)

Add exports matching existing file structure (separate type and value exports):

```typescript
// Phase 3 — Effect Checking
export { effectCheck } from "./effects/effect-check.js";
export { buildCallGraph, collectCalls } from "./effects/call-graph.js";
export type { CallEdge, CallGraph } from "./effects/call-graph.js";

// Add to existing error type export block (lines 84-106):
//   EffectViolationError,
//   EffectInPureError,

// Add new error constructor block after Phase 2 constructors (after line 132):
export {
    effectViolation,
    effectInPure,
} from "./errors/structured-errors.js";
```

---

## Example Program Compatibility

All 10 examples pass clean — no false positives:

| Example | Why it passes |
|---|---|
| `hello.edict.json` | Pure, no calls |
| `arithmetic.edict.json` | Pure, no inter-function calls |
| `fibonacci.edict.json` | Recursive pure, calls itself (pure→pure ✅) |
| `records.edict.json` | Pure only |
| `types.edict.json` | Pure only |
| `enums.edict.json` | Pure only |
| `effects.edict.json` | `pureAdd`(pure, no calls), `fetchData`([io,fails], calls imported `http_get` — opaque), `updateConfig`([reads,writes], no calls) |
| `contracts.edict.json` | Pure only |
| `complete.edict.json` | Pure, `map` is imported (opaque) |
| `modules.edict.json` | Pure or imports opaque |

---

## New Files Summary

| File | Purpose |
|---|---|
| `src/effects/call-graph.ts` | Call graph builder + expression walker |
| `src/effects/effect-check.ts` | Entry point: `effectCheck(module)` |

---

## Verification Plan

**Run**: `npx vitest run` | **Coverage**: `npx vitest run --coverage`

### Call Graph Tests — `tests/effects/call-graph.test.ts` (~7 tests)

1. Function with one call → one edge
2. Function with no calls → empty edge list
3. Function calling import → edge present, `importedNames` contains it
4. Nested: call inside `if.condition`, `match`, `let.value` → all discovered
5. Lambda body calls → NOT in caller's edges
6. `call.fn` non-ident (e.g., complex expression) → no edge, but nested calls in args still found
7. `foo(bar())` → both `foo` and `bar` edges appear

### Effect Checker Tests — `tests/effects/effect-check.test.ts` (~16 tests)

**Valid (~9):**
1. Pure function, no calls → passes
2. Pure calling pure → passes
3. IO calling IO → passes
4. `[io, fails]` calling `[io]` → passes (superset)
5. Calling imported function → passes (opaque)
6. Chain: A(pure)→B(pure)→C(pure) → passes
7. `[reads, writes]` calling `[reads]` → passes
8. Function with empty effects, no calls → passes
9. Contract condition containing calls → passes (contracts excluded from call graph)

**Invalid (~7):**
1. Pure calling IO → `effect_in_pure`
2. Pure calling `[fails]` → `effect_in_pure`
3. Pure calling `[reads]` → `effect_in_pure`
4. `[reads]` calling `[io]` → `effect_violation`, `missingEffects: ["io"]`
5. `[io]` calling `[io, fails]` → `effect_violation`, `missingEffects: ["fails"]`
6. Transitive: A(pure)→B(pure)→C(io) — B gets `effect_in_pure`, A passes (trusts B's declaration)
7. Circular: A([io])↔B([pure]) — B gets `effect_in_pure`, A passes

### Pipeline Integration — `tests/pipeline/check.test.ts` (~2 tests)

1. Existing tests pass (regression)
2. New: `check()` returns `effect_in_pure` when pure function calls IO function

### Regression

- All existing tests: `npx vitest run`
- Coverage thresholds: 99% statements, 99% lines, 100% functions, 95% branches
