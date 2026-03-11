// =============================================================================
// Builtin Registry — runtime concerns (host imports + WASM generators)
// =============================================================================
// Re-exports type metadata from builtin-meta.ts (Node-free) and adds
// runtime-specific code: createHostImports (needs NodeHostAdapter) and
// generateWasmBuiltins (needs binaryen). Only codegen should import this.
//
// For type metadata only (resolver, checker, effects), import from
// builtin-meta.ts or builtins.ts instead.

import type { EdictHostAdapter } from "../codegen/host-adapter.js";
import { NodeHostAdapter } from "../codegen/node-host-adapter.js";
import type { RuntimeState, HostContext } from "./host-helpers.js";
import type binaryen from "binaryen";

import type { ReplayEntry } from "../codegen/replay-types.js";

// Re-export types so consumers can import from registry or builtin-types
export type { BuiltinDef, BuiltinImpl } from "./builtin-types.js";

// Re-export all metadata from builtin-meta (the Node-free source of truth)
export { ALL_BUILTINS, BUILTIN_FUNCTIONS, isBuiltin, getBuiltin } from "./builtin-meta.js";
export type { BuiltinFunction } from "./builtin-meta.js";

// Import ALL_BUILTINS locally for use in createHostImports/generateWasmBuiltins
import { ALL_BUILTINS } from "./builtin-meta.js";

// =============================================================================
// Replay log mode — controls record/replay behavior for nondeterministic builtins
// =============================================================================

/** Record mode: log nondeterministic host calls. */
export type ReplayLogRecord = { mode: "record"; entries: ReplayEntry[] };
/** Replay mode: return pre-recorded values. */
export type ReplayLogReplay = { mode: "replay"; entries: ReplayEntry[]; cursor: { i: number } };
/** Combined replay log type. */
export type ReplayLog = ReplayLogRecord | ReplayLogReplay;

/**
 * Wrap a host function for record or replay mode.
 * - Record: calls the real function and logs the result.
 * - Replay: skips the real function and returns the recorded result.
 */
function wrapForReplay(name: string, fn: Function, log: ReplayLog): Function {
    if (log.mode === "record") {
        return (...args: unknown[]) => {
            const result = fn(...args);
            log.entries.push({ kind: name, args, result });
            return result;
        };
    } else {
        return (..._args: unknown[]) => {
            if (log.cursor.i >= log.entries.length) {
                throw new Error(`replay_token_exhausted: expected "${name}" at position ${log.cursor.i}`);
            }
            const entry = log.entries[log.cursor.i]!;
            log.cursor.i++;
            return entry.result;
        };
    }
}

// =============================================================================
// Host import factory — derives host imports from registry
// =============================================================================

/**
 * Create the complete host import object for WASM instantiation.
 * Iterates all host-kind builtins in the registry and builds a single
 * flat { host: { ... } } object.
 *
 * When a replayLog is provided, builtins tagged `nondeterministic: true`
 * are automatically wrapped to record or replay their calls.
 *
 * @param state — mutable runtime state shared across all host functions.
 *                `state.instance` must be set after `WebAssembly.instantiate()`
 *                but before calling any exported WASM function.
 * @param adapter — optional platform-specific adapter. Defaults to NodeHostAdapter.
 * @param replayLog — optional record/replay log for nondeterministic builtins.
 */
export function createHostImports(
    state: RuntimeState,
    adapter?: EdictHostAdapter,
    replayLog?: ReplayLog,
): Record<string, Record<string, unknown>> {
    const hostAdapter = adapter ?? new NodeHostAdapter(state.sandboxDir);
    const ctx: HostContext = {
        state,
        adapter: hostAdapter,
        encoder: new TextEncoder(),
        decoder: new TextDecoder(),
    };

    const hostFunctions: Record<string, unknown> = {};
    for (const def of ALL_BUILTINS) {
        if (def.impl.kind === "host") {
            let fn = def.impl.factory(ctx);
            // Auto-wrap nondeterministic builtins for record/replay
            if (def.nondeterministic && replayLog) {
                fn = wrapForReplay(def.name, fn, replayLog);
            }
            hostFunctions[def.name] = fn;
        }
    }

    return { host: hostFunctions };
}

// =============================================================================
// WASM builtin generator — runs all WASM-native generators from registry
// =============================================================================

/**
 * Generate all WASM-native builtin functions (HOFs) from the registry.
 * Called by codegen.ts after compiling user functions.
 */
export function generateWasmBuiltins(mod: binaryen.Module): void {
    for (const def of ALL_BUILTINS) {
        if (def.impl.kind === "wasm") {
            def.impl.generator(mod);
        }
    }
}
