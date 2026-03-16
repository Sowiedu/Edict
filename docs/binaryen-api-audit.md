# Binaryen API Surface Audit — Edict Codegen

> Precise inventory of every binaryen API call site in Edict's WASM codegen.
> Gates #198 (pure-JS WASM encoder replacement) for #81 (self-hosting).

**Date**: 2026-03-16
**Issue**: [#197](https://github.com/Sowiedu/Edict/issues/197)

---

## Files Using Binaryen

| File | Import Kind | Role |
|------|-----------|------|
| `src/codegen/codegen.ts` | value | Main compiler entry: module setup, memory, globals, function compilation |
| `src/codegen/types.ts` | value | Type mapping (`edictTypeToWasm`), `CompilationContext`, `FunctionContext` |
| `src/codegen/imports.ts` | value | Import signature inference |
| `src/codegen/compile-ir-expr.ts` | value | IR expression dispatcher |
| `src/codegen/compile-ir-scalars.ts` | value | Literals, idents, binops, unops, if, let, block |
| `src/codegen/compile-ir-calls.ts` | value | Function calls, lambda references |
| `src/codegen/compile-ir-data.ts` | value | Records, tuples, enums, arrays, field access, string interp |
| `src/codegen/compile-ir-match.ts` | value | Pattern matching |
| `src/codegen/closures.ts` | value | Free variable collection, closure pair allocation |
| `src/codegen/hof-generators.ts` | value | HOF array builtins (map, filter, reduce, find, sort) |
| `src/codegen/string-table.ts` | value | String interning → memory segments |
| `src/builtins/registry.ts` | **type only** | `generateWasmBuiltins(mod: binaryen.Module)` |
| `src/builtins/builtin-types.ts` | **type only** | `BuiltinImpl.generator(mod: binaryen.Module)` |

---

## API Inventory

### 1. Type Constants

| API | WASM Equivalent | Call Sites |
|-----|----------------|------------|
| `binaryen.i32` | `0x7F` (i32) | ~120 |
| `binaryen.i64` | `0x7E` (i64) | ~12 |
| `binaryen.f64` | `0x7C` (f64) | ~25 |
| `binaryen.none` | void / empty | ~18 |
| `binaryen.createType([...])` | multi-value param type | ~12 |

**Replacement complexity**: **Trivial**. These are integer constants. `createType` packs multiple types into a composite — the replacement encoder just needs to write the parameter count + types.

---

### 2. Module Lifecycle

| API | Purpose | Call Sites |
|-----|---------|------------|
| `new binaryen.Module()` | Create module | 1 (`codegen.ts`) |
| `mod.validate()` | Validate WASM module | 1 |
| `mod.optimize()` | Run optimization passes | 1 |
| `mod.emitBinary()` | Produce `Uint8Array` WASM bytecode | 1 |
| `mod.emitText()` | Produce WAT text (debug only) | 1 |
| `mod.dispose()` | Free C++ memory | 1 |

**Replacement complexity**: **Moderate**. `emitBinary()` is the core output — the replacement encoder must produce valid WASM binary format. `validate()` can be replaced with the browser/runtime's own `WebAssembly.validate()`. `optimize()` can be deferred or omitted. `emitText()` is a debug convenience (optional).

---

### 3. Memory Configuration

| API | Purpose | Call Sites |
|-----|---------|------------|
| `mod.setMemory(initial, max, export, segments)` | Declare memory with data segments | 1 |

**Replacement complexity**: **Trivial**. Writes a memory section + data section in the WASM binary.

---

### 4. Global Variables

| API | Purpose | Call Sites |
|-----|---------|------------|
| `mod.addGlobal(name, type, mutable, init)` | Declare global | 2 (`__heap_start`, `__heap_ptr`) |
| `mod.global.get(name, type)` | Read global | ~30 |
| `mod.global.set(name, value)` | Write global | ~20 |

**Replacement complexity**: **Trivial**. Standard WASM global section + `global.get`/`global.set` opcodes.

---

### 5. Functions

| API | Purpose | Call Sites |
|-----|---------|------------|
| `mod.addFunction(name, paramType, resultType, vars, body)` | Define function | ~8 (user fns + HOFs + helpers) |
| `mod.addFunctionImport(name, module, base, paramType, resultType)` | Import function | ~5 |
| `mod.addFunctionExport(name, externalName)` | Export function | ~5 |

**Replacement complexity**: **Moderate**. Function section, import section, export section, code section. The vars array specifies local variable types. The body is a binaryen `ExpressionRef` tree that must be serialized to WASM bytecodes.

---

### 6. Table & Indirect Calls

| API | Purpose | Call Sites |
|-----|---------|------------|
| `mod.addTable(name, initial, max)` | Declare function table | 1 |
| `mod.addActiveElementSegment(table, name, funcs, offset)` | Populate table | 1 |
| `mod.call_indirect(table, target, args, paramType, resultType)` | Indirect function call | ~8 (HOFs + closures) |

**Replacement complexity**: **Moderate**. Table section, element section, `call_indirect` opcode. The indirect call sites are substantial (all HOFs use them).

---

### 7. i32 Expression Builders

| API | WASM Opcode | Call Sites |
|-----|-------------|------------|
| `mod.i32.const(value)` | `i32.const` | ~80 |
| `mod.i32.add(a, b)` | `i32.add` | ~25 |
| `mod.i32.sub(a, b)` | `i32.sub` | ~5 |
| `mod.i32.mul(a, b)` | `i32.mul` | ~12 |
| `mod.i32.div_s(a, b)` | `i32.div_s` | 1 |
| `mod.i32.rem_s(a, b)` | `i32.rem_s` | 1 |
| `mod.i32.eq(a, b)` | `i32.eq` | ~5 |
| `mod.i32.ne(a, b)` | `i32.ne` | 1 |
| `mod.i32.lt_s(a, b)` | `i32.lt_s` | ~8 |
| `mod.i32.gt_s(a, b)` | `i32.gt_s` | ~5 |
| `mod.i32.le_s(a, b)` | `i32.le_s` | ~3 |
| `mod.i32.ge_s(a, b)` | `i32.ge_s` | 1 |
| `mod.i32.and(a, b)` | `i32.and` | 1 |
| `mod.i32.or(a, b)` | `i32.or` | 2 |
| `mod.i32.eqz(a)` | `i32.eqz` | 2 |
| `mod.i32.load(offset, align, ptr)` | `i32.load` | ~35 |
| `mod.i32.store(offset, align, ptr, value)` | `i32.store` | ~30 |

**Replacement complexity**: **Trivial per opcode**. Each is a 1:1 mapping to a WASM opcode. High call-site count but mechanically simple.

---

### 8. i64 Expression Builders

| API | WASM Opcode | Call Sites |
|-----|-------------|------------|
| `mod.i64.const(low, high)` | `i64.const` | 3 |
| `mod.i64.add(a, b)` | `i64.add` | 1 |
| `mod.i64.sub(a, b)` | `i64.sub` | 2 |
| `mod.i64.mul(a, b)` | `i64.mul` | 1 |
| `mod.i64.div_s(a, b)` | `i64.div_s` | 1 |
| `mod.i64.rem_s(a, b)` | `i64.rem_s` | 1 |
| `mod.i64.eq(a, b)` | `i64.eq` | 2 |
| `mod.i64.ne(a, b)` | `i64.ne` | 1 |
| `mod.i64.lt_s(a, b)` | `i64.lt_s` | 1 |
| `mod.i64.gt_s(a, b)` | `i64.gt_s` | 1 |
| `mod.i64.le_s(a, b)` | `i64.le_s` | 1 |
| `mod.i64.ge_s(a, b)` | `i64.ge_s` | 1 |

**Replacement complexity**: **Trivial**. Same pattern as i32, just different opcodes.

---

### 9. f64 Expression Builders

| API | WASM Opcode | Call Sites |
|-----|-------------|------------|
| `mod.f64.const(value)` | `f64.const` | 2 |
| `mod.f64.add(a, b)` | `f64.add` | 1 |
| `mod.f64.sub(a, b)` | `f64.sub` | 1 |
| `mod.f64.mul(a, b)` | `f64.mul` | 1 |
| `mod.f64.div(a, b)` | `f64.div` | 1 |
| `mod.f64.eq(a, b)` | `f64.eq` | 1 |
| `mod.f64.ne(a, b)` | `f64.ne` | 1 |
| `mod.f64.lt(a, b)` | `f64.lt` | 1 |
| `mod.f64.gt(a, b)` | `f64.gt` | 1 |
| `mod.f64.le(a, b)` | `f64.le` | 1 |
| `mod.f64.ge(a, b)` | `f64.ge` | 1 |
| `mod.f64.neg(a)` | `f64.neg` | 1 |
| `mod.f64.convert_s.i32(a)` | `f64.convert_i32_s` | 1 |
| `mod.f64.load(offset, align, ptr)` | `f64.load` | ~5 |
| `mod.f64.store(offset, align, ptr, value)` | `f64.store` | ~5 |

**Replacement complexity**: **Trivial**. Same pattern as i32/i64.

---

### 10. Control Flow

| API | WASM Construct | Call Sites |
|-----|---------------|------------|
| `mod.block(label, children, type)` | `block` | ~40 |
| `mod.if(cond, then, else?)` | `if`/`if-else` | ~15 |
| `mod.loop(label, body)` | `loop` | 7 (all in `hof-generators.ts`) |
| `mod.br(label, condition?)` | `br` / `br_if` | ~10 (all in `hof-generators.ts`) |
| `mod.call(name, args, returnType)` | `call` | ~15 |
| `mod.nop()` | `nop` | 2 |
| `mod.drop(expr)` | `drop` | 1 |
| `mod.unreachable()` | `unreachable` | ~12 |

**Replacement complexity**: **Moderate**. Blocks and structured control flow are WASM's most complex encoding (block types, label indices, `br`/`br_if` encoding). But the patterns are well-defined and limited.

---

### 11. Local Variables

| API | WASM Construct | Call Sites |
|-----|---------------|------------|
| `mod.local.get(index, type)` | `local.get` | ~60 |
| `mod.local.set(index, value)` | `local.set` | ~40 |

**Replacement complexity**: **Trivial**. Direct opcode mapping.

---

## Summary: Total Unique APIs

| Category | Unique Methods | Total Call Sites | Complexity |
|----------|---------------|-----------------|------------|
| Type constants | 5 | ~187 | Trivial |
| Module lifecycle | 6 | 6 | Moderate |
| Memory | 1 | 1 | Trivial |
| Globals | 3 | ~52 | Trivial |
| Functions | 3 | ~18 | Moderate |
| Tables | 3 | ~10 | Moderate |
| i32 ops | 17 | ~215 | Trivial |
| i64 ops | 12 | ~16 | Trivial |
| f64 ops | 15 | ~23 | Trivial |
| Control flow | 8 | ~102 | Moderate |
| Locals | 2 | ~100 | Trivial |
| **Total** | **~75** | **~730** | — |

---

## Binaryen Features NOT Used

These binaryen capabilities are **not used** by Edict's codegen, meaning the replacement encoder does NOT need them:

- SIMD (v128)
- Multi-memory
- Reference types / GC
- Exception handling (try/catch)
- Atomics / threads
- Bulk memory operations
- Tail calls
- `select` opcode
- `local.tee`
- `memory.grow` / `memory.size`
- Named/indexed export types other than functions and memory
- Optimization passes (semantically — `mod.optimize()` is called but could be dropped)
- Stack IR
- Source maps

---

## Recommendation: Custom Minimal Encoder

**Approach 2: Custom minimal encoder** is the clear winner.

### Rationale

1. **Small API surface**: Only ~75 unique methods across ~730 call sites. The WASM opcode coverage is a strict subset of MVP.

2. **All 1:1 opcode mappings**: Every `mod.i32.add()`, `mod.f64.load()`, etc. maps directly to a single WASM opcode byte. No complex lowering needed.

3. **No optimization passes needed**: Edict's IR pipeline (`src/ir/optimize.ts`) handles constant folding, DCE, and simplification before codegen. Binaryen's `optimize()` is a nice-to-have, not load-bearing.

4. **Existing libraries are overkill or wrong shape**: 
   - `wabt.js` is a WAT parser → binary converter (wrong direction — we have a tree, not text)
   - `@aspect/wasm-encoder` may not exist or be maintained
   - Any generic library would bring unused API surface

5. **Estimated size**: A custom encoder covering this surface would be **~500-800 lines of TypeScript** — the WASM binary format for MVP is well-documented and mechanical.

### Proposed Interface

The replacement module should expose a **binaryen-compatible API** to minimize changes in the 13 consumer files:

```typescript
// src/codegen/wasm-encoder.ts

export const i32 = 0x7F;
export const i64 = 0x7E;
export const f64 = 0x7C;
export const none = 0x40;

export function createType(types: number[]): number { ... }

export class Module {
    // Expression builders
    readonly i32 = { const: ..., add: ..., load: ..., store: ..., ... };
    readonly i64 = { const: ..., add: ..., ... };
    readonly f64 = { const: ..., add: ..., load: ..., store: ..., ... };
    readonly local = { get: ..., set: ... };
    readonly global = { get: ..., set: ... };

    // Control flow
    block(...): ExpressionRef { ... }
    if(...): ExpressionRef { ... }
    loop(...): ExpressionRef { ... }
    br(...): ExpressionRef { ... }
    call(...): ExpressionRef { ... }
    call_indirect(...): ExpressionRef { ... }
    nop(): ExpressionRef { ... }
    drop(...): ExpressionRef { ... }
    unreachable(): ExpressionRef { ... }

    // Module-level
    setMemory(...): void { ... }
    addGlobal(...): void { ... }
    addFunction(...): void { ... }
    addFunctionImport(...): void { ... }
    addFunctionExport(...): void { ... }
    addTable(...): void { ... }
    addActiveElementSegment(...): void { ... }

    // Output
    emitBinary(): Uint8Array { ... }
    validate(): boolean { return true; } // defer to runtime
    optimize(): void { /* no-op */ }
    emitText(): string { return ""; } // stub
    dispose(): void { /* no-op — GC handles it */ }
}
```

### Migration Path

1. Create `src/codegen/wasm-encoder.ts` with the API above
2. Change all `import binaryen from "binaryen"` → `import * as binaryen from "./wasm-encoder.js"`
3. Run the existing 2470 tests — any diff in WASM output indicates a bug
4. Remove `binaryen` from `package.json`

### Effort Estimate

| Phase | Effort |
|-------|--------|
| Encoder core (binary format, sections) | 2-3 days |
| Expression tree → bytecode serialization | 2-3 days |
| Integration + migration (13 files) | 1-2 days |
| Testing + validation against binaryen output | 2-3 days |
| **Total** | **~7-11 days** |

This is significantly less than the 2-4 week estimate in #198 because the API surface is smaller than anticipated.

---

## Files and Resources

| Resource | Purpose |
|----------|---------|
| [WASM Binary Format Spec](https://webassembly.github.io/spec/core/binary/) | Reference for binary encoding |
| [`src/codegen/`](../src/codegen/) | All files that import binaryen |
| [`src/ir/optimize.ts`](../src/ir/optimize.ts) | Edict's own optimization (makes binaryen's `optimize()` non-essential) |
