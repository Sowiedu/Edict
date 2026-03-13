# Lessons Learned

## Schema Walker validateValue Assumes anyOf = Object Union
- **Problem**: `validateValue` in `schema-walker.ts` assumed all `anyOf` items are objects (`if (!isObject(value))` rejection). When `Effect` became `ConcreteEffect | EffectVariable` (string | object union), concrete string effects in `fn_type.effects` were rejected.
- **Root cause**: The validator was designed for kind-discriminated object unions only. Mixed scalar + object unions weren't supported.
- **Solution**: Check if string values match any enum branch in the `anyOf` before falling through to object validation.
- **Pattern**: When extending a type from scalar to union (scalar | object), always audit validators that consume `anyOf` schemas.

## Runtime Type Assumptions Must Be Verified Against Builtins Registry
- **Problem**: Assumed the runtime was "Int-only" for containers, but `Result<String, String>` is used by HTTP/IO/JSON builtins
- **Root cause**: Designing based on pattern observation (`ARRAY_INT_TYPE`, `OPTION_INT_TYPE`) instead of exhaustively scanning the builtin registry
- **Solution**: Always derive supported types from `BUILTIN_FUNCTIONS` registry — the source of truth. Never hardcode type constraints when a machine-readable registry exists.
- **Pattern**: `buildSupportedContainers()` scans all builtin `fn_type` signatures to build the supported set dynamically

## Worker Threads + TypeScript in ESM Projects
- **Problem**: `worker_threads` with eval:true can't directly load `.ts` files in ESM projects
- **Failed approaches**: `--import tsx` in execArgv (doesn't work with eval workers), `require("node:module").register("tsx/esm", ...)` (tsx rejects loader-style registration), `require()` in worker script (`type: module` forces ESM in eval workers)
- **Solution**: Use `tsx/esm/api`'s programmatic `register()` inside the worker script before importing `.ts` modules
- **Pattern**: In the inline ESM worker, conditionally register tsx only when importing `.ts` files:
```js
if (url.endsWith(".ts")) {
    const { register } = await import("tsx/esm/api");
    register();
}
```

## WASM Execution Timeout
- **Problem**: WASM `mainFn()` is synchronous — blocks the event loop, so `setTimeout`/`Promise.race` won't fire mid-execution
- **Solution**: Run WASM in a worker thread, terminate the worker from the main thread on timeout
- **Caveat**: Worker thread startup adds ~100-200ms overhead, so minimum effective timeout should be >= 100ms

## Test Fixtures for "Infinite Loops"
- **Problem**: Recursive infinite loops cause stack overflow (WASM trap) instead of running forever
- **Solution**: Use exponential-time algorithms (e.g., `fib(40)`) that take seconds without stack overflow

## WASM Type Inference for Indirect Calls
- **Problem**: `inferExprWasmType` in codegen returns `binaryen.i32` as default for call expressions where the fn is a local variable (indirect call). Float-returning indirect calls get wrong `call_indirect` result type.
- **Root cause**: Codegen's WASM type inference is heuristic-based and doesn't have access to the Edict type checker's `TypeEnv`.
- **Workaround**: Currently all HOF tests use Int-returning functions. This works correctly.
- **Proper fix**: Thread Edict type info (`TypeExpr`) through codegen, or build a richer type inference that can look up variable types from let-binding annotations.

## Closures — Uniform __env Convention
- **Design**: All user-defined functions get `__env: i32` as first WASM param (uniform calling convention for `call_indirect` signature compatibility). Non-capturing functions ignore it (value=0).
- **Critical distinction**: Only functions in `fnTableIndices` (user-defined) get `__env`. Builtins (`BUILTIN_FUNCTIONS`) and module imports (inferred via `inferImportSignatures`) are imported WASM functions — they do NOT have `__env`.
- **Bug pattern**: When prepending `__env=0` to direct calls, check `ctx.fnTableIndices.has(fnName)` (positive check) — NOT `!BUILTIN_FUNCTIONS.has(fnName)` (negative check), because imported functions like `map` from `std` are neither builtins nor user functions.
- **Closure pair**: Function values are heap-allocated pairs `[table_index: i32, env_ptr: i32]`. Indirect calls decompose the pair and pass `env_ptr` as first arg.

## Built-in Types Must Be Registered Across All Pipeline Stages
- **Problem**: Adding a built-in enum layout (e.g. Option) only in codegen means compile+run tests pass, but the full pipeline (typeCheck → compile) rejects it with `unknown_enum` because the type checker's `TypeEnv` has no `EnumDef` registered.
- **Root cause**: Tests that skip `typeCheck()` mask the issue. The type checker's `inferEnumConstructor` calls `env.lookupTypeDef(expr.enumName)` which requires a registered definition.
- **Fix**: Register synthetic built-in type definitions in `typeCheck()` (in `check.ts`) alongside `BUILTIN_FUNCTIONS`. For enums: `rootEnv.registerTypeDef("Option", { kind: "enum", ... })`.
- **Pattern**: When adding any built-in type, check ALL pipeline stages: validator, resolver, checker, AND codegen.
- **Extended (Result)**: Three additional registrations needed:
  1. **Resolver**: Register built-in enums in resolver's `builtinScope` so `Named("Result")` type refs and `Ok`/`Err` constructor patterns resolve.
  2. **resolveAlias**: Add built-in enum aliases in `type-env.ts` so `Named("Option")` → `{ kind: "option" }` and `Named("Result")` → `{ kind: "result" }`, preventing type mismatch with builtin function param types.
   3. **codegen edictTypeName**: Extend `edictTypeName` inference (let bindings, params, match targets) to map `option`/`result` type kinds to `"Option"`/`"Result"` enum layout names.

## 7. execFileSync deadlocks with runDirect()
- **Context**: HTTP builtins use `execFileSync` to make synchronous fetch calls inside WASM host imports.
- **Problem**: `runDirect()` runs WASM in-process on the main event loop. `execFileSync` blocks the event loop, so a local mock HTTP server on the same event loop can never respond → deadlock / ETIMEDOUT.
- **Solution**: Tests for host functions using `execFileSync` must use `run()` (worker thread), not `runDirect()`. The worker gets its own event loop, leaving the main thread free to serve HTTP.
- **Pattern**: Any host function that spawns blocking child processes needs worker-thread execution for testing.

## 8. Implementation Plans Require Double Self-Review
- **Rule**: Before presenting any implementation plan to the user via `notify_user`, run the `/review` workflow on it **at least twice**.
- **Why**: A single review pass catches obvious gaps but misses subtler issues — stale file references, missing edge cases, verification steps that aren't copy-paste runnable. The second pass catches what the first pass's fixes introduced or exposed.
- **Process**:
  1. Draft the implementation plan.
  2. Run `/review` → apply all fixes inline.
  3. Run `/review` again on the updated plan → apply any remaining fixes.
  4. Only then call `notify_user` to present it.
- **Pattern**: If the second review pass finds significant issues (not just minor wording), run a third pass. The plan is ready when a review pass returns no findings.

## 9. Object.prototype Pollution in Lookup Maps
- **Problem**: A `Record<string, string>` created with `= {}` inherits from `Object.prototype`. Looking up `map["constructor"]` returns the `Object` constructor function, not `undefined`.
- **Context**: Compact AST `KIND_MAP` used `KIND_MAP[value] ?? value` to expand kind values. When a full-format AST had `"kind": "constructor"` (for `ConstructorPattern`), the lookup returned the `Object` constructor function instead of falling through.
- **Fix**: Always use `Object.hasOwn(map, key)` before reading from lookup maps, or use `Object.create(null)` to create prototype-free objects.
- **Pattern**: Any `Record<string, T>` used as a lookup table needs prototype-safe access. Dangerous keys: `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__`.

## 10. Fix ALL Build Errors — Not Just Yours
- **Rule**: When running `npx tsc --noEmit` or any build step and errors appear, fix them ALL — even if they're pre-existing and not caused by your changes.
- **Why**: A green build is the baseline. Dismissing errors as "not mine" leaves broken windows. The user expects a clean project state after every session.
- **Pattern**: After running tests, also run `npx tsc --noEmit`. If errors exist, fix them before reporting completion.

## 11. String Length Propagation Requires Companion Locals
- **Context**: String values in WASM are `(ptr: i32, len: i32)` pairs, but stored as single i32 (pointer). Length lives in `__str_ret_len` global — a single shared register.
- **Problem**: `__str_ret_len` is clobbered by every string-returning host call. If a String variable is stored from one call and used later, `__str_ret_len` holds the wrong value.
- **Fix pattern**: For each String-typed `let` binding, create a companion local `__str_len_{name}` that captures `__str_ret_len` at binding time. When the variable is used as a String argument (in `compileCall`, `compileStringInterp`), read the companion local instead of the global.
- **Remaining gap**: Function parameters of type String have no companion local — the length is never passed by the caller. Filed as issue #95.
- **Files involved**: `compile-scalars.ts` (let binding), `compile-calls.ts` (call arg expansion), `compile-data.ts` (string interp).

## 12. Add New Files to Git
- **Problem**: Creating new files locally (like `host-adapter.ts`) but forgetting to `git add` them causes CI builds to fail with `ERR_MODULE_NOT_FOUND` because the files don't exist in the actual commit pushed to GitHub.
- **Root cause**: Agent modifying or creating files but relying on the user to manually track untracked files.
- **Fix**: When creating new files that are required for the build or tests to pass, explicitly add them to the git index or run a commit.

## 13. WASM Worker Timeouts Must Account for CI Runner Slowness
- **Problem**: Default WASM execution timeout of 5000ms was sufficient locally but caused mass test failures on GitHub Actions (ubuntu-latest with 2 vCPUs).
- **Root cause**: Worker thread startup (tsx loader registration + dynamic import + WASM instantiation) takes 2-5s on CI. Node 20 is ~3x slower than Node 22 due to ESM loader overhead.
- **Fix**: Set default WASM execution timeout to 15_000ms. Set vitest `testTimeout: 15_000`. Explicitly use 15_000 in tests that pass `timeoutMs` to `run()`.
- **Pattern**: When writing tests that spawn worker threads (especially with tsx ESM loader), use 15s+ timeouts. Always test both Node matrix versions if CI runs both.

## 14. String Param Expansion Applies to ALL Functions with edictParamTypes
- **Problem**: When adding typed imports with String params, WASM validation failed because `compile-calls.ts` only expanded String args to (ptr, len) pairs for user functions (`fnTableIndices.has(fnName)`), not for typed imports.
- **Root cause**: The String param expansion code path was guarded by `isUserFn && sig?.edictParamTypes`. Typed imports are not in `fnTableIndices`. 
- **Fix**: Added a second expansion path for `!isUserFn && sig?.edictParamTypes` (without `__env` prefix since imports don't use the closure convention). Also register `edictParamTypes` in `fnSigs` for typed imports in `codegen.ts`.
- **Pattern**: When adding new function-like entities (typed imports, builtins, etc.), ensure `edictParamTypes` is registered in `fnSigs` AND that the call compilation path handles String expansion for them. The `__env` convention only applies to user funcs and lambdas.

## 15. Global Workflows Location
- **Location**: Global workflows live in `~/.gemini/antigravity/global_workflows/`, NOT per-project `.agent/workflows/`.
- **Distinction**: Per-project workflows go in `<project>/.agent/workflows/`. Global workflows (available across all projects) go in the global directory.
- **Pattern**: When creating a workflow the user wants across all projects, save it to the global directory. Don't duplicate across per-project dirs.

## 16. WASM-Level Type Indistinguishability Requires Edict-Level Tracking
- **Problem**: Strings and Ints are both `i32` in WASM (strings are memory pointers). `compileBinop` had no way to distinguish them, so `+` on strings emitted `i32.add` (pointer arithmetic) instead of `string_concat`.
- **Root cause**: `edictTypeName` was only set for records, enums, options, results, and tuples — not for basic types like `String`. Function parameters and let bindings didn't propagate String type info to codegen locals.
- **Fix**: Set `edictTypeName = "String"` in three places: `compileLet` (for String-typed let bindings), `compileFunction` (for String-typed params), and added `isStringExpr()` helper to check the Edict-level type from literals, locals, and function signatures.
- **Pattern**: When adding codegen that needs to distinguish types that share the same WASM type, always check `edictTypeName`/`edictType` on `LocalEntry`, not just the WASM type.

## 17. Adding Feature Flags — Don't Replace, Append
- **Problem**: When adding `fragments: true` to `handleVersion`'s features map, I accidentally replaced `multiModule: false` instead of adding alongside it.
- **Root cause**: Using `replace_file_content` on the exact line rather than inserting a new line. The tool replaced the target line instead of inserting adjacent.
- **Fix**: Always verify the diff output from edits to feature maps — ensure existing flags are preserved.
- **Pattern**: When adding to a configuration/feature object, double-check that existing entries are still present in the diff. Run `/review` on the implementation to catch this class of bug.

## 18. StringTable Interning Must Happen Before toMemorySegments
- **Problem**: When adding debug instrumentation to codegen, initially interned function names AFTER `toMemorySegments()` and `setMemory()` were called, meaning the debug strings wouldn't be in the WASM data section.
- **Root cause**: The string interning was placed alongside the debug import declarations, after memory setup. But `toMemorySegments()` serializes whatever is in the StringTable at call time.
- **Fix**: Move all `strings.intern()` calls (including debug fn names) to before `toMemorySegments()`.
- **Pattern**: Any new strings added to the `StringTable` must be interned in the pre-scan phase, before `toMemorySegments()` is called. Order matters: intern → segments → setMemory → compile.

## 19. Structured Error Field Inconsistency Across Error Types
- **Problem**: Cache filtering in `contractVerify` checked for `"functionName" in error` to map errors to functions, but `PreconditionNotMetError` uses `callerName` instead. This caused callsite errors to be incorrectly cached as "proven" (0 errors).
- **Root cause**: Different Phase 4 error types use different field names for the same concept: `ContractFailureError` has `functionName`, `PreconditionNotMetError` has `callerName`.
- **Fix**: Check both `functionName` and `callerName` when filtering errors by function name.
- **Pattern**: When filtering structured errors by function identity, always check ALL field name variants across the error type union. Don't assume a single field name covers all types.

## 19. Never Cache StructuredErrors Keyed by Structural Hash
- **Problem**: Z3 verification caching initially cached all results (including errors) keyed by a structural hash that strips `id` fields. If an agent resubmits a structurally identical function with different node IDs, cached errors would reference stale `nodeId` values — making the error non-actionable.
- **Root cause**: The structural hash intentionally strips `id` fields for content-addressability. But `StructuredError.nodeId` references those same IDs. Caching errors creates a mismatch between the cached error's `nodeId` and the new submission's IDs.
- **Fix**: Only cache **proven** results (`errors.length === 0`). Error results are always re-verified, ensuring fresh `nodeId` references.
- **Pattern**: When caching results keyed by content hash, never cache data that contains identity-based references (like `nodeId`) that were excluded from the hash. Either include them in the hash (breaking content-addressability) or only cache identity-free results.

## 20. Automation-First: Never Hand-Write What Can Be Derived
- **Problem**: When planning schema-driven validation (#90), initially proposed hand-written "table-driven descriptors" — effectively re-encoding the same structural information already present in the generated JSON Schema (which itself is derived from TypeScript interfaces).
- **Root cause**: Defaulted to "write code that encodes the rules" instead of asking "does a machine-readable source of truth already exist that encodes these rules?"
- **Fix**: Use the JSON Schema directly at runtime as the validation source. Zero hand-written structural checks. Only semantic checks not expressible in the schema remain manual.
- **Pattern**: Before writing any validation, configuration, or routing logic, ask: **"Is there an existing artifact (schema, type definition, config file, AST) that already encodes this information?"** If yes, derive the behavior from that artifact automatically. Hand-written code that duplicates machine-readable sources is a maintenance liability and a correctness risk. Automate over hand-write, always.

## 21. Benchmark Corpora: Derive From Existing Data Sources
- **Problem**: When building the error recovery benchmark (#9), initially hand-wrote 50 broken AST entries — even though `buildErrorCatalog()` already maintained `example_cause`/`example_fix` pairs for every error type.
- **Root cause**: Jumped to "write the corpus" instead of asking "does an existing programmatic source already contain this data?"
- **Fix**: Import `buildErrorCatalog()` and extract corpus entries programmatically. Only add hand-crafted entries for edge cases the catalog doesn't cover (multi-error, near-misses, transitive effects).
- **Pattern**: This is the same lesson as #20 applied to test data. Any time you need a corpus, dataset, or fixture set, first check: **does a programmatic source already exist that produces this data?** If yes, derive from it. Reserve hand-written entries for genuinely novel scenarios.

## 22. Run /review Before Execution — No Shortcuts
- **Problem**: During issue #35 (memory management), did a quick "critical rules compliance" check on the implementation plan but skipped the full `/review` workflow (completeness, consistency, scope, technical rigor, verification plan checks). Jumped straight to execution.
- **Root cause**: Overconfidence in a "simple" plan. The plan looked straightforward, so the full review felt unnecessary.
- **Fix**: Always run the complete `/review` checklist on the implementation plan before starting execution, regardless of perceived simplicity. The workflow exists to catch non-obvious gaps.
- **Pattern**: **Never skip `/review` on planning artifacts.** Even for simple changes, the structured checklist catches edge cases and scope creep that quick scans miss. The /drive workflow mandates running /review at least twice before presenting. This applies to self-review before execution too, not just before user presentation.

## 23. Docker Slim Images Don't Have Git — Use --ignore-scripts
- **Problem**: `npm ci` in Docker `node:20-slim` failed with `sh: git: not found` because the `prepare` lifecycle script runs `git config core.hooksPath .githooks`.
- **Root cause**: `node:20-slim` doesn't include git. The `prepare` script runs on every `npm ci`/`npm install`, even in CI/Docker.
- **Fix**: Use `npm ci --ignore-scripts` in Dockerfiles. The prepare hook is only needed for local development.
- **Pattern**: When Dockerizing Node.js projects with git-dependent lifecycle scripts, always add `--ignore-scripts` to `npm ci`. Also applies to `postinstall` scripts that assume local tooling.

## 24. MCP Handlers Read Runtime Files — Don't Exclude Them from Docker
- **Problem**: Initial `.dockerignore` excluded `examples/` from the Docker image, which would break the `edict_examples` MCP tool at runtime.
- **Root cause**: `handlers.ts` reads `schema/`, `examples/`, and `package.json` from disk using `resolve(projectRoot, ...)` paths. These aren't compiled into `dist/` — they're separate runtime assets.
- **Fix**: Always include `schema/`, `examples/`, and `package.json` in the production Docker stage.
- **Pattern**: When Dockerizing an MCP server, trace all `readFileSync`/`readdirSync` calls in handler code to identify runtime file dependencies. These must be copied into the production image even if they look like "documentation" or "examples".

## 25. Manual Export/Handler Updates — Consider Automation
- **Context**: When adding multi-module compilation, had to manually update `handlers.ts`, `tools/compile.ts`, `tools/check.ts`, `index.ts` exports, and `error-catalog.test.ts` `ALL_ERROR_TYPES`. User flagged this as a maintenance burden.
- **Pattern**: Every new feature touching the MCP surface requires ~5 manual touchpoints (handler, tool schema, tool description, index exports, catalog test). This is error-prone and tedious.
- **Ideal**: Auto-generate `index.ts` exports from source modules, auto-derive error catalog from StructuredError union, auto-register MCP tools from a manifest. Consider building these automations when the project scales.
- **For now**: Be aware of all touchpoints when adding new features — check handler, tool schema, version flags, index exports, error catalog, error catalog test.

## 26. WASM Reserved Names — Avoid Collisions with Binaryen Builtins
- **Context**: Example program named a function `abs`, which collided with binaryen's built-in `abs` function, causing `Module::addFunction: abs already exists` at WASM compilation.
- **Pattern**: Certain function names are reserved by the WASM runtime (binaryen). When writing example programs or tests, avoid short math names like `abs`, `max`, `min`, `floor`, `ceil`, `sqrt`, `trunc`.
- **Fix**: Use descriptive names like `absolute`, `maximum`, `minimum` instead.

## 27. Structured Data Over Free-Form Strings — Automation-First
- **Context**: Intent declaration invariants were initially designed as free-form strings (`"result >= 0"`), requiring a hand-written heuristic parser to match against contract AST expressions.
- **Problem**: Free-form strings are a human-centric pattern (prose = ambiguity). Matching strings to ASTs requires brittle parsing logic that can't be derived from existing types.
- **Solution**: Make invariants structured — reuse existing `Expression` and `SemanticAssertionKind` types. Matching becomes structural comparison (JSON.stringify), zero hand-written parsing.
- **Pattern**: When designing new metadata fields, always ask: "Can this reuse an existing type?" If yes, the validation and matching logic comes for free from the schema and existing infrastructure.

## 28. Automation-First in Proposals — Never Default to Manual
- **Context**: Versioned schema migration was initially designed with hand-written migration transforms (MigrationOp arrays), when the JSON schema is already auto-generated from TypeScript types.
- **Problem**: Proposing hand-written transforms violates automation-first. The user had to ask "can we automate this?" — the agent should have identified this opportunity proactively.
- **Solution**: Diff stored schema snapshots at build time to auto-generate migration ops. Zero manual migration authoring.
- **Rule**: When proposing ANY new system, always ask: "Is there an existing artifact (schema, types, config, AST) that this can be derived from?" If yes, design the system to derive from that source of truth automatically. Never propose hand-written code when a derivation is possible. This check must happen BEFORE presenting the plan, not after user feedback.

## 29. Schema-Driven Validation Means No Manual Validation Code
- **Context**: Adding `blame` field to AST nodes — considered writing manual validation logic in the schema-walker.
- **Solution**: The schema-walker reads the auto-generated JSON Schema. Adding TypeScript interface fields + rebuild = automatic validation. Zero manual validation code.
- **Rule**: For new AST fields, always check if the schema-walker handles them automatically. Only add semantic checks for cross-field constraints that JSON Schema can't express.

## 30. Example Programs Must Match Current Schema Version
- **Context**: Example program `blame-tracking.edict.json` specified `schemaVersion: "1.8.0"` which doesn't exist.
- **Problem**: The migration system rejected the unknown version, causing handler test failures while direct pipeline tests passed (e2e tests bypass migration).
- **Rule**: Always check `CURRENT_SCHEMA_VERSION` in `migrate.ts` before setting `schemaVersion` in examples. Currently `"1.1"`.

## 31. Edict Builtins Return Types Must Be Verified
- **Context**: Assumed `print` returns `Int`, but it actually returns `String` in Edict's type system.
- **Problem**: `let` binding with explicit `Int` type annotation on `print()` result caused a type mismatch.
- **Rule**: When using builtins in examples, omit explicit type annotations on `let` bindings and let type inference handle it, or verify the builtin's return type from `src/builtins/builtins.ts`.

## 32. Type Wrapper Auto-Inference Breaks isBool/isString
- **Context**: Planned auto-tagging all literals with `Provenance<T, "literal">` during inference.
- **Problem**: `isBool()` and `isString()` use `type.kind === "basic"` directly without calling `resolveType()`. If literals inferred as `Provenance<Bool, "literal">`, then `true and false` would get false type errors because `isBool` returns false for non-"basic" kind.
- **Root cause**: Only `isNumeric()` calls `resolveType()`. `isBool`/`isString` are raw kind checks.
- **Rule**: Never auto-wrap all literals with type-level wrappers. Type wrappers (Confidence, Provenance) must be explicitly annotated, not auto-inferred. If you ever need implicit inference for a new type wrapper, first fix `isBool`/`isString` to use `resolveType`.

## 33. Hierarchical Permission Subsumption — Broader Satisfies Narrower
- **Context**: Implementing capability tokens with hierarchical permissions (e.g., `net:smtp` is scoped from `net`).
- **Problem**: Initially wrote `available.startsWith(required + ":")` — which let `net:smtp` (narrow) satisfy `net` (broad). This is an escalation, the exact opposite of correct behavior.
- **Correct rule**: `required.startsWith(available + ":")` — the **available** permission must be a **prefix** of the required one (i.e., broader). Having `net` implies you can do `net:smtp`, not the reverse.
- **Pattern**: In any hierarchical permission/scope system, always verify the subsumption direction with a concrete example: "Does having SMTP-only access let me do ANY network operation?" If the answer is no, the available must be the broader prefix.

## 34. Prefer Existing Data Channels Over Separate Maps
- **Context**: Adding provenance metadata to builtins. Initial approach created a separate `BUILTIN_PROVENANCE: Map<string, string>` with a new `ALL_BUILTINS` import in the checker.
- **Better approach**: Propagate `provenance` through the existing `BuiltinFunction` interface (which the checker already imports via `BUILTIN_FUNCTIONS`). The registry's map derivation step handles the propagation.
- **Rule**: When adding metadata that a consumer needs, first check if there's an existing derived interface the consumer already imports. Extending that interface is always more elegant than creating a separate lookup map with a new import.

## 35. Test Fixture ID Collisions in Multi-Expression Chains
- **Context**: Writing chain propagation tests with `letExpr("sum", binop("+", ...))` followed by `letExpr("doubled", binop("*", ident("sum"), ...))`. Both `binop` and `ident("sum")` calls generated default IDs `"binop-001"` and `"id-sum-001"` — duplicating IDs from the first let's value expression.
- **Rule**: In test fixtures with multiple sub-expressions that share helper functions (e.g. two `binop()` calls), always pass explicit unique IDs to avoid collisions. Default IDs only work for single-expression test cases.

## 36. Review for Design Shape, Not Just Correctness
- **Context**: Implemented provenance chains with `source` + `chain` duality plus `"unknown"` sentinel, passed all correctness checks, but user challenged elegance. The `/review` workflow validated correctness and completeness but never questioned whether the data model was the right *shape*.
- **Root cause**: The review workflow treated design elegance as optional self-reflection rather than a mandatory gate. Correctness ≠ elegance.
- **Fix**: Added a Design Elegance step (step 3) to `/review` workflow with specific checks: single responsibility, merge point consolidation, magic value elimination, duality detection, and one-sided preservation.
- **Rule**: After validating critical rules compliance, always ask: "Is there a simpler shape?" Two fields doing what one could do, magic strings, and scattered merge points are design smells.

## 37. Extract Purpose-Built Interfaces Over Synthetic Casts
- **Context**: Call graph stored `Map<string, FunctionDef>` and created synthetic `FunctionDef` objects with `as FunctionDef` casts for builtins, imports, and tools — all entities that aren't actually functions.
- **Problem**: `as FunctionDef` is fragile — if `FunctionDef` gains required fields, the synthetic objects break silently. It also obscures what the consumer actually needs.
- **Solution**: Introduced `EffectSource` interface (`{ name, id, effects, approval? }`) — exactly what effect checking and lint actually consume. Eliminated all `as FunctionDef` casts.
- **Rule**: When multiple entity types feed into the same infrastructure, don't cast them to the most common concrete type. Extract a purpose-built interface covering only the shared surface area. This is safer, self-documenting, and extensible.

## 38. Distinguish Value-Level Errors From Effect-Level Errors
- **Context**: Tool calls return `Result<T, String>` (failure as a value). Initially also added implicit `fails` effect (failure as an effect).
- **Problem**: Double-charging callers — they must both handle the Result AND declare `fails`. If `Result` already captures the failure, the effect is redundant and forces unnecessary declarations.
- **Rule**: If a construct wraps failures in a value type (Result, Option), don't also propagate a `fails` effect. Effects are for unhandled propagation; Result is for handled propagation. Choose one, not both.

## 39. WebAssembly.instantiate Overload Return Types
- **Context**: `WebAssembly.instantiate()` has two overloads with different return types.
- **Problem**: Passing `Uint8Array` returns `{ instance, module }` (InstantiateResult). Passing a compiled `WebAssembly.Module` returns `Instance` directly. Using `.instance.exports` on the Module overload silently returns `undefined`.
- **Rule**: Always declare proper overloaded types when wrapping multi-signature APIs. Test both code paths.

## 40. MCP Registry Publication Gotchas
- **Context**: Publishing MCP server to `registry.modelcontextprotocol.io` via `mcp-publisher`.
- **Gotcha 1 — Case-sensitive namespace**: `io.github.Sowiedu/*` ≠ `io.github.sowiedu/*`. The namespace must match the exact GitHub username casing. Check with `mcp-publisher login` output.
- **Gotcha 2 — Description ≤ 100 chars**: The `description` field in `server.json` has a 100-character maximum. The registry returns a 422 if exceeded.
- **Gotcha 3 — npm package must have `mcpName`**: The registry validates the *published* npm package for an `mcpName` field matching `server.json`'s `name`. This means you must `npm publish` a new version with `mcpName` in `package.json` *before* running `mcp-publisher publish`.
- **Gotcha 4 — Schema format**: Use `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`, NOT the old `registry.modelcontextprotocol.io/schema/server.json`. Package fields are `registryType`/`identifier`/`transport`, not `registry_name`/`name`/`runtime`.
- **Rule**: When publishing to the MCP registry, always: (1) verify namespace casing, (2) check description length, (3) publish npm with `mcpName` first, (4) use the current schema format.

## 40. Run `npm run ci:local` Before Pushing — Not Just Tests
- **Problem**: Ran `vitest run --coverage` locally which passed, but CI caught `validate-examples` failures.
- **Root cause**: `npm test` only runs vitest. The `ci:local` script also runs `typecheck`, `check:jsdoc`, `build`, AND `validate-examples`.
- **Fix**: Always run `npm run ci:local` (or at minimum `npm run validate-examples`) before pushing.
- **Pattern**: Know the full CI pipeline. `npm test` is necessary but not sufficient. The `ci:local` script mirrors what CI runs.

## 41. Browser Globals Require Local Declarations in Node-Targeted TypeScript
- **Context**: Implementing `BrowserHostAdapter.fetch()` using sync `XMLHttpRequest` in a project where `tsconfig.json` targets Node (no DOM lib).
- **Problem**: `tsc --noEmit` fails with `Cannot find name 'XMLHttpRequest'` because the type only exists in `lib.dom.d.ts`.
- **Fix**: Add a minimal `declare class XMLHttpRequest { ... }` at the top of the browser-specific file, declaring only the methods actually used.
- **Why not add `"DOM"` to lib**: That would pollute all files with browser types, hiding accidental browser API usage in Node-only code.
- **Pattern**: When writing browser-specific code in a Node-targeted project, use file-scoped `declare` blocks for browser globals instead of changing `tsconfig` lib settings.

## 42. SUPPORT_NOTE Constant Is Owner-Controlled — Never Overwrite
- **Context**: `src/mcp/handlers.ts` has a `SUPPORT_NOTE` constant that the project owner edits manually.
- **Rule**: **NEVER modify, replace, or overwrite the value of `SUPPORT_NOTE`**, regardless of what it currently says. This constant is the owner's personal message to agents. Treat it as user data.
- **Pattern**: When editing `handlers.ts`, skip over the `SUPPORT_NOTE` constant entirely. If adding code near it, preserve it exactly as-is. This applies even if the content seems outdated, incorrect, or offensive.

## 43. Pipeline Orchestration — Compose, Don't Duplicate
- **Problem**: When creating `compileBrowser()` and `compileBrowserFull()`, I initially copy-pasted the validate → resolve → typeCheck → effectCheck pipeline from `checkBrowser()` and `check()`, then appended `compile()`. This duplicated ~40 lines of phase-by-phase orchestration, including hand-copied VerificationCoverage computation.
- **Rule**: **Always compose from existing pipeline functions.** If `checkBrowser(ast)` already runs phases 1-3, then `compileBrowser` = `checkBrowser()` + `compile()`. If `check(ast)` runs phases 1-4, then `compileBrowserFull` = `check()` + `compile()`. Never copy the phase sequence.
- **Pattern**: Pipeline composition follows: `checkX(ast)` → check result → `compile(result.module!)` → compile result → merged output. Coverage, diagnostics, and typeInfo come from the check result.

## 44. Web Worker Inline Scripts Can't Import — Builtin Subset Risk
- **Problem**: Inline Web Workers (created via `new Worker(URL.createObjectURL(blob))`) can't use `import` statements. This means the Worker's host function set must be hardcoded in the template string. With 55+ host builtins across 12 domains, the Worker script only covers ~10 basic ones (print, string ops, random, time).
- **Impact**: Programs using crypto, HTTP, file IO, or domain-specific builtins silently fail with WASM instantiation errors in Worker mode.
- **Mitigation**: Document the limitation clearly. Recommend `runBrowserDirect()` for programs using non-basic builtins. `runBrowserDirect()` uses the full `createHostImports()` registry.
- **Future**: Consider generating the Worker script from the builtin registry at build time, or find a way to pass the full host import set to the Worker via `postMessage`.

## 45. Effect Variables Live in Param Types, Not Callee Top-Level Effects
- **Problem**: When implementing effect variable unification, I initially checked `resolved.effects` (the callee's FunctionType top-level effects) for effect variables. But `FunctionDef.effects` is `ConcreteEffect[]` — only concrete effects. Effect variables appear in **param types** (e.g., `f: (Int) -[E]-> Int`), not the callee's own effects.
- **Rule**: Always distinguish between `FunctionDef.effects` (concrete, runtime) and `FunctionType.effects` (polymorphic, in param type annotations). Scan param types for effect variables, not the callee function.

## 46. Early Continue Breaks Independent Checks
- **Problem**: The effect checker had `if (calleeNonPure.length === 0) continue;` which skipped the entire edge — including the new resolved effect variable propagation check. A pure HOF with effect-polymorphic callbacks resolves to `calleeNonPure = []` but still has resolved effects from unification.
- **Rule**: When adding a new independent check to an existing loop, audit all `continue` statements above it. Restructure to allow both checks to run.

## 47. Test Fixture Return Types Must Match Callback Signatures
- **Problem**: Test lambdas called `print("hello")` which returns `String`, but the expected callback return type was `Int`. This caused `type_mismatch` errors in the type checker before reaching the effect logic under test.
- **Rule**: When writing test fixtures with lambdas, use `let _ = sideEffect(); returnValue` pattern to decouple the effect call from the return type.

## 48. E2E Explicit Pipeline Must Thread typeInfo Between Phases
- **Problem**: The e2e test (`e2e-agent-loop.test.ts`) called `typeCheck(module)` → `effectCheck(module)` → `compile(module)` without passing `typeInfo` between steps. Effect-polymorphic programs need `resolvedCallSiteEffects` from typeCheck.
- **Fix**: Thread `typeInfo` from `typeCheck` → `effectCheck(module, typeInfo)` → `compile(module, { typeInfo })`.
- **Rule**: When adding features requiring cross-phase data, audit the e2e explicit pipeline — it manually constructs the pipeline and may miss new inter-phase dependencies.

## 49. Close Issues with Comments, Not Body Overwrites
- **Problem**: Used `issue_write(method: "update", body: "...", state: "closed")` to close #129. This replaced the original issue description with the closing summary.
- **Fix**: Use `add_issue_comment` for the closing summary, then `issue_write(method: "update", state: "closed")` separately — or use `issue_write` without a `body` field.
- **Rule**: Never pass `body` to `issue_write(update)` when closing an issue. The original description is the specification; the closing message is a comment.

## Preserve Exact Error Messages When Extracting to Shared Modules
- **Problem**: Extracted `handleImportSkill` logic into standalone `invokeSkill()` with a slightly different error message. Existing `handlers.test.ts` expected the old message string.
- **Fix**: Used the exact same error message in the new module to preserve backwards compat.
- **Rule**: When extracting handler logic into a shared library function, copy error messages verbatim — tests often assert on exact substrings.

## Edict AST Format Pitfalls When Writing Programs From Scratch
- **Problem**: Wrote AST from memory: used `{ name: "x", type: ... }` for params (missing `kind: "param"` + `id`), `kind: "identifier"` instead of `kind: "ident"`, `fn: "functionName"` string instead of `fn: { kind: "ident", ... }` expression, and single-expression `then`/`else` instead of arrays.
- **Fix**: Always reference an existing example (`examples/*.edict.json`) to match the exact format before writing ASTs from scratch.
- **Rule**: Params need `kind: "param"` + `id`. Identifiers are `kind: "ident"`. `call.fn` is an expression object. `if.then`/`if.else` are arrays of expressions. Record fields need `kind: "field"` + `id`. Enum variants need `kind: "variant"` + `id`. Match arms need `kind: "arm"` + `id`. Record/enum construction fields need `kind: "field_init"`.

## Recursive Functions With Postconditions Trigger undecidable_predicate
- **Problem**: Added `post: result >= 0` to recursive fibonacci — Z3 verifier returned `undecidable_predicate` because the `result` identifier in recursive functions isn't fully supported.
- **Fix**: Used only `pre` contracts for recursive functions (matching the pattern from `examples/fibonacci.edict.json`).
- **Rule**: Avoid postconditions referencing `result` in recursive functions. The Z3 verifier may not be able to prove them.

## VerificationCoverage Uses Nested Objects, Not Flat Fields
- **Problem**: Wrote `checkResult.coverage?.contractsVerified` / `contractsTotal` — these flat fields don't exist on the actual type.
- **Fix**: The correct structure is `coverage.contracts.proven` and `coverage.contracts.total` (and `coverage.effects.checked` / `.total`).
- **Rule**: `VerificationCoverage` uses nested objects: `{ effects: { checked, skipped, total }, contracts: { proven, skipped, total } }`. Always check `structured-errors.ts` for exact field names.

## Verify Builtin Names Against the Registry Before Hardcoding
- **Problem**: DCE's `isTerminatingCall` checked for both `"exit"` and `"panic"` as terminating calls. `exit` exists in `src/builtins/domains/io.ts`, but `panic` is NOT a registered Edict builtin — it only exists as a raw WASM host import in some runners (`browser-runner.ts`, `scaffold.ts`).
- **Root cause**: Assumed `panic` was a builtin because it appeared in host import objects. But host imports ≠ builtins. The builtins registry (`src/builtins/`) is the source of truth for what agents can call.
- **Fix**: Only reference builtin names that exist in `src/builtins/domains/`. `exit` is legitimate; `panic` was removed.
- **Rule**: Before hardcoding any builtin name in optimizer/codegen code, verify it exists in the builtins registry. Grep `src/builtins/domains/` for the name. Host imports in runners are implementation details, not language-level builtins.

## Type Checker vs Codegen WASM Type Disagreement
- **Problem**: The type checker models `let` as producing the bound value's type and `if-without-else` as `Option<T>`, but codegen emits `local.set` (void) and void WASM `if`. When either is the last expression in a function body, WASM validation fails: "function body type must match."
- **Root cause**: Two parallel type systems — the type checker's Edict type inference and codegen's `inferExprWasmType` — can disagree on expressions that are "value-like" in the language but "statement-like" in WASM.
- **Fix**: Apply boundary fixups: (1) in `compileFunction` and `compileBlock`, if the last expression is `let`, append `local.get` to produce the value; (2) in `compileIf`, if no `else`, construct a heap-allocated `Option` (Some/None) instead of emitting a void `if`.
- **Rule**: When adding new expression kinds, always verify that `inferExprWasmType`, the type checker's `inferExpr`, and the actual compiled expression all agree on the WASM type. Check both "value position" (last in body) and "statement position" (non-final).

## Test Helpers Must Thread typeInfo to compile()
- **Problem**: `compileAndRun()` helper in `type-conversion-builtins.test.ts` called `compile(checkResult.module!)` without passing `typeInfo`. New features using `TypedModuleInfo` side-tables (like `callArgCoercions`) silently had no effect during codegen because the coercion map was absent.
- **Symptom**: Tests passed for existing features (which don't use `callArgCoercions`) but new auto-coercion tests either compiled wrong code or produced empty output.
- **Fix**: Always call `compile(module, { typeInfo: checkResult.typeInfo })` in test helpers.
- **Rule**: When adding features that store data in `TypedModuleInfo`, verify ALL test helpers that call `compile()` are passing `typeInfo`. Grep for `compile(checkResult.module` without `typeInfo` to find gaps.
