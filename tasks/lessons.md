# Lessons Learned

## Z3 toString() uses `ite` not `If`
- **Pattern**: Z3's `ctx.If(...)` produces AST nodes that serialize as `(ite ...)` not `(If ...)`
- **Rule**: When testing Z3 output via `.toString()`, always check for `ite` (lowercase) not `If`

## Z3 constant-folds let bindings
- **Pattern**: `let a = 10; let b = 20; a + b` becomes `(+ 10 20)` — variable names disappear
- **Rule**: Don't assert variable names appear in Z3 toString output for constant expressions

## Self-recursive callsite checking needs branch conditions
- **Pattern**: `fib(n-1)` inside `fib` with pre `n >= 0` fails without branch context
- **Fix**: Track path conditions from enclosing `if` branches. `not(n <= 1)` → `n > 1` proves `n-1 >= 0`
- **Rule**: Always propagate branch conditions when analyzing calls inside `if`/`match` arms

## Sort mismatch when negating non-boolean Z3 expressions
- **Pattern**: `ctx.Not(intExpr)` throws Sort mismatch error
- **Rule**: Always check or try/catch before calling `ctx.Not` — the expression may not be boolean

## AST field name mismatches between test fixtures and actual types
- **Pattern**: Test used `expr` but AST type uses `target` for match expressions
- **Rule**: Always verify AST field names against the type definition before writing test fixtures

## Extending features invalidates existing "failure" tests
- **Pattern**: Test `match with binding pattern → undecidable` expected `null` but feature now supports binding
- **Rule**: When extending supported expression types, audit existing tests that assert failure for those types

## Register builtins in a parent scope, not the module scope
- **Pattern**: Registering builtins in `moduleScope` causes duplicate-definition errors when user imports shadow them
- **Rule**: Use a parent scope for builtins so user definitions naturally take priority via scope-chain lookup

## WASM blocks require `drop` for non-final valued expressions
- **Pattern**: Binaryen validation fails with "non-final block elements returning a value must be dropped"
- **Rule**: Wrap all non-final body expressions in `mod.drop()` unless they are void (e.g. `local.set`)

## Binaryen `setMemory` with `exportName` already exports memory
- **Pattern**: Calling `addMemoryExport("memory", "memory")` after `setMemory(…, "memory", …)` → "already exists"
- **Rule**: Don't call `addMemoryExport` when `setMemory`'s `exportName` is already set

## Binaryen optimizer constant-folds WAT output
- **Pattern**: `10 + 20` → `i32.const 30`, `not(true)` → `i32.const 0`, `if(true)` → then-branch only
- **Rule**: Don't assert specific WAT instructions (`i32.add`, `if`, `drop`) in codegen tests when `optimize()` is called. Assert valid compilation + test behavioral correctness via the WASM runner

## JS Number.isInteger(3.0) === true breaks Float detection
- **Pattern**: `3.0` in JavaScript is `Number.isInteger(3.0) === true`, so literal-based Float inference fails for whole-number floats
- **Rule**: When testing Float codegen, use fractional values (e.g., `3.5` not `3.0`) or add explicit type annotations on literals. The `inferExprWasmType` helper checks `Number.isInteger(val)` first.

## Binding locals must be registered before arm body compilation
- **Pattern**: `compileArmWithBinding` created the local *after* `compileArmBody` compiled the body → ident lookup failed
- **Rule**: Pre-register all binding locals in a first pass before compiling any arm bodies in match expressions

