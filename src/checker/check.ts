// =============================================================================
// Type Checker — typeCheck(module) → StructuredError[]
// =============================================================================
// Assumes name resolution has already passed. Infers types for expressions
// and reports type mismatches, arity errors, etc.

import type {
    EdictModule,
    FunctionDef,
    Expression,
    Pattern,
    Definition,
    RecordDef,
    EnumDef,
    ToolCallExpr,
    ConcreteEffect,
} from "../ast/nodes.js";
import { isConcreteEffect } from "../ast/nodes.js";
import { walkExpression } from "../ast/walk.js";
import type { TypeExpr, FunctionType } from "../ast/types.js";
import type { StructuredError } from "../errors/structured-errors.js";
import {
    typeMismatch,
    unitMismatch,
    arityMismatch,
    notAFunction,
    unknownField,
    unknownRecord,
    unknownEnum,
    unknownVariant,
    missingRecordFields,
    capabilityMissing,
    toolArgMismatch,
    type FixSuggestion,
} from "../errors/structured-errors.js";
import { findCandidates } from "../resolver/levenshtein.js";
import { TypeEnv } from "./type-env.js";
import { typesEqual, isUnknown, resolveType } from "./types-equal.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { OPTION_ENUM_DEF, RESULT_ENUM_DEF } from "../builtins/builtin-enums.js";

/**
 * Side-table of inferred types produced by the type checker.
 * Replaces AST mutation — downstream stages read from this instead.
 */
export interface TypedModuleInfo {
    /** fnId → inferred return type (only for functions without explicit returnType) */
    inferredReturnTypes: Map<string, TypeExpr>;
    /** letExprId → inferred type (only for lets without explicit type annotation) */
    inferredLetTypes: Map<string, TypeExpr>;
    /** lambdaParamId → inferred type from call-site context */
    inferredLambdaParamTypes: Map<string, TypeExpr>;
    /** string_interp part nodeId → coercion builtin name (e.g. "intToString") */
    stringInterpCoercions: Map<string, string>;
    /** callSiteNodeId → resolved concrete effects from effect variable unification */
    resolvedCallSiteEffects: Map<string, ConcreteEffect[]>;
}

export interface TypeCheckResult {
    errors: StructuredError[];
    typeInfo: TypedModuleInfo;
}
import { UNKNOWN_TYPE, INT_TYPE, FLOAT_TYPE, STRING_TYPE, BOOL_TYPE } from "../ast/type-constants.js";

/**
 * Type-check a validated and name-resolved Edict module.
 *
 * Uses bidirectional type inference: infers types for expressions and checks
 * them against annotations. Produces a side-table of inferred types (no AST mutation).
 *
 * @param module - A validated and resolved Edict module
 * @returns `{ errors, typeInfo }` — errors array (empty if well-typed) and inferred type side-table
 */
export function typeCheck(module: EdictModule): TypeCheckResult {
    const errors: StructuredError[] = [];
    const typeInfo: TypedModuleInfo = {
        inferredReturnTypes: new Map(),
        inferredLetTypes: new Map(),
        inferredLambdaParamTypes: new Map(),
        stringInterpCoercions: new Map(),
        resolvedCallSiteEffects: new Map(),
    };
    const rootEnv = new TypeEnv();

    // Register built-in function signatures
    for (const [name, builtin] of BUILTIN_FUNCTIONS) {
        rootEnv.bind(name, builtin.type);
    }

    // Register built-in enum type definitions (Option, Result)
    // so enum_constructor and match patterns work through typeCheck.
    rootEnv.registerTypeDef("Option", OPTION_ENUM_DEF);
    rootEnv.registerTypeDef("Result", RESULT_ENUM_DEF);

    // Register type definitions (records, enums, type aliases)
    for (const def of module.definitions) {
        registerTypeDef(def, rootEnv);
    }

    // Register function signatures and const types
    for (const def of module.definitions) {
        registerValueDef(def, rootEnv);
    }

    // Register imports — use declared types when available, fall back to unknown
    for (const imp of module.imports) {
        for (const name of imp.names) {
            const declaredType = imp.types?.[name];
            rootEnv.bind(name, declaredType ?? UNKNOWN_TYPE);
        }
    }

    // Build tool definitions map for named-arg checking
    for (const def of module.definitions) {
        if (def.kind === "tool") {
            rootEnv.registerToolDef(def.name, def);
        }
    }

    // Type-check each definition
    for (const def of module.definitions) {
        switch (def.kind) {
            case "fn":
                checkFunction(def, rootEnv, errors, typeInfo);
                break;
            case "const":
                checkConst(def, rootEnv, errors, typeInfo);
                break;
            // record, enum, type — no body to type-check
        }
    }

    // Module-level capability verification:
    // Check that main's capability-typed params are covered by module.capabilities
    checkModuleCapabilities(module, errors);

    return { errors, typeInfo };
}

// =============================================================================
// Registration
// =============================================================================

function registerTypeDef(def: Definition, env: TypeEnv): void {
    switch (def.kind) {
        case "type":
        case "record":
        case "enum":
            env.registerTypeDef(def.name, def);
            break;
    }
}

function registerValueDef(def: Definition, env: TypeEnv): void {
    switch (def.kind) {
        case "fn": {
            const fnType: FunctionType = {
                kind: "fn_type",
                params: def.params.map((p) => p.type ?? UNKNOWN_TYPE),
                effects: [...def.effects],
                returnType: def.returnType ?? UNKNOWN_TYPE,
            };
            env.bind(def.name, fnType);
            break;
        }
        case "const":
            env.bind(def.name, def.type);
            break;
        case "tool": {
            // Register tool as a function type so inferExpr can look it up
            const toolFnType: FunctionType = {
                kind: "fn_type",
                params: def.params.map((p) => p.type ?? UNKNOWN_TYPE),
                effects: [...def.effects],
                returnType: def.returnType ?? UNKNOWN_TYPE,
            };
            env.bind(def.name, toolFnType);
            break;
        }
    }
}

// =============================================================================
// Function checking
// =============================================================================

function checkFunction(
    fn: FunctionDef,
    rootEnv: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): void {
    const fnEnv = rootEnv.child();

    // Bind params
    for (const param of fn.params) {
        fnEnv.bind(param.name, param.type!);
    }

    // Infer body type first (needed when returnType is omitted)
    const bodyType = inferExprList(fn.body, fnEnv, errors, typeInfo);

    // Determine effective return type: explicit annotation or inferred from body
    const hadExplicitReturnType = !!fn.returnType;
    const effectiveReturnType = fn.returnType ?? bodyType;

    // Store inferred return type in side-table (no AST mutation)
    if (!fn.returnType) {
        typeInfo.inferredReturnTypes.set(fn.id, effectiveReturnType);
    }

    // Check contracts (postconditions bind `result` to the effective return type)
    for (const contract of fn.contracts) {
        if (!contract.condition) continue; // semantic assertions — no expression to type-check
        if (contract.kind === "post") {
            const postEnv = fnEnv.child();
            postEnv.bind("result", effectiveReturnType);
            const condType = inferExpr(contract.condition, postEnv, errors, typeInfo);
            checkExpectedType(condType, BOOL_TYPE, contract.id, fnEnv, errors);
        } else {
            const condType = inferExpr(contract.condition, fnEnv, errors, typeInfo);
            checkExpectedType(condType, BOOL_TYPE, contract.id, fnEnv, errors);
        }
    }

    // If returnType was explicit, check body against it
    if (hadExplicitReturnType && bodyType && !isUnknown(bodyType) && !isUnknown(resolveType(fn.returnType!, fnEnv))) {
        checkExpectedType(bodyType, fn.returnType!, fn.id, fnEnv, errors);
    }
}

function checkConst(
    def: { kind: "const"; id: string; name: string; type: TypeExpr; value: Expression },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): void {
    const valType = inferExpr(def.value, env, errors, typeInfo);
    checkExpectedType(valType, def.type, def.id, env, errors);
}

// =============================================================================
// Type inference
// =============================================================================

function inferExprList(
    exprs: Expression[],
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    if (exprs.length === 0) return UNKNOWN_TYPE;

    let currentEnv = env;
    let lastType: TypeExpr = UNKNOWN_TYPE;

    for (const expr of exprs) {
        lastType = inferExpr(expr, currentEnv, errors, typeInfo);
        if (expr.kind === "let") {
            currentEnv = currentEnv.child();
            // Bind the let name in child env, using inferred type from side-table if needed
            const bindType = expr.type ?? typeInfo.inferredLetTypes.get(expr.id) ?? lastType;
            currentEnv.bind(expr.name, bindType);
        }
    }

    return lastType;
}

function inferExpr(
    expr: Expression,
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    switch (expr.kind) {
        case "literal":
            return inferLiteral(expr);

        case "ident":
            return env.getType(expr.name) ?? UNKNOWN_TYPE;

        case "binop":
            return inferBinop(expr, env, errors, typeInfo);

        case "unop":
            return inferUnop(expr, env, errors, typeInfo);

        case "call":
            return inferCall(expr, env, errors, typeInfo);

        case "if":
            return inferIf(expr, env, errors, typeInfo);

        case "let":
            return inferLet(expr, env, errors, typeInfo);

        case "match":
            return inferMatch(expr, env, errors, typeInfo);

        case "array":
            return inferArray(expr, env, errors, typeInfo);

        case "tuple_expr":
            return inferTuple(expr, env, errors, typeInfo);

        case "record_expr":
            return inferRecordExpr(expr, env, errors, typeInfo);

        case "enum_constructor":
            return inferEnumConstructor(expr, env, errors, typeInfo);

        case "access":
            return inferAccess(expr, env, errors, typeInfo);

        case "lambda":
            return inferLambda(expr, env, errors, typeInfo);

        case "block":
            return inferExprList(expr.body, env.child(), errors, typeInfo);

        case "string_interp":
            return inferStringInterp(expr, env, errors, typeInfo);

        case "forall":
        case "exists":
            return inferQuantifier(expr, env, errors, typeInfo);

        case "tool_call":
            return inferToolCall(expr, env, errors, typeInfo);
    }
}

// =============================================================================
// Inference helpers
// =============================================================================

function inferLiteral(expr: Expression & { kind: "literal" }): TypeExpr {
    // If annotated, use that type
    if (expr.type) return expr.type;

    if (typeof expr.value === "boolean") return BOOL_TYPE;
    if (typeof expr.value === "string") return STRING_TYPE;
    if (typeof expr.value === "number") {
        return Number.isInteger(expr.value) ? INT_TYPE : FLOAT_TYPE;
    }
    return UNKNOWN_TYPE;
}

function inferBinop(
    expr: Expression & { kind: "binop" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const leftType = inferExpr(expr.left, env, errors, typeInfo);
    const rightType = inferExpr(expr.right, env, errors, typeInfo);

    // unknown propagation
    if (isUnknown(leftType) || isUnknown(rightType)) return UNKNOWN_TYPE;

    const op = expr.op;

    // Logical operators: and, or, implies → Bool (no provenance propagation)
    if (op === "and" || op === "or" || op === "implies") {
        if (!isBool(leftType)) {
            errors.push(typeMismatch(expr.id, BOOL_TYPE, leftType));
        }
        if (!isBool(rightType)) {
            errors.push(typeMismatch(expr.id, BOOL_TYPE, rightType));
        }
        return BOOL_TYPE;
    }

    // Comparison operators: ==, !=, <, >, <=, >= → Bool (no provenance propagation)
    if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
        if (!typesEqual(leftType, rightType, env)) {
            emitNumericMismatch(expr.id, leftType, rightType, errors);
        }
        return BOOL_TYPE;
    }

    // Value-carrying ops: +, -, *, /, %
    // Compute the raw result type, then apply provenance merge once at the end.
    let resultType: TypeExpr | null = null;

    if (op === "+") {
        // + works on numeric types AND strings
        if (isString(leftType) && isString(rightType)) {
            resultType = STRING_TYPE;
        } else if (isNumeric(leftType, env) && isNumeric(rightType, env)) {
            if (!typesEqual(leftType, rightType, env)) {
                emitNumericMismatch(expr.id, leftType, rightType, errors);
                return UNKNOWN_TYPE;
            }
            resultType = resolveType(leftType, env);
        } else {
            errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, leftType));
            return UNKNOWN_TYPE;
        }
    } else {
        // -, *, /, % — numeric only
        if (isNumeric(leftType, env) && isNumeric(rightType, env)) {
            if (!typesEqual(leftType, rightType, env)) {
                emitNumericMismatch(expr.id, leftType, rightType, errors);
                return UNKNOWN_TYPE;
            }
            resultType = resolveType(leftType, env);
        } else {
            errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, leftType));
            return UNKNOWN_TYPE;
        }
    }

    // Single provenance merge point for all value-carrying ops
    return mergeProvenance(leftType, rightType, resultType);
}

/**
 * Emit a unit_mismatch error when both types are unit_type with different units/bases,
 * or fall back to a generic type_mismatch otherwise.
 */
function emitNumericMismatch(
    nodeId: string,
    leftType: TypeExpr,
    rightType: TypeExpr,
    errors: StructuredError[],
): void {
    if (leftType.kind === "unit_type" && rightType.kind === "unit_type") {
        errors.push(unitMismatch(nodeId, leftType.unit, rightType.unit, leftType.base, rightType.base));
    } else {
        errors.push(typeMismatch(nodeId, leftType, rightType));
    }
}

function inferUnop(
    expr: Expression & { kind: "unop" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const operandType = inferExpr(expr.operand, env, errors, typeInfo);
    if (isUnknown(operandType)) return UNKNOWN_TYPE;

    if (expr.op === "not") {
        if (!isBool(operandType)) {
            errors.push(typeMismatch(expr.id, BOOL_TYPE, operandType));
        }
        return BOOL_TYPE;
    }

    // Unary -
    if (!isNumeric(operandType, env)) {
        errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, operandType)); // expected numeric
        return UNKNOWN_TYPE;
    }
    return operandType;
}

function inferCall(
    expr: Expression & { kind: "call" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const fnType = inferExpr(expr.fn, env, errors, typeInfo);
    if (isUnknown(fnType)) {
        // If fn is unknown, we can't type-check args. Infer them for side effects (let bindings)
        for (const arg of expr.args) inferExpr(arg, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }

    const resolved = resolveType(fnType, env);
    if (resolved.kind !== "fn_type") {
        errors.push(notAFunction(expr.id, fnType));
        // Still infer arg types for error propagation
        for (const arg of expr.args) inferExpr(arg, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }

    // Check arity
    if (expr.args.length !== resolved.params.length) {
        errors.push(arityMismatch(expr.id, resolved.params.length, expr.args.length));
    }

    // Check arg types (up to the minimum of args/params)
    const checkCount = Math.min(expr.args.length, resolved.params.length);
    const argTypes: TypeExpr[] = [];
    for (let i = 0; i < checkCount; i++) {
        const arg = expr.args[i]!;
        const expectedParamType = resolved.params[i]!;
        // If arg is a lambda and expected param is fn_type, propagate param types
        const resolvedExpected = resolveType(expectedParamType, env);
        const argType = (arg.kind === "lambda" && resolvedExpected.kind === "fn_type")
            ? inferLambdaWithContext(arg, resolvedExpected as FunctionType, env, errors, typeInfo)
            : inferExpr(arg, env, errors, typeInfo);
        argTypes.push(argType);
        checkExpectedType(argType, expectedParamType, arg.id, env, errors);
    }

    // Infer remaining surplus args
    for (let i = checkCount; i < expr.args.length; i++) {
        inferExpr(expr.args[i]!, env, errors, typeInfo);
    }

    // --- Effect variable unification ---
    // If any callee param is a fn_type with effect variables, unify those
    // effect variables with the concrete effects of the corresponding lambda args.
    // Effect variables appear in param types (e.g., f: (Int) -[E]-> Int),
    // NOT in the callee's top-level effects (which are always ConcreteEffect[]).
    {
        const resolvedEffects = new Set<ConcreteEffect>();

        for (let i = 0; i < checkCount; i++) {
            const expectedParamType = resolved.params[i]!;
            const resolvedParam = resolveType(expectedParamType, env);
            if (resolvedParam.kind !== "fn_type") continue;

            // Check if this param's fn_type has any effect variables
            const hasParamEffectVars = resolvedParam.effects.some(e => !isConcreteEffect(e));
            if (!hasParamEffectVars) continue;

            // Get the inferred arg type (should be fn_type with concrete effects)
            const argType = argTypes[i];
            if (!argType || argType.kind !== "fn_type") continue;

            // Collect concrete effects from the lambda arg's inferred type
            for (const eff of argType.effects) {
                if (isConcreteEffect(eff) && eff !== "pure") {
                    resolvedEffects.add(eff);
                }
            }
        }

        if (resolvedEffects.size > 0) {
            typeInfo.resolvedCallSiteEffects.set(
                expr.id,
                [...resolvedEffects] as ConcreteEffect[],
            );
        }
    }

    // Auto-annotate provenance for builtins with a provenance source tag
    if (expr.fn.kind === "ident") {
        const builtin = BUILTIN_FUNCTIONS.get(expr.fn.name);
        if (builtin?.provenance) {
            return { kind: "provenance", base: resolved.returnType, sources: [builtin.provenance] };
        }
    }
    return resolved.returnType;
}

function inferIf(
    expr: Expression & { kind: "if" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const condType = inferExpr(expr.condition, env, errors, typeInfo);
    checkExpectedType(condType, BOOL_TYPE, expr.id, env, errors);

    const thenType = inferExprList(expr.then, env.child(), errors, typeInfo);

    if (expr.else) {
        const elseType = inferExprList(expr.else, env.child(), errors, typeInfo);
        if (!isUnknown(thenType) && !isUnknown(elseType)) {
            if (!typesEqual(thenType, elseType, env)) {
                errors.push(typeMismatch(expr.id, thenType, elseType));
            }
        }
        return mergeProvenance(thenType, elseType, resolveType(thenType, env));
    }

    // No else → Option<thenType>
    return { kind: "option", inner: thenType };
}

function inferLet(
    expr: Expression & { kind: "let" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const valType = inferExpr(expr.value, env, errors, typeInfo);

    if (expr.type) {
        checkExpectedType(valType, expr.type, expr.id, env, errors);
        return expr.type;
    }

    // Store inferred type in side-table (no AST mutation)
    if (!isUnknown(valType)) {
        typeInfo.inferredLetTypes.set(expr.id, valType);
    }

    return valType;
}

function inferMatch(
    expr: Expression & { kind: "match" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const targetType = inferExpr(expr.target, env, errors, typeInfo);
    let resultType: TypeExpr | null = null;

    for (const arm of expr.arms) {
        const armEnv = env.child();
        inferPattern(arm.pattern, targetType, armEnv, env, errors);
        const bodyType = inferExprList(arm.body, armEnv, errors, typeInfo);

        if (resultType === null) {
            resultType = bodyType;
        } else if (!isUnknown(resultType) && !isUnknown(bodyType)) {
            if (!typesEqual(resultType, bodyType, env)) {
                errors.push(typeMismatch(arm.id, resultType, bodyType));
            }
        }
    }

    return resultType ?? UNKNOWN_TYPE;
}

function inferPattern(
    pattern: Pattern,
    targetType: TypeExpr,
    armEnv: TypeEnv,
    rootEnv: TypeEnv,
    errors: StructuredError[],
): void {
    switch (pattern.kind) {
        case "binding":
            armEnv.bind(pattern.name, targetType);
            break;

        case "wildcard":
            break;

        case "literal_pattern": {
            const litType = inferLiteralPatternType(pattern.value);
            if (!isUnknown(targetType) && !isUnknown(litType)) {
                if (!typesEqual(litType, targetType, rootEnv)) {
                    errors.push(typeMismatch(null, targetType, litType));
                }
            }
            break;
        }

        case "constructor": {
            // Resolve the enum from target type
            if (isUnknown(targetType)) {
                // If target is unknown, bind sub-patterns as unknown
                for (const sub of pattern.fields) {
                    inferPattern(sub, UNKNOWN_TYPE, armEnv, rootEnv, errors);
                }
                break;
            }

            const resolvedTarget = resolveType(targetType, rootEnv);
            if (resolvedTarget.kind !== "named") {
                // Can't destructure non-named types
                for (const sub of pattern.fields) {
                    inferPattern(sub, UNKNOWN_TYPE, armEnv, rootEnv, errors);
                }
                break;
            }

            const enumDef = rootEnv.lookupTypeDef(resolvedTarget.name);
            if (!enumDef || enumDef.kind !== "enum") {
                for (const sub of pattern.fields) {
                    inferPattern(sub, UNKNOWN_TYPE, armEnv, rootEnv, errors);
                }
                break;
            }

            const variant = enumDef.variants.find((v) => v.name === pattern.name);
            if (!variant) {
                // Already caught by resolver, but bind sub-patterns
                for (const sub of pattern.fields) {
                    inferPattern(sub, UNKNOWN_TYPE, armEnv, rootEnv, errors);
                }
                break;
            }

            // Bind positional fields
            for (let i = 0; i < pattern.fields.length; i++) {
                const fieldType = i < variant.fields.length ? variant.fields[i]!.type : UNKNOWN_TYPE;
                inferPattern(pattern.fields[i]!, fieldType, armEnv, rootEnv, errors);
            }
            break;
        }
    }
}

function inferArray(
    expr: Expression & { kind: "array" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    if (expr.elements.length === 0) {
        return { kind: "array", element: UNKNOWN_TYPE };
    }

    const firstType = inferExpr(expr.elements[0]!, env, errors, typeInfo);

    for (let i = 1; i < expr.elements.length; i++) {
        const elType = inferExpr(expr.elements[i]!, env, errors, typeInfo);
        if (!isUnknown(firstType) && !isUnknown(elType)) {
            if (!typesEqual(firstType, elType, env)) {
                errors.push(typeMismatch(expr.elements[i]!.id, firstType, elType));
            }
        }
    }

    return { kind: "array", element: firstType };
}

function inferTuple(
    expr: Expression & { kind: "tuple_expr" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const elementTypes = expr.elements.map((el) => inferExpr(el, env, errors, typeInfo));
    return { kind: "tuple", elements: elementTypes };
}

function inferRecordExpr(
    expr: Expression & { kind: "record_expr" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const def = env.lookupTypeDef(expr.name);
    if (!def) {
        const cands = env.allTypeDefNames("record");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "name", value: findCandidates(expr.name, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownRecord(expr.id, expr.name, cands, suggestion));
        // Still infer field value types
        for (const f of expr.fields) inferExpr(f.value, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }
    if (def.kind !== "record") {
        const cands = env.allTypeDefNames("record");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "name", value: findCandidates(expr.name, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownRecord(expr.id, expr.name, cands, suggestion));
        for (const f of expr.fields) inferExpr(f.value, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }

    const recordDef = def as RecordDef;
    const providedFields = new Set(expr.fields.map((f) => f.name));

    // Check required fields (no defaultValue)
    const requiredMissing = recordDef.fields
        .filter((f) => !f.defaultValue && !providedFields.has(f.name))
        .map((f) => f.name);

    if (requiredMissing.length > 0) {
        const suggestion: FixSuggestion = { nodeId: expr.id, field: "fields", value: requiredMissing };
        errors.push(missingRecordFields(expr.id, expr.name, requiredMissing, suggestion));
    }

    // Check each provided field
    for (const fieldInit of expr.fields) {
        const fieldDef = recordDef.fields.find((f) => f.name === fieldInit.name);
        if (!fieldDef) {
            const availFields = recordDef.fields.map((f) => f.name);
            const cands = findCandidates(fieldInit.name, availFields);
            const suggestion: FixSuggestion | undefined = cands.length > 0
                ? { nodeId: expr.id, field: "field", value: cands[0] }
                : undefined;
            errors.push(unknownField(
                expr.id,
                expr.name,
                fieldInit.name,
                availFields,
                suggestion,
            ));
            inferExpr(fieldInit.value, env, errors, typeInfo);
            continue;
        }

        const valType = inferExpr(fieldInit.value, env, errors, typeInfo);
        checkExpectedType(valType, fieldDef.type, expr.id, env, errors);
    }

    return { kind: "named", name: expr.name };
}

function inferEnumConstructor(
    expr: Expression & { kind: "enum_constructor" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const def = env.lookupTypeDef(expr.enumName);
    if (!def) {
        const cands = env.allTypeDefNames("enum");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "enumName", value: findCandidates(expr.enumName, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownEnum(expr.id, expr.enumName, cands, suggestion));
        for (const f of expr.fields) inferExpr(f.value, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }
    if (def.kind !== "enum") {
        const cands = env.allTypeDefNames("enum");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "enumName", value: findCandidates(expr.enumName, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownEnum(expr.id, expr.enumName, cands, suggestion));
        for (const f of expr.fields) inferExpr(f.value, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }

    const enumDef = def as EnumDef;
    const variant = enumDef.variants.find((v) => v.name === expr.variant);
    if (!variant) {
        const availVariants = enumDef.variants.map((v) => v.name);
        const cands = findCandidates(expr.variant, availVariants);
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "variant", value: cands[0] }
            : (availVariants.length > 0 ? { nodeId: expr.id, field: "variant", value: availVariants[0] } : undefined);
        errors.push(unknownVariant(
            expr.id,
            expr.enumName,
            expr.variant,
            availVariants,
            suggestion,
        ));
        for (const f of expr.fields) inferExpr(f.value, env, errors, typeInfo);
        return UNKNOWN_TYPE;
    }

    // Check field count and types
    for (const fieldInit of expr.fields) {
        const fieldDef = variant.fields.find((f) => f.name === fieldInit.name);
        if (!fieldDef) {
            const availFields = variant.fields.map((f) => f.name);
            const cands = findCandidates(fieldInit.name, availFields);
            const suggestion: FixSuggestion | undefined = cands.length > 0
                ? { nodeId: expr.id, field: "field", value: cands[0] }
                : undefined;
            errors.push(unknownField(
                expr.id,
                `${expr.enumName}.${expr.variant}`,
                fieldInit.name,
                availFields,
                suggestion,
            ));
            inferExpr(fieldInit.value, env, errors, typeInfo);
            continue;
        }
        const valType = inferExpr(fieldInit.value, env, errors, typeInfo);
        checkExpectedType(valType, fieldDef.type, expr.id, env, errors);
    }

    return { kind: "named", name: expr.enumName };
}

function inferAccess(
    expr: Expression & { kind: "access" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const targetType = inferExpr(expr.target, env, errors, typeInfo);
    if (isUnknown(targetType)) return UNKNOWN_TYPE;

    const resolved = resolveType(targetType, env);

    // Tuple access — field is a numeric index like "0", "1", etc.
    if (resolved.kind === "tuple") {
        const index = parseInt(expr.field, 10);
        if (isNaN(index)) {
            errors.push(typeMismatch(expr.id, resolved, targetType));
            return UNKNOWN_TYPE;
        }
        if (index < 0 || index >= resolved.elements.length) {
            const availFields = resolved.elements.map((_, i) => String(i));
            errors.push(unknownField(
                expr.id,
                "tuple",
                expr.field,
                availFields,
            ));
            return UNKNOWN_TYPE;
        }
        return resolved.elements[index]!;
    }

    if (resolved.kind !== "named") {
        errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, targetType)); // expected record type
        return UNKNOWN_TYPE;
    }

    const def = env.lookupTypeDef(resolved.name);
    if (!def || def.kind !== "record") {
        errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, targetType)); // expected record type
        return UNKNOWN_TYPE;
    }

    const field = (def as RecordDef).fields.find((f) => f.name === expr.field);
    if (!field) {
        const availFields = (def as RecordDef).fields.map((f) => f.name);
        const cands = findCandidates(expr.field, availFields);
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "field", value: cands[0] }
            : undefined;
        errors.push(unknownField(
            expr.id,
            resolved.name,
            expr.field,
            availFields,
            suggestion,
        ));
        return UNKNOWN_TYPE;
    }

    return field.type;
}

function inferLambda(
    expr: Expression & { kind: "lambda" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const lamEnv = env.child();
    for (const param of expr.params) {
        lamEnv.bind(param.name, param.type ?? UNKNOWN_TYPE);
    }
    const bodyType = inferExprList(expr.body, lamEnv, errors, typeInfo);
    const effects = collectLambdaEffects(expr.body, lamEnv);
    return {
        kind: "fn_type",
        params: expr.params.map((p) => p.type ?? UNKNOWN_TYPE),
        effects,
        returnType: bodyType,
    } satisfies FunctionType;
}

/**
 * Infer lambda type with expected fn_type context from a call site.
 * Propagates param types from the expected signature to untyped lambda params.
 */
function inferLambdaWithContext(
    expr: Expression & { kind: "lambda" },
    expectedType: FunctionType,
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    const lamEnv = env.child();

    for (let i = 0; i < expr.params.length; i++) {
        const param = expr.params[i]!;
        if (param.type) {
            // Explicit type — use it
            lamEnv.bind(param.name, param.type);
        } else if (i < expectedType.params.length) {
            // Infer from expected fn_type
            const inferred = expectedType.params[i]!;
            // Store inferred type in side-table (no AST mutation)
            typeInfo.inferredLambdaParamTypes.set(param.id, inferred);
            lamEnv.bind(param.name, inferred);
        } else {
            lamEnv.bind(param.name, UNKNOWN_TYPE);
        }
    }

    const bodyType = inferExprList(expr.body, lamEnv, errors, typeInfo);
    const effects = collectLambdaEffects(expr.body, lamEnv);
    return {
        kind: "fn_type",
        params: expr.params.map((p) => p.type ?? typeInfo.inferredLambdaParamTypes.get(p.id) ?? UNKNOWN_TYPE),
        effects,
        returnType: bodyType,
    } satisfies FunctionType;
}

/**
 * Collect concrete effects from a lambda body by scanning for ident-based calls.
 * Looks up each callee's type in the environment and collects concrete effects
 * from their FunctionType. Stops at nested lambdas (opaque boundary).
 */
function collectLambdaEffects(body: Expression[], env: TypeEnv): ConcreteEffect[] {
    const effects = new Set<ConcreteEffect>();
    for (const expr of body) {
        walkExpression(expr, {
            enter(node) {
                if (node.kind === "lambda") {
                    // Don't recurse into nested lambdas — their effects are their own
                    return false;
                }
                if (node.kind === "call" && node.fn.kind === "ident") {
                    // Builtins are registered in the env via registerBuiltins(),
                    // so env.getType() covers both user-defined and builtin functions.
                    const calleeType = env.getType(node.fn.name);
                    if (calleeType && calleeType.kind === "fn_type") {
                        for (const eff of calleeType.effects) {
                            if (isConcreteEffect(eff) && eff !== "pure") {
                                effects.add(eff);
                            }
                        }
                    }
                }
            },
        });
    }
    return effects.size > 0 ? [...effects] : [];
}

function inferStringInterp(
    expr: Expression & { kind: "string_interp" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    for (const part of expr.parts) {
        const partType = inferExpr(part, env, errors, typeInfo);
        if (isUnknown(partType)) continue;

        const resolved = resolveType(partType, env);
        if (resolved.kind === "basic") {
            switch (resolved.name) {
                case "String":
                    // No coercion needed
                    break;
                case "Int":
                    typeInfo.stringInterpCoercions.set(part.id, "intToString");
                    break;
                case "Int64":
                    typeInfo.stringInterpCoercions.set(part.id, "int64ToString");
                    break;
                case "Float":
                    typeInfo.stringInterpCoercions.set(part.id, "floatToString");
                    break;
                case "Bool":
                    typeInfo.stringInterpCoercions.set(part.id, "boolToString");
                    break;
                default:
                    checkExpectedType(partType, STRING_TYPE, part.id, env, errors);
                    break;
            }
        } else {
            // Non-basic types (records, enums, arrays, etc.) are not auto-coercible
            checkExpectedType(partType, STRING_TYPE, part.id, env, errors);
        }
    }
    return STRING_TYPE;
}

function inferQuantifier(
    expr: Expression & { kind: "forall" | "exists" },
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    // Range bounds must be Int
    const fromType = inferExpr(expr.range.from, env, errors, typeInfo);
    checkExpectedType(fromType, INT_TYPE, expr.range.from.id, env, errors);

    const toType = inferExpr(expr.range.to, env, errors, typeInfo);
    checkExpectedType(toType, INT_TYPE, expr.range.to.id, env, errors);

    // Bind the quantified variable as Int in a child env
    const qEnv = env.child();
    qEnv.bind(expr.variable, INT_TYPE);

    // Body must be Bool
    const bodyType = inferExpr(expr.body, qEnv, errors, typeInfo);
    checkExpectedType(bodyType, BOOL_TYPE, expr.id, qEnv, errors);

    return BOOL_TYPE;
}

function inferToolCall(
    expr: ToolCallExpr,
    env: TypeEnv,
    errors: StructuredError[],
    typeInfo: TypedModuleInfo,
): TypeExpr {
    // Look up the tool's type from the env (registered during registerValueDef)
    const toolType = env.getType(expr.tool);
    if (!toolType || toolType.kind !== "fn_type") {
        // If not found, resolver already emitted unknown_tool — return unknown
        return UNKNOWN_TYPE;
    }

    // Look up ToolDef from env to get named param info
    const toolDef = env.lookupToolDef(expr.tool);

    if (toolDef) {
        // Validate named args against params
        const sigParamNames = new Set(toolDef.params.map(p => p.name));
        const argNames = new Set(expr.args.map(a => a.name));

        const missingArgs = toolDef.params
            .filter(p => !argNames.has(p.name))
            .map(p => p.name);
        const extraArgs = expr.args
            .filter(a => !sigParamNames.has(a.name))
            .map(a => a.name);

        // Type-check each arg against the corresponding param
        const typeMismatches: { arg: string; expected: TypeExpr; actual: TypeExpr }[] = [];
        for (const arg of expr.args) {
            const param = toolDef.params.find(p => p.name === arg.name);
            if (param && param.type) {
                const argType = inferExpr(arg.value, env, errors, typeInfo);
                if (!isUnknown(argType) && !isUnknown(param.type) && !typesEqual(argType, param.type, env)) {
                    typeMismatches.push({ arg: arg.name, expected: param.type, actual: argType });
                }
            } else {
                // param unknown → still infer arg for side effects
                inferExpr(arg.value, env, errors, typeInfo);
            }
        }

        if (missingArgs.length > 0 || extraArgs.length > 0 || typeMismatches.length > 0) {
            errors.push(toolArgMismatch(expr.id, expr.tool, missingArgs, extraArgs, typeMismatches));
        }
    } else {
        // No ToolDef, just infer args for side effects
        for (const arg of expr.args) {
            inferExpr(arg.value, env, errors, typeInfo);
        }
    }

    // Return type: Result<tool.returnType, String>
    const okType = toolType.returnType ?? UNKNOWN_TYPE;
    const resultType: TypeExpr = {
        kind: "result",
        ok: okType,
        err: STRING_TYPE,
    };

    // If fallback provided, check it matches the result type
    if (expr.fallback) {
        const fallbackType = inferExpr(expr.fallback, env, errors, typeInfo);
        if (!isUnknown(fallbackType)) {
            checkExpectedType(fallbackType, resultType, expr.fallback.id, env, errors);
        }
    }

    return resultType;
}

// =============================================================================
// Utility functions
// =============================================================================

function checkExpectedType(
    actual: TypeExpr,
    expected: TypeExpr,
    nodeId: string | null,
    env: TypeEnv,
    errors: StructuredError[],
): void {
    if (isUnknown(actual) || isUnknown(expected)) return;

    // Capability subsumption check:
    // When expected type is capability, actual must also be capability with subsumable permissions
    if (expected.kind === "capability") {
        if (actual.kind !== "capability") {
            errors.push(capabilityMissing(nodeId, expected.permissions, []));
            return;
        }
        // Check subsumption: each required permission must be satisfied by at least one available permission
        const unsatisfied = expected.permissions.filter(
            req => !actual.permissions.some(avail => capabilitySubsumes(avail, req)),
        );
        if (unsatisfied.length > 0) {
            errors.push(capabilityMissing(nodeId, unsatisfied, actual.permissions));
        }
        return;
    }

    if (!typesEqual(actual, expected, env)) {
        const suggestion: FixSuggestion | undefined = nodeId
            ? { nodeId, field: "type", value: expected }
            : undefined;
        errors.push(typeMismatch(nodeId, expected, actual, suggestion));
    }
}

function isBool(type: TypeExpr): boolean {
    return type.kind === "basic" && type.name === "Bool";
}

function isString(type: TypeExpr): boolean {
    return type.kind === "basic" && type.name === "String";
}

function isNumeric(type: TypeExpr, env: TypeEnv): boolean {
    const resolved = resolveType(type, env);
    if (resolved.kind === "basic") {
        return resolved.name === "Int" || resolved.name === "Int64" || resolved.name === "Float";
    }
    if (resolved.kind === "unit_type") return true;
    return false;
}

// =============================================================================
// Provenance helpers
// =============================================================================

/**
 * Merge provenance from two expression types.
 * - Neither has provenance → return base unchanged
 * - Only one has provenance → preserve it as-is (no "unknown" injection)
 * - Both have provenance → merge sources arrays (sorted, deduplicated)
 */
function mergeProvenance(
    leftType: TypeExpr,
    rightType: TypeExpr,
    mergedBase: TypeExpr,
): TypeExpr {
    const lp = leftType.kind === "provenance" ? leftType : null;
    const rp = rightType.kind === "provenance" ? rightType : null;

    if (!lp && !rp) return mergedBase;
    if (lp && !rp) return { kind: "provenance", base: mergedBase, sources: lp.sources };
    if (!lp && rp) return { kind: "provenance", base: mergedBase, sources: rp.sources };

    // Both sides have provenance — merge sources
    const merged = new Set<string>();
    for (const s of lp!.sources) merged.add(s);
    for (const s of rp!.sources) merged.add(s);
    return { kind: "provenance", base: mergedBase, sources: [...merged].sort() };
}



function inferLiteralPatternType(value: number | string | boolean): TypeExpr {
    if (typeof value === "boolean") return BOOL_TYPE;
    if (typeof value === "string") return STRING_TYPE;
    if (typeof value === "number") {
        return Number.isInteger(value) ? INT_TYPE : FLOAT_TYPE;
    }
    return UNKNOWN_TYPE;
}

// =============================================================================
// Capability helpers
// =============================================================================

/**
 * Check if capability `available` subsumes requirement `required`.
 * Broader permissions satisfy narrower requirements:
 *   "net" (available) satisfies "net:smtp" (required) — general access implies specific access.
 *   "net:smtp" (available) does NOT satisfy "net" (required) — SMTP-only doesn't imply full network.
 * Exact match always satisfies.
 */
function capabilitySubsumes(available: string, required: string): boolean {
    if (available === required) return true;
    // available "net" satisfies required "net:smtp" if available is a prefix of required
    // (having broader access implies you can do the specific thing)
    if (required.startsWith(available + ":")) return true;
    return false;
}

/**
 * Module-level capability verification.
 * If `main` has capability-typed params, each required permission must be
 * declared in module.capabilities (or subsumed by one).
 */
function checkModuleCapabilities(
    module: EdictModule,
    errors: StructuredError[],
): void {
    const mainFn = module.definitions.find(d => d.kind === "fn" && d.name === "main");
    if (!mainFn || mainFn.kind !== "fn") return;

    const moduleCapabilities = module.capabilities ?? [];

    for (const param of mainFn.params) {
        if (param.type?.kind === "capability") {
            const unsatisfied = param.type.permissions.filter(
                req => !moduleCapabilities.some(avail => capabilitySubsumes(avail, req)),
            );
            if (unsatisfied.length > 0) {
                errors.push(capabilityMissing(param.id, unsatisfied, moduleCapabilities));
            }
        }
    }
}
