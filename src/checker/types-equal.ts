// =============================================================================
// Structural Type Equality
// =============================================================================

import type { TypeExpr } from "../ast/types.js";
import type { TypeEnv } from "./type-env.js";

/**
 * Check structural type equality after alias resolution.
 * - `unknown` is compatible with anything (returns true).
 * - `RefinedType { base: T }` is compatible with `T` (refinement erasure).
 */
export function typesEqual(a: TypeExpr, b: TypeExpr, env: TypeEnv): boolean {
    // Resolve aliases first
    const ra = resolveType(a, env);
    const rb = resolveType(b, env);

    // unknown propagation — always compatible
    if (isUnknown(ra) || isUnknown(rb)) return true;

    // Same kind check
    if (ra.kind !== rb.kind) return false;

    switch (ra.kind) {
        case "basic":
            return rb.kind === "basic" && ra.name === rb.name;

        case "array":
            return rb.kind === "array" && typesEqual(ra.element, rb.element, env);

        case "option":
            return rb.kind === "option" && typesEqual(ra.inner, rb.inner, env);

        case "result":
            return (
                rb.kind === "result" &&
                typesEqual(ra.ok, rb.ok, env) &&
                typesEqual(ra.err, rb.err, env)
            );

        case "unit_type":
            return (
                rb.kind === "unit_type" &&
                ra.base === rb.base &&
                ra.unit === rb.unit
            );

        case "fn_type":
            if (rb.kind !== "fn_type") return false;
            if (ra.params.length !== rb.params.length) return false;
            for (let i = 0; i < ra.params.length; i++) {
                if (!typesEqual(ra.params[i]!, rb.params[i]!, env)) return false;
            }
            return typesEqual(ra.returnType, rb.returnType, env);

        case "named":
            return rb.kind === "named" && ra.name === rb.name;

        case "tuple":
            if (rb.kind !== "tuple") return false;
            if (ra.elements.length !== rb.elements.length) return false;
            for (let i = 0; i < ra.elements.length; i++) {
                if (!typesEqual(ra.elements[i]!, rb.elements[i]!, env)) return false;
            }
            return true;

        case "refined":
            // After erasure this is already handled by resolveForComparison
            // But if both are refined, compare bases
            return rb.kind === "refined" && typesEqual(ra.base, rb.base, env);
    }
}

/**
 * Resolve a type for comparison: alias resolution + refinement erasure.
 */
export function resolveType(type: TypeExpr, env: TypeEnv): TypeExpr {
    let resolved = env.resolveAlias(type);
    if (resolved.kind === "refined") {
        resolved = resolveType(resolved.base, env);
    }
    return resolved;
}

/**
 * Check if a type is "unknown" (an unresolvable named type).
 * We encode `unknown` as Named("unknown") — imported symbols get this type.
 */
export function isUnknown(type: TypeExpr): boolean {
    return type.kind === "named" && type.name === "unknown";
}

