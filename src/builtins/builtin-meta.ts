// =============================================================================
// Builtin Metadata — pure type signatures and lookup, no runtime dependencies
// =============================================================================
// This module provides BUILTIN_FUNCTIONS, isBuiltin, and getBuiltin derived
// from the domain definitions. It does NOT import any Node-specific or
// codegen-specific modules, making it safe for browser/edge environments.
//
// Used by: resolver, checker, effect-checker (need type metadata only).
// For WASM runtime (createHostImports, generateWasmBuiltins), use registry.ts.

import type { FunctionType } from "../ast/types.js";
import type { BuiltinDef } from "./builtin-types.js";

// ── Domain imports (all Node-free) ─────────────────────────────────────────

import { CORE_BUILTINS } from "./domains/core.js";
import { STRING_BUILTINS } from "./domains/string.js";
import { MATH_BUILTINS } from "./domains/math.js";
import { TYPE_CONVERSION_BUILTINS } from "./domains/type-conversion.js";
import { INT64_BUILTINS } from "./domains/int64.js";
import { ARRAY_BUILTINS } from "./domains/array.js";
import { OPTION_BUILTINS } from "./domains/option.js";
import { RESULT_BUILTINS } from "./domains/result.js";
import { JSON_BUILTINS } from "./domains/json.js";
import { RANDOM_BUILTINS } from "./domains/random.js";
import { DATETIME_BUILTINS } from "./domains/datetime.js";
import { REGEX_BUILTINS } from "./domains/regex.js";
import { CRYPTO_BUILTINS } from "./domains/crypto.js";
import { HTTP_BUILTINS } from "./domains/http.js";
import { IO_BUILTINS } from "./domains/io.js";

// =============================================================================
// All builtins from all domains
// =============================================================================

/** All builtins from all domains, composed in one flat array. */
export const ALL_BUILTINS: readonly BuiltinDef[] = [
    ...CORE_BUILTINS,
    ...STRING_BUILTINS,
    ...MATH_BUILTINS,
    ...TYPE_CONVERSION_BUILTINS,
    ...INT64_BUILTINS,
    ...ARRAY_BUILTINS,
    ...OPTION_BUILTINS,
    ...RESULT_BUILTINS,
    ...JSON_BUILTINS,
    ...RANDOM_BUILTINS,
    ...DATETIME_BUILTINS,
    ...REGEX_BUILTINS,
    ...CRYPTO_BUILTINS,
    ...HTTP_BUILTINS,
    ...IO_BUILTINS,
];

// =============================================================================
// Derived metadata maps
// =============================================================================

/**
 * Backward-compatible builtin interface — type metadata only.
 * Used by resolver, checker, codegen, etc.
 */
export interface BuiltinFunction {
    /** Edict-level function type signature (includes effects, params, returnType) */
    type: FunctionType;
    /** WASM import: [module, base] names */
    wasmImport: [string, string];
    /** Provenance source tag — auto-wraps return type in ProvenanceType at the checker level */
    provenance?: string;
}

/** Derive the WASM import path from the implementation kind. */
function deriveWasmImport(def: BuiltinDef): [string, string] {
    return def.impl.kind === "host"
        ? ["host", def.name]
        : ["__wasm", def.name];
}

/**
 * Backward-compatible builtin function map — derived from the registry.
 * Same API as the old BUILTIN_FUNCTIONS in builtins.ts.
 */
export const BUILTIN_FUNCTIONS: ReadonlyMap<string, BuiltinFunction> = new Map(
    ALL_BUILTINS.map(b => [b.name, {
        type: b.type,
        wasmImport: deriveWasmImport(b),
        ...(b.provenance ? { provenance: b.provenance } : {}),
    }])
);

/**
 * Check if a name refers to a built-in function.
 */
export function isBuiltin(name: string): boolean {
    return BUILTIN_FUNCTIONS.has(name);
}

/**
 * Get the built-in function definition, or undefined.
 */
export function getBuiltin(name: string): BuiltinFunction | undefined {
    return BUILTIN_FUNCTIONS.get(name);
}
