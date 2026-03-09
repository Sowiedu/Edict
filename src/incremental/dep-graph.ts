// =============================================================================
// Definition-Level Dependency Graph
// =============================================================================
// Builds a graph of which definitions depend on which — via call edges and
// type reference edges.  Used by incremental checking to compute the set of
// definitions that need re-verification after a patch.

import type { EdictModule, Expression, FunctionDef } from "../ast/nodes.js";
import type { TypeExpr } from "../ast/types.js";
import { collectCalls } from "../effects/call-graph.js";
import { walkExpression } from "../ast/walk.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Forward dependency graph: for each definition name, the set of definition
 * names it depends on (calls or references by type).
 */
export interface DepGraph {
    /** Forward edges: name → set of names it depends on */
    forward: Map<string, Set<string>>;
    /** Reverse edges: name → set of names that depend on it */
    reverse: Map<string, Set<string>>;
    /** All definition names in the module */
    allNames: Set<string>;
}

// =============================================================================
// Graph Builder
// =============================================================================

/**
 * Build a definition-level dependency graph from an EdictModule.
 *
 * Edges come from two sources:
 * 1. Call edges — function A calls function B
 * 2. Type reference edges — definition uses a named type (record, enum, type alias)
 */
export function buildDepGraph(module: EdictModule): DepGraph {
    const forward = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    const allNames = new Set<string>();

    // Collect all definition names
    for (const def of module.definitions) {
        allNames.add(def.name);
        forward.set(def.name, new Set());
    }

    // Ensure reverse map has entries for all names
    for (const name of allNames) {
        reverse.set(name, new Set());
    }

    // Build edges for each definition
    for (const def of module.definitions) {
        const deps = forward.get(def.name)!;

        switch (def.kind) {
            case "fn":
                collectFnDeps(def, deps, allNames);
                break;
            case "const":
                collectTypeDeps(def.type, deps, allNames);
                collectExprTypeDeps(def.value, deps, allNames);
                break;
            case "record":
                for (const field of def.fields) {
                    collectTypeDeps(field.type, deps, allNames);
                    if (field.defaultValue) {
                        collectExprTypeDeps(field.defaultValue, deps, allNames);
                    }
                }
                break;
            case "enum":
                for (const variant of def.variants) {
                    for (const field of variant.fields) {
                        collectTypeDeps(field.type, deps, allNames);
                    }
                }
                break;
            case "type":
                collectTypeDeps(def.definition, deps, allNames);
                break;
        }
    }

    // Build reverse edges
    for (const [name, deps] of forward) {
        for (const dep of deps) {
            let rev = reverse.get(dep);
            if (!rev) {
                rev = new Set();
                reverse.set(dep, rev);
            }
            rev.add(name);
        }
    }

    return { forward, reverse, allNames };
}

// =============================================================================
// Dependency Collectors
// =============================================================================

/**
 * Collect dependencies for a function definition:
 * - Call edges from function body
 * - Type references from params, return type, contracts
 */
function collectFnDeps(fn: FunctionDef, deps: Set<string>, allNames: Set<string>): void {
    // Call edges
    const callEdges = collectCalls(fn.body);
    for (const edge of callEdges) {
        if (allNames.has(edge.calleeName)) {
            deps.add(edge.calleeName);
        }
    }

    // Param type refs
    for (const param of fn.params) {
        if (param.type) collectTypeDeps(param.type, deps, allNames);
    }

    // Return type refs
    if (fn.returnType) collectTypeDeps(fn.returnType, deps, allNames);

    // Contract expression refs (contracts may reference other functions/types)
    for (const contract of fn.contracts) {
        collectExprTypeDeps(contract.condition, deps, allNames);
    }

    // Body expression type refs (record_expr, enum_constructor, etc.)
    for (const expr of fn.body) {
        collectExprTypeDeps(expr, deps, allNames);
    }
}

/**
 * Collect type-name dependencies from a TypeExpr.
 */
function collectTypeDeps(type: TypeExpr, deps: Set<string>, allNames: Set<string>): void {
    switch (type.kind) {
        case "named":
            if (allNames.has(type.name)) deps.add(type.name);
            break;
        case "array":
            collectTypeDeps(type.element, deps, allNames);
            break;
        case "option":
            collectTypeDeps(type.inner, deps, allNames);
            break;
        case "result":
            collectTypeDeps(type.ok, deps, allNames);
            collectTypeDeps(type.err, deps, allNames);
            break;
        case "fn_type":
            for (const p of type.params) collectTypeDeps(p, deps, allNames);
            collectTypeDeps(type.returnType, deps, allNames);
            break;
        case "tuple":
            for (const el of type.elements) collectTypeDeps(el, deps, allNames);
            break;
        case "refined":
            collectTypeDeps(type.base, deps, allNames);
            break;
        // basic, unit_type — no named-type dependencies
    }
}

/**
 * Collect type-name dependencies from expressions (record_expr, enum_constructor, etc.)
 */
function collectExprTypeDeps(expr: Expression, deps: Set<string>, allNames: Set<string>): void {
    walkExpression(expr, {
        enter(node) {
            if (node.kind === "record_expr") {
                if (allNames.has(node.name)) deps.add(node.name);
            } else if (node.kind === "enum_constructor") {
                if (allNames.has(node.enumName)) deps.add(node.enumName);
            } else if (node.kind === "lambda") {
                // Don't recurse into lambdas — they're opaque for dep purposes
                return false;
            }
        }
    });
}

// =============================================================================
// Transitive Dependents
// =============================================================================

/**
 * Given a set of changed definition names, compute all definitions that
 * transitively depend on any changed definition (via reverse edges).
 *
 * Returns the union of `changedNames` and all their transitive dependents.
 */
export function transitiveDependents(graph: DepGraph, changedNames: Set<string>): Set<string> {
    const affected = new Set<string>();
    const queue = [...changedNames];

    while (queue.length > 0) {
        const name = queue.pop()!;
        if (affected.has(name)) continue;
        affected.add(name);

        // Follow reverse edges
        const dependents = graph.reverse.get(name);
        if (dependents) {
            for (const dep of dependents) {
                if (!affected.has(dep)) {
                    queue.push(dep);
                }
            }
        }
    }

    return affected;
}
