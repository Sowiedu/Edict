// =============================================================================
// Builtin type definitions — shared by registry and domain files
// =============================================================================
// Extracted to break the circular import between registry.ts ↔ domain files.

import type { FunctionType } from "../ast/types.js";
import type { HostContext } from "./host-helpers.js";
import type * as binaryen from "../codegen/wasm-encoder.js";

/** Co-located builtin definition — type signature + implementation together. */
export interface BuiltinDef {
    /** Builtin function name (e.g., "print", "array_map"). */
    name: string;
    /** Edict-level function type signature (includes effects, params, returnType). */
    type: FunctionType;
    /** Implementation: host-imported or WASM-native. */
    impl: BuiltinImpl;
    /**
     * Whether this builtin's output depends on external state (time, random, IO).
     * Required for host builtins with "reads" effect — enforced by test.
     * When true, createHostImports auto-wraps the factory for record/replay.
     */
    nondeterministic?: boolean;
    /**
     * Provenance source tag for return values (e.g., "io:http", "io:random").
     * When set, the type checker auto-wraps the return type in ProvenanceType
     * so agents get data-origin tracking without manual annotation.
     */
    provenance?: string;
}

export type BuiltinImpl =
    | { kind: "host"; factory: (ctx: HostContext) => Function }
    | { kind: "wasm"; generator: (mod: binaryen.Module) => void };
