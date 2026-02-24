# Phase 2: Name Resolution + Type Checker

Phase 1 (AST Schema & Validator) is complete. Phase 2 adds semantic analysis: verifying that all names resolve and all types are consistent.

**Scope**: Walk a *validated* AST and produce `StructuredError[]` for undefined references, type mismatches, unit conflicts, and arity errors.

---

## Design Decisions

1. **Imported names are trusted (opaque)**. Resolve successfully; typed as `unknown`. Cross-module type checking deferred.
2. **No built-in functions**. Everything explicitly imported. Fix examples that call unimported functions.
3. **`+` works on strings** (concatenation). Other arithmetic (`-`,`*`,`/`,`%`) numeric only.
4. **`unknown` is contagious**. Any operation involving `unknown` → `unknown`, no errors.
5. **`result` is implicit in `post` contracts**. Typed as the function's `returnType`.
6. **`let` evaluates to its value type**. A body ending in `let` returns the bound value's type.

---

## Proposed Changes

### New Structured Errors

#### [MODIFY] [structured-errors.ts](file:///Users/patrickprobst/Downloads/Edict/src/errors/structured-errors.ts)

**Extend** the existing `StructuredError` union (additive, no breaking changes):

| Error | When | Key fields |
|---|---|---|
| `undefined_reference` | Identifier not in scope | `nodeId`, `name`, `candidates` |
| `duplicate_definition` | Same name twice in scope | `nodeId`, `name`, `firstNodeId` |
| `type_mismatch` | Expected ≠ actual type | `nodeId`, `expected`, `actual`, `hint` |
| `arity_mismatch` | Wrong arg count | `nodeId`, `expected: number`, `actual: number` |
| `not_a_function` | Call targets non-function | `nodeId`, `actualType` |
| `unknown_field` | Field access miss | `nodeId`, `recordName`, `fieldName`, `availableFields` |
| `unknown_record` | Unknown record in `record_expr` | `nodeId`, `name`, `candidates` |
| `unknown_enum` | Unknown enum in `enum_constructor` | `nodeId`, `name`, `candidates` |
| `unknown_variant` | Unknown variant on enum | `nodeId`, `enumName`, `variantName`, `availableVariants` |
| `missing_record_fields` | Missing required fields (no `defaultValue`) | `nodeId`, `recordName`, `missingFields` |

All `nodeId` fields are `string | null` (for nodes like `FieldInit` that lack IDs).

---

### 2a. Name Resolution

#### [NEW] [scope.ts](file:///Users/patrickprobst/Downloads/Edict/src/resolver/scope.ts)

```typescript
type SymbolKind = "function" | "param" | "let" | "const"
                | "type" | "record" | "enum" | "import" | "result";

interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  nodeId: string | null;
  type?: TypeExpr;
  definition?: Definition;  // backlink for arity, fields, variants
}

class Scope {
  private symbols: Map<string, SymbolInfo>;
  private parent: Scope | null;

  define(name: string, info: SymbolInfo): DuplicateDefinitionError | null;
  lookup(name: string): SymbolInfo | undefined;  // walks parent chain
  allNames(): string[];  // flat list for Levenshtein
}
```

#### [NEW] [resolve.ts](file:///Users/patrickprobst/Downloads/Edict/src/resolver/resolve.ts)

Entry point: `resolve(module: EdictModule): StructuredError[]`

**Pass 1 — Collect top-level definitions:**
- Register each `FunctionDef`, `RecordDef`, `EnumDef`, `TypeDef`, `ConstDef` name in module scope.
- Register each imported name as `kind: "import"`, type `unknown`.
- Duplicate detection → `duplicate_definition`.

**Pass 2 — Resolve expressions + patterns:**
- Walk every function body, const value, contract condition, record field `defaultValue`.
- For each `ident`: look up in scope chain. Not found → `undefined_reference` with Levenshtein candidates.
- For each `ConstructorPattern`: verify the constructor `name` exists as an enum variant in module scope. Not found → `undefined_reference`.
- Scoping rules:
  - **Function params**: child scope for body
  - **Pre-contracts**: same scope as body (params visible)
  - **Post-contracts**: body scope + implicit `result` binding (typed as `returnType`)
  - **Let bindings**: add to current scope for *subsequent* sibling expressions
  - **Match arm bindings**: child scope per arm with pattern-bound names
  - **Lambda params**: child scope for lambda body
  - **Refinement type `variable`**: child scope for predicate expression

#### [NEW] [levenshtein.ts](file:///Users/patrickprobst/Downloads/Edict/src/resolver/levenshtein.ts)

```typescript
function levenshteinDistance(a: string, b: string): number;
function findCandidates(name: string, known: string[], maxDistance?: number): string[];
// Returns names within distance ≤ 2, sorted ascending. Max 5 results.
```

---

### 2b. Type Checker

#### [NEW] [type-env.ts](file:///Users/patrickprobst/Downloads/Edict/src/checker/type-env.ts)

```typescript
class TypeEnv {
  private bindings: Map<string, TypeExpr>;
  private typeDefs: Map<string, TypeDef | RecordDef | EnumDef>;
  private parent: TypeEnv | null;

  bind(name: string, type: TypeExpr): void;
  getType(name: string): TypeExpr | undefined;
  lookupTypeDef(name: string): TypeDef | RecordDef | EnumDef | undefined;
  resolveAlias(type: TypeExpr): TypeExpr;  // Named → TypeDef → underlying type
}
```

#### [NEW] [types-equal.ts](file:///Users/patrickprobst/Downloads/Edict/src/checker/types-equal.ts)

```typescript
function typesEqual(a: TypeExpr, b: TypeExpr, env: TypeEnv): boolean;
// Structural equality after alias resolution.
// RefinedType { base: T } compatible with T (refinement erasure).
// unknown == anything (no error).
```

#### [NEW] [check.ts](file:///Users/patrickprobst/Downloads/Edict/src/checker/check.ts)

Entry point: `typeCheck(module: EdictModule): StructuredError[]`

**Setup:** Register type defs, function signatures (`FunctionType`), and const types in root `TypeEnv`.

**Per function:** Child env with params → infer body types sequentially (let bindings accumulate) → compare last expression type against `returnType`.

**Type inference rules:**

| Expression | Inferred Type | Error conditions |
|---|---|---|
| `literal` (number, `Number.isInteger(v)`) | `Basic("Int")` | — |
| `literal` (number, `!Number.isInteger(v)`) | `Basic("Float")` | — |
| `literal` (string) | `Basic("String")` | — |
| `literal` (boolean) | `Basic("Bool")` | — |
| `literal` with `type` field | Annotated type | — |
| `ident` | Env lookup | Never fails (resolver caught) |
| `binop` `+` | Same type, numeric OR String → that type | Mismatch/incompatible → `type_mismatch` |
| `binop` `-`,`*`,`/`,`%` | Same numeric type → that type | Non-numeric/mismatch → `type_mismatch` |
| `binop` `==`,`!=`,`<`,`>`,`<=`,`>=` | Same type → `Bool` | Mismatch → `type_mismatch` |
| `binop` `and`,`or`,`implies` | Both `Bool` → `Bool` | Non-bool → `type_mismatch` |
| `unop` `-` | Numeric → same type | Non-numeric → `type_mismatch` |
| `unop` `not` | `Bool` → `Bool` | Non-bool → `type_mismatch` |
| `call` | Infer `fn` expr type; must be `fn_type`. Check arity + args → `returnType` | `not_a_function`, `arity_mismatch`, `type_mismatch` |
| `if` | Condition `Bool`; then/else same type. No `else` → `Option<thenType>` | Condition/branch mismatch |
| `let` | Bind name; check value vs annotation. **Evaluates to value type** | Annotation mismatch |
| `array` | All elements same → `Array<T>`. Empty → `Array<unknown>` | Element mismatch |
| `tuple_expr` | Each element → `Tuple<...>` | — |
| `record_expr` | Lookup record def; check all required fields (no `defaultValue`) present + correct types → `Named(name)` | `unknown_record`, `missing_record_fields`, field `type_mismatch` |
| `enum_constructor` | Lookup enum + variant; check fields → `Named(enumName)` | `unknown_enum`, `unknown_variant` |
| `access` | Target resolves to record (via alias); field must exist → field type | `type_mismatch`, `unknown_field` |
| `match` | All arm bodies same type → that type | Branch mismatch |
| `block` | Last expression's type | — |
| `lambda` | `FnType(param types, [], body type)` | — |

**Match pattern type inference:**
- `ConstructorPattern("Circle", [Binding("r")])` on `Named("Shape")`: look up `Circle` variant in `Shape` enum, bind `r` → type of first field (`Float`). Bindings are positional.
- `BindingPattern("x")` on target type `T`: bind `x` → `T`.
- `LiteralPattern(5)` on target type `T`: check literal type is compatible with `T`. Mismatch → `type_mismatch`.
- `WildcardPattern`: no bindings, no type check needed.

**Unit types:** Same `base` + same `unit` required for arithmetic. `UnitType ≠ Basic`.

**`unknown` propagation:** Any expression involving `unknown` → `unknown`, no errors.

**Refinement types:** `RefinedType { base: T }` treated as `T` for assignment. Predicate verification deferred to Phase 4.

**`defaultValue`-aware field checking:** When checking `record_expr`, only fields without `defaultValue` in the `RecordDef` are required. Fields with defaults may be omitted.

---

### Pipeline

#### [NEW] [check.ts](file:///Users/patrickprobst/Downloads/Edict/src/check.ts)

```typescript
export interface CheckResult { ok: boolean; errors: StructuredError[]; }

export function check(ast: unknown): CheckResult {
  const validation = validate(ast);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const module = ast as EdictModule;
  const resolveErrors = resolve(module);
  if (resolveErrors.length > 0) return { ok: false, errors: resolveErrors };

  const typeErrors = typeCheck(module);
  return { ok: typeErrors.length === 0, errors: typeErrors };
}
```

#### [MODIFY] [index.ts](file:///Users/patrickprobst/Downloads/Edict/src/index.ts)

Add exports (additive only): `resolve`, `typeCheck`, `check`, new error types.

#### [MODIFY] [complete.edict.json](file:///Users/patrickprobst/Downloads/Edict/examples/complete.edict.json)

Add `"map"` to imports from `"std"`.

#### [MODIFY] [effects.edict.json](file:///Users/patrickprobst/Downloads/Edict/examples/effects.edict.json)

Add import `{ kind: "import", id: "imp-http-001", module: "http", names: ["http_get"] }`.

---

## Example Program Compatibility

| Example | Resolution | Type Check | Notes |
|---|---|---|---|
| `hello.edict.json` | ✅ | ✅ | Param → ident |
| `arithmetic.edict.json` | ✅ | ✅ | Int binops |
| `fibonacci.edict.json` | ✅ | ✅ | Recursive self-call |
| `records.edict.json` | ✅ | ✅ | Records, access, record_expr |
| `types.edict.json` | ✅ | ✅ | TypeDef alias → Named → Tuple |
| `enums.edict.json` | ✅ | ✅ | ConstructorPattern + `result` in post-contract |
| `effects.edict.json` | ✅ (after fix) | ✅ (opaque) | Add `http_get` import |
| `contracts.edict.json` | ✅ | ✅ | `result` implicit in post |
| `complete.edict.json` | ✅ (after fix) | ✅ (opaque) | Add `map` import |
| `modules.edict.json` | ✅ | ✅ (opaque) | Imports → `unknown` |

---

## New Files Summary

| File | Purpose |
|---|---|
| `src/resolver/scope.ts` | Nested scope chain + symbol table |
| `src/resolver/resolve.ts` | Name resolution entry point |
| `src/resolver/levenshtein.ts` | Edit distance + candidate suggestions |
| `src/checker/type-env.ts` | Type environment with alias resolution |
| `src/checker/types-equal.ts` | Structural type equality |
| `src/checker/check.ts` | Type checker entry point |
| `src/check.ts` | Pipeline: validate → resolve → typeCheck |

---

## Verification Plan

**Run**: `npx vitest run` | **Coverage**: `npx vitest run --coverage`

### Name Resolution Tests (`tests/resolver/`)

**Valid (~12):** param ref, cross-function call, let binding, match binding, lambda param, shadowing, import in call, recursive self-ref, const ref, record/enum names, refinement variable, ConstructorPattern resolves.

**Invalid (~8):** undefined variable (+ candidates), typo (+ Levenshtein), duplicate fn name, let-before-declare, out-of-scope let, undefined in contract, duplicate record def, unknown ConstructorPattern name.

### Type Checker Tests (`tests/checker/`)

**Valid (~13):** Int arithmetic, Float arithmetic, Bool logic, comparison → Bool, if with/without else, let with annotation, let inferred, function call, record field access, record_expr (with optional defaults), enum constructor, array, unit type arithmetic.

**Invalid (~13):** Int+String, Int+Float, if-condition not Bool, branch mismatch, wrong arg types, wrong arity, call non-function, access non-record, unknown field, mixing units, return mismatch, unknown record, LiteralPattern type mismatch.

### Integration Tests (`tests/check/`)

- All 10 examples through `check()` pipeline (after fixes)
- Pipeline error ordering: validation > resolution > type checking

### Regression

All Phase 1 tests pass: `npx vitest run tests/validator/`
