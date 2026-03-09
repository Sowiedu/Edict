// =============================================================================
// Definition Differ — diffDefinitions(before, after) → Set<string>
// =============================================================================
// Compares two EdictModules to identify which top-level definitions changed.
// Uses structural hashing (stripping node `id` fields) so that cosmetic ID
// changes don't trigger re-verification.

import { createHash } from "node:crypto";
import type { EdictModule, Definition } from "../ast/nodes.js";

// =============================================================================
// Structural Canonicalization
// =============================================================================

/**
 * Recursively strips `id` fields from an AST value and produces a
 * canonical JSON string with sorted keys for deterministic hashing.
 * Same approach as contracts/hash.ts canonicalize.
 */
function canonicalize(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalize).join(",") + "]";
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).filter(k => k !== "id").sort();
        return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
    }
    return String(value);
}

/**
 * Compute a structural hash for a single definition, stripping `id` fields.
 */
function hashDefinition(def: Definition): string {
    const hasher = createHash("sha256");
    hasher.update(canonicalize(def));
    return hasher.digest("hex");
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Compare two modules and return the set of definition names that changed.
 *
 * A definition is "changed" if:
 * - Its structural hash differs (body, params, contracts, etc. changed)
 * - It was added (exists in `after` but not `before`)
 * - It was deleted (exists in `before` but not `after`)
 *
 * Import changes: if the `imports` arrays differ structurally, all definitions
 * that could reference an import are marked dirty (conservatively, all fns and consts).
 */
export function diffDefinitions(before: EdictModule, after: EdictModule): Set<string> {
    const changed = new Set<string>();

    // Hash all definitions in both modules
    const beforeHashes = new Map<string, string>();
    for (const def of before.definitions) {
        beforeHashes.set(def.name, hashDefinition(def));
    }

    const afterHashes = new Map<string, string>();
    for (const def of after.definitions) {
        afterHashes.set(def.name, hashDefinition(def));
    }

    // Detect modified and added definitions
    for (const [name, afterHash] of afterHashes) {
        const beforeHash = beforeHashes.get(name);
        if (beforeHash === undefined || beforeHash !== afterHash) {
            changed.add(name);
        }
    }

    // Detect deleted definitions
    for (const name of beforeHashes.keys()) {
        if (!afterHashes.has(name)) {
            changed.add(name);
        }
    }

    // Import changes: if imports differ, mark all fns and consts as dirty
    // (conservative — they might reference imported names)
    if (importsChanged(before, after)) {
        for (const def of after.definitions) {
            if (def.kind === "fn" || def.kind === "const") {
                changed.add(def.name);
            }
        }
    }

    return changed;
}

/**
 * Check if import declarations changed between two modules.
 */
function importsChanged(before: EdictModule, after: EdictModule): boolean {
    const beforeImports = canonicalize(before.imports);
    const afterImports = canonicalize(after.imports);
    return beforeImports !== afterImports;
}
