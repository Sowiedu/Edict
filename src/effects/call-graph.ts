// =============================================================================
// Call Graph Builder
// =============================================================================
// Walks expression trees to discover function call edges for effect checking.
// Only ident-based calls create edges. Lambdas are opaque.

import type {
    EdictModule,
    Expression,
    FunctionDef,
} from "../ast/nodes.js";
import { BUILTIN_FUNCTIONS } from "../codegen/builtins.js";

// =============================================================================
// Types
// =============================================================================

export interface CallEdge {
    calleeName: string;
    callSiteNodeId: string;
}

export type CallGraph = Map<string, CallEdge[]>;

// =============================================================================
// Expression Walker
// =============================================================================

/**
 * Walk expressions and collect all ident-based function calls.
 * Recurses into all expression types except lambda bodies (opaque).
 */
export function collectCalls(exprs: Expression[]): CallEdge[] {
    const edges: CallEdge[] = [];

    function walk(expr: Expression): void {
        switch (expr.kind) {
            case "call":
                // Always recurse into args
                for (const arg of expr.args) walk(arg);

                if (expr.fn.kind === "ident") {
                    // Ident-based call → record edge
                    edges.push({
                        calleeName: expr.fn.name,
                        callSiteNodeId: expr.id,
                    });
                } else {
                    // Non-ident fn (e.g., complex expression) → no edge, but walk fn
                    walk(expr.fn);
                }
                break;

            case "if":
                walk(expr.condition);
                for (const e of expr.then) walk(e);
                if (expr.else) {
                    for (const e of expr.else) walk(e);
                }
                break;

            case "let":
                walk(expr.value);
                break;

            case "match":
                walk(expr.target);
                for (const arm of expr.arms) {
                    for (const e of arm.body) walk(e);
                }
                break;

            case "block":
                for (const e of expr.body) walk(e);
                break;

            case "binop":
                walk(expr.left);
                walk(expr.right);
                break;

            case "unop":
                walk(expr.operand);
                break;

            case "array":
            case "tuple_expr":
                for (const e of expr.elements) walk(e);
                break;

            case "record_expr":
            case "enum_constructor":
                for (const f of expr.fields) walk(f.value);
                break;

            case "access":
                walk(expr.target);
                break;

            case "lambda":
                // Opaque — do not recurse into lambda body
                break;

            case "literal":
            case "ident":
                // Leaf nodes — no recursion
                break;
        }
    }

    for (const expr of exprs) walk(expr);
    return edges;
}

// =============================================================================
// Call Graph Builder
// =============================================================================

/**
 * Build the module call graph: edges per function, function defs, and imported names.
 * Only walks FunctionDef.body — contracts are Z3 specs, not runtime code.
 */
export function buildCallGraph(module: EdictModule): {
    graph: CallGraph;
    functionDefs: Map<string, FunctionDef>;
    importedNames: Set<string>;
} {
    const graph: CallGraph = new Map();
    const functionDefs = new Map<string, FunctionDef>();
    const importedNames = new Set<string>();

    // Register builtins as synthetic function defs so effect checker
    // can verify callers declare the correct effects.
    for (const [name, builtin] of BUILTIN_FUNCTIONS) {
        functionDefs.set(name, {
            kind: "fn",
            id: `builtin-${name}`,
            name,
            params: [],
            returnType: builtin.type.returnType,
            effects: [...builtin.effects],
            contracts: [],
            body: [],
        } as FunctionDef);
    }

    // Collect imported names
    for (const imp of module.imports) {
        for (const name of imp.names) {
            importedNames.add(name);
        }
    }

    // Collect function definitions
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            functionDefs.set(def.name, def);
        }
    }

    // Build edges for each user function (not builtins)
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            graph.set(def.name, collectCalls(def.body));
        }
    }

    return { graph, functionDefs, importedNames };
}
