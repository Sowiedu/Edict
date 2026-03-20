// =============================================================================
// Type Variable Unification — lightweight ad-hoc unification for builtins
// =============================================================================
// When a builtin's fn_type contains type_var nodes (e.g., array_get: Array<T> → T),
// this module unifies those type variables with concrete argument types at the call site.

import type { TypeExpr } from "../ast/types.js";

/**
 * Extract type variable bindings by matching param types against argument types.
 *
 * Walks param/arg type trees in parallel. When a param type is `type_var`,
 * records the binding from the variable name to the concrete arg type.
 *
 * Example:
 *   paramTypes: [Array<T>, Int]
 *   argTypes:   [Array<String>, Int]
 *   → Map { "T" → String }
 */
export function unifyTypeVars(
    paramTypes: TypeExpr[],
    argTypes: TypeExpr[],
): Map<string, TypeExpr> {
    const bindings = new Map<string, TypeExpr>();
    const count = Math.min(paramTypes.length, argTypes.length);
    for (let i = 0; i < count; i++) {
        unifyOne(paramTypes[i]!, argTypes[i]!, bindings);
    }
    return bindings;
}

function unifyOne(
    paramType: TypeExpr,
    argType: TypeExpr,
    bindings: Map<string, TypeExpr>,
): void {
    // Direct type_var match
    if (paramType.kind === "type_var") {
        if (!bindings.has(paramType.name)) {
            bindings.set(paramType.name, argType);
        }
        return;
    }

    // Recurse into container structures
    if (paramType.kind === "array" && argType.kind === "array") {
        unifyOne(paramType.element, argType.element, bindings);
    } else if (paramType.kind === "option" && argType.kind === "option") {
        unifyOne(paramType.inner, argType.inner, bindings);
    } else if (paramType.kind === "result" && argType.kind === "result") {
        unifyOne(paramType.ok, argType.ok, bindings);
        unifyOne(paramType.err, argType.err, bindings);
    } else if (paramType.kind === "fn_type" && argType.kind === "fn_type") {
        // Unify callback param/return types
        const count = Math.min(paramType.params.length, argType.params.length);
        for (let i = 0; i < count; i++) {
            unifyOne(paramType.params[i]!, argType.params[i]!, bindings);
        }
        unifyOne(paramType.returnType, argType.returnType, bindings);
    } else if (paramType.kind === "tuple" && argType.kind === "tuple") {
        const count = Math.min(paramType.elements.length, argType.elements.length);
        for (let i = 0; i < count; i++) {
            unifyOne(paramType.elements[i]!, argType.elements[i]!, bindings);
        }
    }
}

/**
 * Substitute all type_var references in a type with their bound concrete types.
 * Returns the original type unchanged if no type_var nodes are present.
 */
export function substituteTypeVars(
    type: TypeExpr,
    bindings: Map<string, TypeExpr>,
): TypeExpr {
    if (bindings.size === 0) return type;

    switch (type.kind) {
        case "type_var": {
            const bound = bindings.get(type.name);
            return bound ?? type;
        }

        case "array":
            return { kind: "array", element: substituteTypeVars(type.element, bindings) };

        case "option":
            return { kind: "option", inner: substituteTypeVars(type.inner, bindings) };

        case "result":
            return {
                kind: "result",
                ok: substituteTypeVars(type.ok, bindings),
                err: substituteTypeVars(type.err, bindings),
            };

        case "fn_type":
            return {
                kind: "fn_type",
                params: type.params.map(p => substituteTypeVars(p, bindings)),
                effects: type.effects,
                returnType: substituteTypeVars(type.returnType, bindings),
            };

        case "tuple":
            return {
                kind: "tuple",
                elements: type.elements.map(e => substituteTypeVars(e, bindings)),
            };

        // Leaf types — no type_var inside
        case "basic":
        case "named":
        case "unit_type":
        case "confidence":
        case "provenance":
        case "capability":
        case "fresh":
        case "refined":
            return type;
    }
}

/**
 * Check if a type (or any type nested within it) contains type_var nodes.
 */
export function containsTypeVars(type: TypeExpr): boolean {
    switch (type.kind) {
        case "type_var":
            return true;
        case "array":
            return containsTypeVars(type.element);
        case "option":
            return containsTypeVars(type.inner);
        case "result":
            return containsTypeVars(type.ok) || containsTypeVars(type.err);
        case "fn_type":
            return type.params.some(containsTypeVars) || containsTypeVars(type.returnType);
        case "tuple":
            return type.elements.some(containsTypeVars);
        default:
            return false;
    }
}
