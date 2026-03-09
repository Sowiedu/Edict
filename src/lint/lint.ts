// =============================================================================
// Lint Engine — lint(module) → LintWarning[]
// =============================================================================
// Non-blocking analysis pass. Runs on a validated module (post-Phase 1).
// Returns structured warnings without blocking compilation.

import type { EdictModule, Expression, FunctionDef, Effect } from "../ast/nodes.js";
import { buildCallGraph } from "../effects/call-graph.js";
import {
    unusedVariable,
    unusedImport,
    missingContract,
    oversizedFunction,
    emptyBody,
    redundantEffect,
    decompositionSuggested,
    type LintWarning,
    type SuggestedSplit,
} from "./warnings.js";

// Re-export for convenience
export type { LintWarning } from "./warnings.js";

/** Default threshold for oversized function warning */
const OVERSIZED_THRESHOLD = 50;

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run lint analysis on a validated Edict module.
 * Returns an array of non-blocking warnings.
 */
export function lint(module: EdictModule): LintWarning[] {
    const warnings: LintWarning[] = [];

    checkUnusedImports(module, warnings);
    checkFunctionWarnings(module, warnings);
    checkRedundantEffects(module, warnings);
    checkDecomposition(module, warnings);

    return warnings;
}

// =============================================================================
// Unused imports
// =============================================================================

function checkUnusedImports(module: EdictModule, warnings: LintWarning[]): void {
    if (module.imports.length === 0) return;

    // Collect all referenced names across all definitions
    const referencedNames = new Set<string>();
    for (const def of module.definitions) {
        switch (def.kind) {
            case "fn":
                collectReferencedNames(def.body, referencedNames);
                for (const contract of def.contracts) {
                    collectReferencedNamesFromExpr(contract.condition, referencedNames);
                }
                break;
            case "const":
                collectReferencedNamesFromExpr(def.value, referencedNames);
                break;
            case "record":
                for (const field of def.fields) {
                    if (field.defaultValue) {
                        collectReferencedNamesFromExpr(field.defaultValue, referencedNames);
                    }
                }
                break;
            case "enum":
                for (const variant of def.variants) {
                    for (const field of variant.fields) {
                        if (field.defaultValue) {
                            collectReferencedNamesFromExpr(field.defaultValue, referencedNames);
                        }
                    }
                }
                break;
        }
    }

    // Check each import for unused names
    for (const imp of module.imports) {
        const unused = imp.names.filter(n => !referencedNames.has(n));
        if (unused.length > 0) {
            warnings.push(unusedImport(imp.id, imp.module, unused));
        }
    }
}

// =============================================================================
// Per-function warnings: unused variables, missing contracts, oversized, empty
// =============================================================================

function checkFunctionWarnings(module: EdictModule, warnings: LintWarning[]): void {
    for (const def of module.definitions) {
        if (def.kind !== "fn") continue;

        // Empty body
        if (def.body.length === 0) {
            warnings.push(emptyBody(def.id, def.name));
            continue; // No point checking other warnings on empty body
        }

        // Missing contract (skip main — entry point, contracts less useful)
        if (def.contracts.length === 0 && def.name !== "main") {
            warnings.push(missingContract(def.id, def.name));
        }

        // Oversized function
        const nodeCount = countExprNodes(def.body);
        if (nodeCount > OVERSIZED_THRESHOLD) {
            warnings.push(oversizedFunction(def.id, def.name, nodeCount, OVERSIZED_THRESHOLD));
        }

        // Unused variables
        checkUnusedVariables(def.body, warnings);
    }
}

/**
 * Check for unused let bindings in an expression list.
 * A let binding's scope covers subsequent sibling expressions.
 */
function checkUnusedVariables(exprs: Expression[], warnings: LintWarning[]): void {
    for (let i = 0; i < exprs.length; i++) {
        const expr = exprs[i]!;

        // Recurse into nested expression lists
        recurseIntoExprForUnused(expr, warnings);

        if (expr.kind === "let") {
            // Check if name is referenced in subsequent siblings
            const referencedInRest = new Set<string>();
            for (let j = i + 1; j < exprs.length; j++) {
                collectReferencedNamesFromExpr(exprs[j]!, referencedInRest);
            }
            if (!referencedInRest.has(expr.name)) {
                warnings.push(unusedVariable(expr.id, expr.name));
            }
        }
    }
}

/**
 * Recurse into sub-expression lists within an expression to check for unused variables.
 */
function recurseIntoExprForUnused(expr: Expression, warnings: LintWarning[]): void {
    switch (expr.kind) {
        case "if":
            if (expr.then) checkUnusedVariables(expr.then, warnings);
            if (expr.else) checkUnusedVariables(expr.else, warnings);
            break;
        case "match":
            for (const arm of expr.arms) {
                checkUnusedVariables(arm.body, warnings);
            }
            break;
        case "lambda":
            checkUnusedVariables(expr.body, warnings);
            break;
        case "block":
            checkUnusedVariables(expr.body, warnings);
            break;
    }
}

// =============================================================================
// Redundant effects
// =============================================================================

function checkRedundantEffects(module: EdictModule, warnings: LintWarning[]): void {
    const { graph, functionDefs, importedNames } = buildCallGraph(module);

    for (const def of module.definitions) {
        if (def.kind !== "fn") continue;
        if (def.effects.includes("pure")) continue; // Pure functions can't have redundant effects

        const declaredNonPure = new Set(def.effects.filter(e => e !== "pure"));
        if (declaredNonPure.size === 0) continue;

        // Compute required effects from call graph
        const required = computeRequiredEffects(def.name, graph, functionDefs, importedNames);
        const redundant = [...declaredNonPure].filter(e => !required.has(e));

        if (redundant.length > 0) {
            const requiredArray = required.size > 0 ? [...required] : [];
            warnings.push(redundantEffect(
                def.id,
                def.name,
                redundant as Effect[],
                requiredArray as Effect[],
            ));
        }
    }
}

/**
 * Compute the required non-pure effects for a function based on its call graph.
 * Walks callee edges transitively to find all effects needed.
 */
function computeRequiredEffects(
    fnName: string,
    graph: Map<string, { calleeName: string; callSiteNodeId: string | null }[]>,
    functionDefs: Map<string, FunctionDef>,
    importedNames: Set<string>,
): Set<string> {
    const required = new Set<string>();
    const visited = new Set<string>();

    function visit(name: string): void {
        if (visited.has(name)) return;
        visited.add(name);

        const edges = graph.get(name);
        if (!edges) return;

        for (const edge of edges) {
            // Skip imported functions — effect-opaque
            if (importedNames.has(edge.calleeName)) continue;

            const callee = functionDefs.get(edge.calleeName);
            if (!callee) continue;

            for (const effect of callee.effects) {
                if (effect !== "pure") {
                    required.add(effect);
                }
            }

            // Recurse into callee's callees
            visit(edge.calleeName);
        }
    }

    visit(fnName);
    return required;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Recursively collect all referenced identifier names from an expression list.
 */
function collectReferencedNames(exprs: Expression[], names: Set<string>): void {
    for (const expr of exprs) {
        collectReferencedNamesFromExpr(expr, names);
    }
}

/**
 * Recursively collect all referenced identifier names from a single expression.
 */
function collectReferencedNamesFromExpr(expr: Expression, names: Set<string>): void {
    switch (expr.kind) {
        case "ident":
            names.add(expr.name);
            break;
        case "literal":
            break;
        case "binop":
            collectReferencedNamesFromExpr(expr.left, names);
            collectReferencedNamesFromExpr(expr.right, names);
            break;
        case "unop":
            collectReferencedNamesFromExpr(expr.operand, names);
            break;
        case "call":
            collectReferencedNamesFromExpr(expr.fn, names);
            for (const arg of expr.args) {
                collectReferencedNamesFromExpr(arg, names);
            }
            break;
        case "if":
            collectReferencedNamesFromExpr(expr.condition, names);
            if (expr.then) collectReferencedNames(expr.then, names);
            if (expr.else) collectReferencedNames(expr.else, names);
            break;
        case "let":
            collectReferencedNamesFromExpr(expr.value, names);
            break;
        case "match":
            collectReferencedNamesFromExpr(expr.target, names);
            for (const arm of expr.arms) {
                collectReferencedNames(arm.body, names);
            }
            break;
        case "array":
            for (const el of expr.elements) {
                collectReferencedNamesFromExpr(el, names);
            }
            break;
        case "tuple_expr":
            for (const el of expr.elements) {
                collectReferencedNamesFromExpr(el, names);
            }
            break;
        case "record_expr":
            for (const f of expr.fields) {
                collectReferencedNamesFromExpr(f.value, names);
            }
            break;
        case "enum_constructor":
            for (const f of expr.fields) {
                collectReferencedNamesFromExpr(f.value, names);
            }
            break;
        case "access":
            collectReferencedNamesFromExpr(expr.target, names);
            break;
        case "lambda":
            collectReferencedNames(expr.body, names);
            break;
        case "block":
            collectReferencedNames(expr.body, names);
            break;
        case "string_interp":
            for (const part of expr.parts) {
                collectReferencedNamesFromExpr(part, names);
            }
            break;
    }
}

/**
 * Recursively count expression nodes in an expression list.
 */
function countExprNodes(exprs: Expression[]): number {
    let count = 0;
    for (const expr of exprs) {
        count += countExprNode(expr);
    }
    return count;
}

function countExprNode(expr: Expression): number {
    let count = 1; // Count this node
    switch (expr.kind) {
        case "literal":
        case "ident":
            break;
        case "binop":
            count += countExprNode(expr.left);
            count += countExprNode(expr.right);
            break;
        case "unop":
            count += countExprNode(expr.operand);
            break;
        case "call":
            count += countExprNode(expr.fn);
            for (const arg of expr.args) {
                count += countExprNode(arg);
            }
            break;
        case "if":
            count += countExprNode(expr.condition);
            if (expr.then) count += countExprNodes(expr.then);
            if (expr.else) count += countExprNodes(expr.else);
            break;
        case "let":
            count += countExprNode(expr.value);
            break;
        case "match":
            count += countExprNode(expr.target);
            for (const arm of expr.arms) {
                count += countExprNodes(arm.body);
            }
            break;
        case "array":
        case "tuple_expr":
            for (const el of expr.elements) {
                count += countExprNode(el);
            }
            break;
        case "record_expr":
        case "enum_constructor":
            for (const f of expr.fields) {
                count += countExprNode(f.value);
            }
            break;
        case "access":
            count += countExprNode(expr.target);
            break;
        case "lambda":
            count += countExprNodes(expr.body);
            break;
        case "block":
            count += countExprNodes(expr.body);
            break;
        case "string_interp":
            for (const part of expr.parts) {
                count += countExprNode(part);
            }
            break;
    }
    return count;
}

// =============================================================================
// Decomposition suggestions — reach-pointer segmentation
// =============================================================================

/**
 * Analyze oversized functions for decomposition opportunities.
 * Uses reach-pointer scanning: for each let-binding at position i,
 * find the last position j where its name is used. Track the furthest
 * reach — when the current position exceeds it, we've found a cut point
 * with no cross-segment dependencies.
 */
function checkDecomposition(module: EdictModule, warnings: LintWarning[]): void {
    for (const def of module.definitions) {
        if (def.kind !== "fn") continue;
        if (def.body.length < 2) continue;

        const nodeCount = countExprNodes(def.body);
        if (nodeCount <= OVERSIZED_THRESHOLD) continue;

        const segments = findSegments(def.body);
        if (segments.length < 2) continue;

        const splits: SuggestedSplit[] = segments.map((seg, idx) => ({
            name: `phase_${idx + 1}`,
            nodeRange: [seg.firstId, seg.lastId] as [string, string],
            nodeCount: seg.nodeCount,
        }));

        warnings.push(decompositionSuggested(def.id, def.name, splits));
    }
}

interface Segment {
    firstId: string;
    lastId: string;
    nodeCount: number;
}

/**
 * Find independent contiguous segments in a body using reach-pointer scanning,
 * then merge undersized segments into their predecessor.
 *
 * Algorithm:
 * 1. For each let-binding at position i defining name `x`,
 *    find the last position j where `x` is referenced.
 * 2. Scan left-to-right, tracking `reach` — the furthest position
 *    any definition in the current segment is still needed.
 * 3. When position i > reach, start a new segment.
 * 4. Merge any segment with fewer than MIN_SEGMENT_NODES into its predecessor
 *    to prevent degenerate tiny-segment suggestions.
 */
function findSegments(body: Expression[]): Segment[] {
    const MIN_SEGMENT_NODES = 10;

    // Step 1: Build name → last-use-position map
    const lastUse = new Map<string, number>();
    for (let i = 0; i < body.length; i++) {
        const refs = new Set<string>();
        collectReferencedNamesFromExpr(body[i]!, refs);
        for (const name of refs) {
            lastUse.set(name, i); // overwrites with latest position
        }
    }

    // Step 2: Build position → defined names map
    const definesAt = new Map<number, string[]>();
    for (let i = 0; i < body.length; i++) {
        const expr = body[i]!;
        if (expr.kind === "let") {
            const existing = definesAt.get(i) ?? [];
            existing.push(expr.name);
            definesAt.set(i, existing);
        }
    }

    // Step 3: Reach-pointer scan
    const rawSegments: Segment[] = [];
    let segStart = 0;
    let reach = 0; // furthest position any current-segment definition reaches

    for (let i = 0; i < body.length; i++) {
        // Check if we've passed beyond all dependencies of the current segment
        if (i > reach && i > segStart) {
            // Cut point found — close the current segment
            rawSegments.push(buildSegment(body, segStart, i - 1));
            segStart = i;
        }

        // Extend reach for any definitions at this position
        const defs = definesAt.get(i);
        if (defs) {
            for (const name of defs) {
                const last = lastUse.get(name);
                if (last !== undefined && last > reach) {
                    reach = last;
                }
            }
        }
    }

    // Close final segment
    rawSegments.push(buildSegment(body, segStart, body.length - 1));

    // Step 4: Merge undersized segments into predecessor
    if (rawSegments.length < 2) return rawSegments;

    const merged: Segment[] = [rawSegments[0]!];
    for (let i = 1; i < rawSegments.length; i++) {
        const seg = rawSegments[i]!;
        const prev = merged[merged.length - 1]!;
        if (seg.nodeCount < MIN_SEGMENT_NODES) {
            // Absorb into predecessor
            merged[merged.length - 1] = {
                firstId: prev.firstId,
                lastId: seg.lastId,
                nodeCount: prev.nodeCount + seg.nodeCount,
            };
        } else if (prev.nodeCount < MIN_SEGMENT_NODES) {
            // Previous was undersized but wasn't merged yet (was first segment);
            // merge current into it
            merged[merged.length - 1] = {
                firstId: prev.firstId,
                lastId: seg.lastId,
                nodeCount: prev.nodeCount + seg.nodeCount,
            };
        } else {
            merged.push(seg);
        }
    }

    return merged;
}

function buildSegment(body: Expression[], start: number, end: number): Segment {
    let nodeCount = 0;
    for (let i = start; i <= end; i++) {
        nodeCount += countExprNode(body[i]!);
    }
    return {
        firstId: body[start]!.id,
        lastId: body[end]!.id,
        nodeCount,
    };
}
