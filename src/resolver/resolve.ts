// =============================================================================
// Name Resolution — resolve(module) → StructuredError[]
// =============================================================================
// Walks a validated AST and checks that every name reference resolves.
// Two passes: (1) collect top-level defs, (2) resolve all expressions/patterns.

import type {
    EdictModule,
    Definition,
    FunctionDef,
    Expression,
    Pattern,
    ConstDef,
    Contract,
    RecordDef,
    EnumDef,
    RecordField,
} from "../ast/nodes.js";
import type { TypeExpr, RefinedType } from "../ast/types.js";
import type { StructuredError } from "../errors/structured-errors.js";
import { undefinedReference, type FixSuggestion } from "../errors/structured-errors.js";
import { findCandidates } from "./levenshtein.js";
import { Scope, type SymbolInfo } from "./scope.js";
import type { FunctionType } from "../ast/types.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";

/**
 * Entry point: resolve all names in a validated Edict module.
 */
export function resolve(module: EdictModule): StructuredError[] {
    const errors: StructuredError[] = [];

    // Built-in functions live in a parent scope so user imports/defs shadow them
    const builtinScope = new Scope();
    for (const [name, builtin] of BUILTIN_FUNCTIONS) {
        builtinScope.define(name, {
            name,
            kind: "function",
            nodeId: null,
            type: builtin.type,
        });
    }
    const moduleScope = new Scope(builtinScope);

    // =========================================================================
    // Pass 1 — Register top-level definitions + imports
    // =========================================================================

    // Register imports (trusted/opaque — typed as unknown)
    for (const imp of module.imports) {
        for (const name of imp.names) {
            const err = moduleScope.define(name, {
                name,
                kind: "import",
                nodeId: imp.id,
            });
            if (err) errors.push(err);
        }
    }

    // Register definitions
    for (const def of module.definitions) {
        const info = defToSymbolInfo(def);
        const err = moduleScope.define(def.name, info);
        if (err) errors.push(err);
    }

    // =========================================================================
    // Pass 2 — Resolve expressions and patterns
    // =========================================================================

    for (const def of module.definitions) {
        switch (def.kind) {
            case "fn":
                resolveFunctionDef(def, moduleScope, errors);
                break;
            case "const":
                resolveConstDef(def, moduleScope, errors);
                break;
            case "record":
                resolveRecordDef(def, moduleScope, errors);
                break;
            case "type":
                resolveTypeExpr(def.definition, moduleScope, errors);
                break;
            case "enum":
                resolveEnumDef(def, moduleScope, errors);
                break;
        }
    }

    return errors;
}

// =============================================================================
// Helpers
// =============================================================================

function defToSymbolInfo(def: Definition): SymbolInfo {
    switch (def.kind) {
        case "fn":
            return {
                name: def.name,
                kind: "function",
                nodeId: def.id,
                type: {
                    kind: "fn_type",
                    params: def.params.map((p) => p.type),
                    effects: [...def.effects],
                    returnType: def.returnType,
                } satisfies FunctionType,
                definition: def,
            };
        case "type":
            return { name: def.name, kind: "type", nodeId: def.id, definition: def };
        case "record":
            return { name: def.name, kind: "record", nodeId: def.id, definition: def };
        case "enum":
            return { name: def.name, kind: "enum", nodeId: def.id, definition: def };
        case "const":
            return { name: def.name, kind: "const", nodeId: def.id, type: def.type, definition: def };
    }
}

function resolveFunctionDef(
    fn: FunctionDef,
    parentScope: Scope,
    errors: StructuredError[],
): void {
    // Create body scope with params
    const bodyScope = parentScope.child();
    for (const param of fn.params) {
        const err = bodyScope.define(param.name, {
            name: param.name,
            kind: "param",
            nodeId: param.id,
            type: param.type,
        });
        if (err) errors.push(err);
    }

    // Resolve param types
    for (const param of fn.params) {
        resolveTypeExpr(param.type, parentScope, errors);
    }

    // Resolve return type
    resolveTypeExpr(fn.returnType, parentScope, errors);

    // Resolve contracts
    for (const contract of fn.contracts) {
        resolveContract(contract, fn, bodyScope, errors);
    }

    // Resolve body expressions sequentially (let bindings accumulate in scope)
    resolveExpressionList(fn.body, bodyScope, errors);
}

function resolveContract(
    contract: Contract,
    fn: FunctionDef,
    bodyScope: Scope,
    errors: StructuredError[],
): void {
    if (contract.kind === "post") {
        // Post-contracts have implicit `result` binding typed as returnType
        const postScope = bodyScope.child();
        postScope.define("result", {
            name: "result",
            kind: "result",
            nodeId: null,
            type: fn.returnType,
        });
        resolveExpression(contract.condition, postScope, errors);
    } else {
        // Pre-contracts share the body scope (params visible)
        resolveExpression(contract.condition, bodyScope, errors);
    }
}

function resolveConstDef(
    def: ConstDef,
    scope: Scope,
    errors: StructuredError[],
): void {
    resolveTypeExpr(def.type, scope, errors);
    resolveExpression(def.value, scope, errors);
}

function resolveRecordDef(
    def: RecordDef,
    scope: Scope,
    errors: StructuredError[],
): void {
    for (const field of def.fields) {
        resolveRecordField(field, scope, errors);
    }
}

function resolveRecordField(
    field: RecordField,
    scope: Scope,
    errors: StructuredError[],
): void {
    resolveTypeExpr(field.type, scope, errors);
    if (field.defaultValue) {
        resolveExpression(field.defaultValue, scope, errors);
    }
}

function resolveEnumDef(
    def: EnumDef,
    scope: Scope,
    errors: StructuredError[],
): void {
    for (const variant of def.variants) {
        for (const field of variant.fields) {
            resolveRecordField(field, scope, errors);
        }
    }
}

/**
 * Resolve named types. Only `named` and `refined` types reference names.
 */
function resolveTypeExpr(
    type: TypeExpr,
    scope: Scope,
    errors: StructuredError[],
): void {
    switch (type.kind) {
        case "named": {
            const sym = scope.lookup(type.name);
            if (!sym) {
                const cands = findCandidates(type.name, scope.allNames());
                const suggestion: FixSuggestion | undefined = cands.length > 0
                    ? { nodeId: null, field: "name", value: cands[0] }
                    : undefined;
                errors.push(
                    undefinedReference(null, type.name, cands, suggestion),
                );
            }
            break;
        }
        case "refined":
            resolveRefinedType(type, scope, errors);
            break;
        case "array":
            resolveTypeExpr(type.element, scope, errors);
            break;
        case "option":
            resolveTypeExpr(type.inner, scope, errors);
            break;
        case "result":
            resolveTypeExpr(type.ok, scope, errors);
            resolveTypeExpr(type.err, scope, errors);
            break;
        case "fn_type":
            for (const p of type.params) resolveTypeExpr(p, scope, errors);
            resolveTypeExpr(type.returnType, scope, errors);
            break;
        case "tuple":
            for (const el of type.elements) resolveTypeExpr(el, scope, errors);
            break;
        case "basic":
        case "unit_type":
            // No names to resolve
            break;
    }
}

function resolveRefinedType(
    type: RefinedType,
    scope: Scope,
    errors: StructuredError[],
): void {
    resolveTypeExpr(type.base, scope, errors);
    // The variable introduces a new binding for the predicate expression
    const predicateScope = scope.child();
    predicateScope.define(type.variable, {
        name: type.variable,
        kind: "param",
        nodeId: type.id,
        type: type.base,
    });
    resolveExpression(type.predicate, predicateScope, errors);
}

/**
 * Resolve a list of expressions sequentially.
 * Let bindings accumulate into the scope for subsequent expressions.
 */
function resolveExpressionList(
    exprs: Expression[],
    scope: Scope,
    errors: StructuredError[],
): void {
    // We use a mutable current scope so let-bindings are visible to later siblings
    let currentScope = scope;
    for (const expr of exprs) {
        resolveExpression(expr, currentScope, errors);
        if (expr.kind === "let") {
            // Let binding adds to a child scope for subsequent siblings
            currentScope = currentScope.child();
            const err = currentScope.define(expr.name, {
                name: expr.name,
                kind: "let",
                nodeId: expr.id,
                type: expr.type,
            });
            if (err) errors.push(err);
        }
    }
}

function resolveExpression(
    expr: Expression,
    scope: Scope,
    errors: StructuredError[],
): void {
    switch (expr.kind) {
        case "literal":
            // Optionally annotated — resolve type if present
            if (expr.type) resolveTypeExpr(expr.type, scope, errors);
            break;

        case "ident": {
            const sym = scope.lookup(expr.name);
            if (!sym) {
                const cands = findCandidates(expr.name, scope.allNames());
                const suggestion: FixSuggestion | undefined = cands.length > 0
                    ? { nodeId: expr.id, field: "name", value: cands[0] }
                    : undefined;
                errors.push(
                    undefinedReference(expr.id, expr.name, cands, suggestion),
                );
            }
            break;
        }

        case "binop":
            resolveExpression(expr.left, scope, errors);
            resolveExpression(expr.right, scope, errors);
            break;

        case "unop":
            resolveExpression(expr.operand, scope, errors);
            break;

        case "call":
            resolveExpression(expr.fn, scope, errors);
            for (const arg of expr.args) resolveExpression(arg, scope, errors);
            break;

        case "if":
            resolveExpression(expr.condition, scope, errors);
            resolveExpressionList(expr.then, scope, errors);
            if (expr.else) resolveExpressionList(expr.else, scope, errors);
            break;

        case "let":
            // Type annotation
            if (expr.type) resolveTypeExpr(expr.type, scope, errors);
            // Value (the name itself is NOT in scope for its own value)
            resolveExpression(expr.value, scope, errors);
            // Binding is registered by resolveExpressionList
            break;

        case "match":
            resolveExpression(expr.target, scope, errors);
            for (const arm of expr.arms) {
                const armScope = scope.child();
                resolvePattern(arm.pattern, armScope, scope, errors);
                resolveExpressionList(arm.body, armScope, errors);
            }
            break;

        case "array":
            for (const el of expr.elements) resolveExpression(el, scope, errors);
            break;

        case "tuple_expr":
            for (const el of expr.elements) resolveExpression(el, scope, errors);
            break;

        case "record_expr":
            // We don't error on unknown records here — that's the type checker's job.
            // We DO resolve the field value expressions.
            for (const f of expr.fields) resolveExpression(f.value, scope, errors);
            break;

        case "enum_constructor":
            // Same as record_expr — type checker validates enum/variant existence
            for (const f of expr.fields) resolveExpression(f.value, scope, errors);
            break;

        case "access":
            resolveExpression(expr.target, scope, errors);
            break;

        case "lambda": {
            const lamScope = scope.child();
            for (const param of expr.params) {
                resolveTypeExpr(param.type, scope, errors);
                const err = lamScope.define(param.name, {
                    name: param.name,
                    kind: "param",
                    nodeId: param.id,
                    type: param.type,
                });
                if (err) errors.push(err);
            }
            resolveExpressionList(expr.body, lamScope, errors);
            break;
        }

        case "block":
            resolveExpressionList(expr.body, scope.child(), errors);
            break;

        case "string_interp":
            for (const part of expr.parts) resolveExpression(part, scope, errors);
            break;
    }
}

function resolvePattern(
    pattern: Pattern,
    armScope: Scope,
    moduleScope: Scope,
    errors: StructuredError[],
): void {
    switch (pattern.kind) {
        case "binding": {
            const err = armScope.define(pattern.name, {
                name: pattern.name,
                kind: "let",
                nodeId: null,
            });
            if (err) errors.push(err);
            break;
        }
        case "constructor": {
            // Verify the constructor name exists as an enum variant in module scope
            // We check ALL enum defs to find a matching variant
            const found = findVariantInScope(pattern.name, moduleScope);
            if (!found) {
                const cands = findCandidates(pattern.name, collectAllVariantNames(moduleScope));
                const suggestion: FixSuggestion | undefined = cands.length > 0
                    ? { nodeId: null, field: "name", value: cands[0] }
                    : undefined;
                errors.push(
                    undefinedReference(null, pattern.name, cands, suggestion),
                );
            }
            // Recursively resolve sub-patterns
            for (const sub of pattern.fields) {
                resolvePattern(sub, armScope, moduleScope, errors);
            }
            break;
        }
        case "literal_pattern":
        case "wildcard":
            // No names to resolve
            break;
    }
}

/**
 * Search all enum definitions in scope for a variant with the given name.
 */
function findVariantInScope(variantName: string, scope: Scope): boolean {
    // Walk all names and check if any enum has this variant
    for (const name of scope.allNames()) {
        const sym = scope.lookup(name);
        if (sym?.definition?.kind === "enum") {
            for (const v of sym.definition.variants) {
                if (v.name === variantName) return true;
            }
        }
    }
    return false;
}

/**
 * Collect all variant names from all enums in scope.
 */
function collectAllVariantNames(scope: Scope): string[] {
    const names: string[] = [];
    for (const name of scope.allNames()) {
        const sym = scope.lookup(name);
        if (sym?.definition?.kind === "enum") {
            for (const v of sym.definition.variants) {
                names.push(v.name);
            }
        }
    }
    return names;
}
