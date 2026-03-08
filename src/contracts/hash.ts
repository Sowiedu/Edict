// =============================================================================
// Structural Hash for Contract Verification Caching
// =============================================================================
// Produces a deterministic SHA-256 digest from a function's verification-
// relevant AST (params, contracts, body, returnType), stripping node `id`
// fields so that structurally identical functions with different IDs hash
// identically.  Incorporates transitive dependency hashes for callsite
// precondition cache invalidation.

import { createHash } from "node:crypto";
import type { FunctionDef } from "../ast/nodes.js";

/**
 * Recursively strips `id` fields from an AST value and produces a
 * canonical JSON string with sorted keys for deterministic hashing.
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
 * Compute a structural verification hash for a function definition.
 *
 * The hash covers params, contracts, body, returnType, and effects —
 * everything that affects verification semantics.  Node `id` fields are
 * stripped so cosmetically different IDs produce the same hash.
 *
 * @param fn   The function to hash.
 * @param deps Map of callee functions that have preconditions (transitive
 *             dependencies).  Their structural hashes are incorporated so
 *             that a callee contract change invalidates the caller cache.
 */
export function computeVerificationHash(
    fn: FunctionDef,
    deps: Map<string, FunctionDef>,
): string {
    const hasher = createHash("sha256");

    // Core function structure
    hasher.update("fn:");
    hasher.update(canonicalize(fn.params));
    hasher.update(canonicalize(fn.contracts));
    hasher.update(canonicalize(fn.body));
    hasher.update(canonicalize(fn.returnType));
    hasher.update(canonicalize(fn.effects));

    // Transitive dependencies: sorted by name for determinism
    if (deps.size > 0) {
        const sortedNames = [...deps.keys()].sort();
        for (const name of sortedNames) {
            const dep = deps.get(name)!;
            hasher.update("dep:" + name + ":");
            hasher.update(canonicalize(dep.params));
            hasher.update(canonicalize(dep.contracts));
            hasher.update(canonicalize(dep.body));
            hasher.update(canonicalize(dep.returnType));
        }
    }

    return hasher.digest("hex");
}
