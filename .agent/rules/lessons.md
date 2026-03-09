# Lessons Learned

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
