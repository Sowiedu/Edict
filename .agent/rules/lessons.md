# Lessons Learned

## 1. Always Run /review on Plans (REPEATED 3x)
Run `/review` **twice** before `notify_user` on any implementation plan. No exceptions. Pass 1 catches 7+ gaps; pass 2 catches what pass 1's fixes introduced. Plan is ready when a review pass returns no findings.

## 2. Structured Errors Use `.error`, Not `.kind`
All `StructuredError` types discriminate on `error` field, not `kind`. AST nodes use `kind`; errors use `error`.

## 3. Schema Walker anyOf Assumes Object Union
`validateValue` assumed all `anyOf` items are objects. Mixed scalar+object unions (string|object) need a string-enum branch check before object validation.

## 4. Derive Types From Builtin Registry
Never hardcode type constraints. Derive supported types from `BUILTIN_FUNCTIONS` registry dynamically (e.g. `buildSupportedContainers()` scans all builtin signatures).

## 5. Worker Threads + TypeScript ESM
Use `tsx/esm/api`'s programmatic `register()` inside the worker script. `--import tsx` in execArgv and `require("node:module").register` don't work with eval workers.

## 6. WASM Timeout Needs Worker Thread
WASM `mainFn()` blocks the event loop. Run in worker thread, terminate from main thread on timeout. Startup adds ~100-200ms overhead.

## 7. Infinite Loop Test Fixtures
Recursive infinite loops → stack overflow (trap), not hang. Use exponential-time algorithms (`fib(40)`) instead.

## 8. WASM Type Inference for Indirect Calls
`inferExprWasmType` defaults to `i32` for indirect calls. Float-returning indirect calls get wrong type. Fix: thread Edict type info through codegen.

## 9. Closures — __env Convention
All user functions get `__env: i32` first param. Check `fnTableIndices.has(fnName)` (positive), not `!BUILTIN_FUNCTIONS.has()` (negative) — imported functions are neither. Function values are heap pairs `[table_index, env_ptr]`.

## 10. Built-in Types: Register Across ALL Stages
Adding a built-in type in codegen alone fails at type-checking. Register in: resolver `builtinScope`, `resolveAlias` in `type-env.ts`, checker `typeCheck()`, and codegen `edictTypeName`.

## 11. execFileSync Deadlocks with runDirect()
`execFileSync` blocks event loop → mock HTTP server can't respond. Use `run()` (worker thread) for tests with blocking child processes.

## 12. Object.prototype Pollution in Lookup Maps
`map["constructor"]` returns `Object` constructor on `{}`. Use `Object.hasOwn(map, key)` or `Object.create(null)`.

## 13. Fix ALL Build Errors
Run `npx tsc --noEmit` after tests. Fix all errors, even pre-existing ones.

## 14. String Length Companion Locals
`__str_ret_len` global is clobbered by every string-returning call. Create `__str_len_{name}` companion locals at binding time. Files: `compile-scalars.ts`, `compile-calls.ts`, `compile-data.ts`.

## 15. Add New Files to Git
New files not `git add`-ed → CI fails with `ERR_MODULE_NOT_FOUND`.

## 16. CI Timeouts: 15s+ for Worker Threads
Worker startup takes 2-5s on CI (Node 20 ~3x slower than 22). Default timeout: 15_000ms.

## 17. String Param Expansion for ALL edictParamTypes
String args must be expanded to `(ptr, len)` for typed imports too, not just user functions. Register `edictParamTypes` in `fnSigs` for typed imports.

## 18. Global Workflows Location
Global: `~/.gemini/antigravity/global_workflows/`. Per-project: `<project>/.agent/workflows/`.

## 19. WASM Type Disambiguation via edictTypeName
Strings and Ints are both `i32`. Set `edictTypeName = "String"` in `compileLet`, `compileFunction`. Check `edictTypeName` on `LocalEntry`, not WASM type.

## 20. Feature Flags: Append, Don't Replace
Verify diffs when editing feature/config maps — ensure existing entries are preserved.

## 21. StringTable: Intern Before toMemorySegments
Order: intern → segments → setMemory → compile. Strings interned after `toMemorySegments()` won't appear in WASM.

## 22. Error Field Inconsistency
`ContractFailureError.functionName` vs `PreconditionNotMetError.callerName`. Check all field name variants when filtering by function.

## 23. Never Cache Errors by Structural Hash
Structural hash strips `id` fields. Cached error `nodeId` refs go stale. Only cache proven (0-error) results.

## 24. Automation-First: Derive, Don't Hand-Write
Before writing validation/config/test-data, ask: "Does a machine-readable source already encode this?" Schema-walker reads JSON Schema (zero manual validation). `buildErrorCatalog()` provides benchmark corpus. Schema diffs auto-generate migrations. Extend TypeScript interfaces + rebuild = automatic schema.

## 25. Docker Slim: Use --ignore-scripts
`node:20-slim` has no git. `npm ci --ignore-scripts` skips the `prepare` hook.

## 26. Docker: Include Runtime File Dependencies
MCP handlers read `schema/`, `examples/`, `package.json` from disk. Don't exclude from Docker image.

## 27. MCP Feature Touchpoints
New features need: handler, tool schema, tool description, index exports, error catalog, error catalog test, version flags.

## 28. WASM Reserved Names
Avoid `abs`, `max`, `min`, `floor`, `ceil`, `sqrt`, `trunc` — collision with binaryen builtins.

## 29. Structured Data Over Free-Form Strings
Reuse existing `Expression`/`SemanticAssertionKind` types for invariants. Matching becomes structural comparison, zero parsing.

## 30. Schema Version Must Exist
Check `CURRENT_SCHEMA_VERSION` in `migrate.ts` before setting `schemaVersion` in examples.

## 31. Verify Builtin Return Types
`print` returns `String`, not `Int`. Verify from `src/builtins/builtins.ts` or omit explicit annotations.

## 32. Type Wrappers Break isBool/isString
`isBool()`/`isString()` don't call `resolveType()`. Never auto-wrap literals with type-level wrappers.

## 33. Permission Subsumption Direction
`required.startsWith(available + ":")` — available must be broader prefix. Not the reverse.

## 34. Prefer Existing Data Channels
Extend existing interfaces the consumer already imports rather than creating separate lookup maps.

## 35. Test Fixture ID Collisions
Multiple `binop()` calls generate duplicate default IDs. Pass explicit unique IDs in multi-expression fixtures.

## 36. Review for Shape, Not Just Correctness
After correctness: "Is there a simpler shape?" Two fields doing what one could, magic strings, and scattered merge points are design smells.

## 37. Purpose-Built Interfaces Over Casts
Don't cast disparate entities to the most common type with `as`. Extract an interface covering only the shared surface area.

## 38. Value-Level vs Effect-Level Errors
If `Result` wraps failure (handled propagation), don't also propagate `fails` effect (unhandled). Choose one.

## 39. WebAssembly.instantiate Overloads
`Uint8Array` → `{ instance, module }`. `Module` → `Instance` directly. `.instance.exports` on wrong overload → `undefined`.

## 40. MCP Registry Gotchas
Case-sensitive namespace. Description ≤ 100 chars. Publish npm with `mcpName` first. Use schema from `static.modelcontextprotocol.io`.

## 41. Run ci:local Before Pushing
`npm test` is not sufficient. `npm run ci:local` also runs typecheck, build, validate-examples.

## 42. Browser Globals in Node TypeScript
Use file-scoped `declare class` blocks, not `"DOM"` in tsconfig lib.

## 43. SUPPORT_NOTE Is Owner-Controlled
Never modify `SUPPORT_NOTE` in `handlers.ts`. Treat as user data.

## 44. Pipeline: Compose, Don't Duplicate
`compileBrowser` = `checkBrowser()` + `compile()`. Never copy the phase sequence.

## 45. Inline Workers Can't Import
Inline Web Workers hardcode ~10 of 55+ builtins. Use `runBrowserDirect()` for non-basic builtins.

## 46. Effect Variables in Param Types
`FunctionDef.effects` is `ConcreteEffect[]`. Effect variables live in param type annotations (`FunctionType.effects`).

## 47. Early Continue Breaks New Checks
When adding checks to loops, audit all `continue` statements above. Restructure to allow both checks.

## 48. Test Lambdas: Decouple Effect From Return
Use `let _ = sideEffect(); returnValue` to match expected callback return types.

## 49. Thread typeInfo Through Pipeline
`typeCheck` → `effectCheck(module, typeInfo)` → `compile(module, { typeInfo })`. Audit e2e tests too.

## 50. Close Issues: Comment, Don't Overwrite Body
Use `add_issue_comment` for closing summary. Never pass `body` to `issue_write(update)` when closing.

## 51. Preserve Error Messages When Extracting
Copy error messages verbatim to shared modules. Tests assert on exact substrings.

## 52. Edict AST Format Reference
Always check examples before writing ASTs. Params: `kind:"param"`+`id`. Idents: `kind:"ident"`. `call.fn`: expression. `if.then`/`else`: arrays. Fields: `kind:"field"`+`id`. Variants: `kind:"variant"`+`id`. Arms: `kind:"arm"`+`id`. Field inits: `kind:"field_init"`.

## 53. No Postconditions on Recursive Functions
`result` in postconditions → `undecidable_predicate` for recursive fns. Use `pre` only.

## 54. VerificationCoverage: Nested Objects
`coverage.contracts.proven`/`.total`, `coverage.effects.checked`/`.total`. Not flat fields.

## 55. Verify Builtin Names Against Registry
Grep `src/builtins/domains/`. Host imports in runners ≠ language-level builtins.

## 56. Type Checker vs Codegen Disagreement
`let` → `local.set` (void) but type checker says value type. `if-without-else` → void but checker says `Option<T>`. Apply boundary fixups in final position.

## 57. Test Helpers: Pass typeInfo to compile()
`compile(module, { typeInfo })` — not just `compile(module!)`. Features using `TypedModuleInfo` side-tables silently fail otherwise.

## 58. Normalization Must Flow Through Entire Function
After `expandCompact()`/`migrateToLatest()`, every downstream reference must use the normalized result, not the original parameter.
