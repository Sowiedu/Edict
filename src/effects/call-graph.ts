// =============================================================================
// Call Graph Builder
// =============================================================================
// Walks expression trees to discover function call edges for effect checking.
// Only ident-based calls create edges. Lambdas are opaque.

import type {
    EdictModule,
    Expression,
    ConcreteEffect,
    ApprovalGate,
} from "../ast/nodes.js";
import { isConcreteEffect } from "../ast/nodes.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { walkExpression } from "../ast/walk.js";

// =============================================================================
// Types
// =============================================================================

export interface CallEdge {
    calleeName: string;
    callSiteNodeId: string;
}

export type CallGraph = Map<string, CallEdge[]>;

/**
 * Minimal interface for anything that can source effects in the call graph.
 * Covers user functions, builtins, typed imports, and tool definitions —
 * without requiring synthetic FunctionDef casts.
 */
export interface EffectSource {
    name: string;
    id: string;
    effects: ConcreteEffect[];
    approval?: ApprovalGate;
}

// =============================================================================
// Expression Walker
// =============================================================================

/**
 * Walk expressions and collect all ident-based function calls.
 * Recurses into all expression types except lambda bodies (opaque).
 *
 * @param exprs - Array of expressions to walk
 * @returns Array of call edges discovered (callee name + call site node ID)
 */
export function collectCalls(exprs: Expression[]): CallEdge[] {
    const edges: CallEdge[] = [];

    for (const expr of exprs) {
        walkExpression(expr, {
            enter(node) {
                if (node.kind === "lambda") {
                    // Opaque — do not recurse into lambda body
                    return false;
                }
                if (node.kind === "call" && node.fn.kind === "ident") {
                    // Ident-based call → record edge
                    edges.push({
                        calleeName: node.fn.name,
                        callSiteNodeId: node.id,
                    });
                }
                if (node.kind === "tool_call") {
                    // Tool invocation → record edge to registered tool
                    edges.push({
                        calleeName: node.tool,
                        callSiteNodeId: node.id,
                    });
                }
            }
        });
    }

    return edges;
}

// =============================================================================
// Call Graph Builder
// =============================================================================

/**
 * Build the module call graph: edges per function, effect sources, and imported names.
 * Only walks FunctionDef.body — contracts are Z3 specs, not runtime code.
 *
 * @param module - A validated Edict module
 * @returns `{ graph, effectSources, functionDefs, importedNames }`
 */
export function buildCallGraph(module: EdictModule): {
    graph: CallGraph;
    effectSources: Map<string, EffectSource>;
    importedNames: Set<string>;
    /** @deprecated Use effectSources — kept for backward compat */
    functionDefs: Map<string, EffectSource>;
} {
    const graph: CallGraph = new Map();
    const effectSources = new Map<string, EffectSource>();
    const importedNames = new Set<string>();

    // Register builtins
    for (const [name, builtin] of BUILTIN_FUNCTIONS) {
        effectSources.set(name, {
            name,
            id: `builtin-${name}`,
            effects: builtin.type.effects.filter(isConcreteEffect),
        });
    }

    // Collect imported names — register typed imports with effects
    for (const imp of module.imports) {
        for (const name of imp.names) {
            const declaredType = imp.types?.[name];
            if (declaredType && declaredType.kind === "fn_type" && declaredType.effects.length > 0) {
                // Filter out effect variables — only concrete effects are checked
                const concreteEffects = declaredType.effects.filter(isConcreteEffect);
                effectSources.set(name, {
                    name,
                    id: `import-${imp.module}-${name}`,
                    effects: concreteEffects,
                });
            } else {
                importedNames.add(name);
            }
        }
    }

    // Collect function definitions and tool definitions
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            effectSources.set(def.name, {
                name: def.name,
                id: def.id,
                effects: [...def.effects],
                approval: def.approval,
            });
        } else if (def.kind === "tool") {
            // Tools declare their own effects — no implicit additions.
            // tool_call wraps results in Result<T, String>, so failures
            // are values, not effects.
            effectSources.set(def.name, {
                name: def.name,
                id: def.id,
                effects: [...def.effects],
            });
        }
    }

    // Build edges for each user function (not builtins)
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            graph.set(def.name, collectCalls(def.body));
        }
    }

    return { graph, effectSources, importedNames, functionDefs: effectSources };
}
