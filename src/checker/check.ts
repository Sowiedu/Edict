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
} from "../ast/nodes.js";
import type { TypeExpr, FunctionType } from "../ast/types.js";
import type { StructuredError } from "../errors/structured-errors.js";
import {
    typeMismatch,
    arityMismatch,
    notAFunction,
    unknownField,
    unknownRecord,
    unknownEnum,
    unknownVariant,
    missingRecordFields,
    type FixSuggestion,
} from "../errors/structured-errors.js";
import { findCandidates } from "../resolver/levenshtein.js";
import { TypeEnv } from "./type-env.js";
import { typesEqual, isUnknown, resolveType } from "./types-equal.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { UNKNOWN_TYPE, INT_TYPE, FLOAT_TYPE, STRING_TYPE, BOOL_TYPE } from "../ast/type-constants.js";

/**
 * Entry point: type-check a validated + resolved Edict module.
 */
export function typeCheck(module: EdictModule): StructuredError[] {
    const errors: StructuredError[] = [];
    const rootEnv = new TypeEnv();

    // Register built-in function signatures
    for (const [name, builtin] of BUILTIN_FUNCTIONS) {
        rootEnv.bind(name, builtin.type);
    }

    // Register built-in Option enum type definition
    // so enum_constructor with enumName:"Option" and match patterns work through typeCheck.
    rootEnv.registerTypeDef("Option", {
        kind: "enum",
        id: "__builtin_option",
        name: "Option",
        variants: [
            { kind: "variant", id: "__builtin_option_none", name: "None", fields: [] },
            {
                kind: "variant", id: "__builtin_option_some", name: "Some", fields: [
                    { kind: "field", id: "__builtin_option_some_value", name: "value", type: INT_TYPE },
                ]
            },
        ],
    });

    // Register type definitions (records, enums, type aliases)
    for (const def of module.definitions) {
        registerTypeDef(def, rootEnv);
    }

    // Register function signatures and const types
    for (const def of module.definitions) {
        registerValueDef(def, rootEnv);
    }

    // Register imports as unknown
    for (const imp of module.imports) {
        for (const name of imp.names) {
            rootEnv.bind(name, UNKNOWN_TYPE);
        }
    }

    // Type-check each definition
    for (const def of module.definitions) {
        switch (def.kind) {
            case "fn":
                checkFunction(def, rootEnv, errors);
                break;
            case "const":
                checkConst(def, rootEnv, errors);
                break;
            // record, enum, type — no body to type-check
        }
    }

    return errors;
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
                params: def.params.map((p) => p.type),
                effects: [...def.effects],
                returnType: def.returnType,
            };
            env.bind(def.name, fnType);
            break;
        }
        case "const":
            env.bind(def.name, def.type);
            break;
    }
}

// =============================================================================
// Function checking
// =============================================================================

function checkFunction(
    fn: FunctionDef,
    rootEnv: TypeEnv,
    errors: StructuredError[],
): void {
    const fnEnv = rootEnv.child();

    // Bind params
    for (const param of fn.params) {
        fnEnv.bind(param.name, param.type);
    }

    // Check contracts
    for (const contract of fn.contracts) {
        if (contract.kind === "post") {
            const postEnv = fnEnv.child();
            postEnv.bind("result", fn.returnType);
            const condType = inferExpr(contract.condition, postEnv, errors);
            checkExpectedType(condType, BOOL_TYPE, contract.id, fnEnv, errors);
        } else {
            const condType = inferExpr(contract.condition, fnEnv, errors);
            checkExpectedType(condType, BOOL_TYPE, contract.id, fnEnv, errors);
        }
    }

    // Infer body type
    const bodyType = inferExprList(fn.body, fnEnv, errors);

    // Check return type
    if (bodyType && !isUnknown(bodyType) && !isUnknown(resolveType(fn.returnType, fnEnv))) {
        checkExpectedType(bodyType, fn.returnType, fn.id, fnEnv, errors);
    }
}

function checkConst(
    def: { kind: "const"; id: string; name: string; type: TypeExpr; value: Expression },
    env: TypeEnv,
    errors: StructuredError[],
): void {
    const valType = inferExpr(def.value, env, errors);
    checkExpectedType(valType, def.type, def.id, env, errors);
}

// =============================================================================
// Type inference
// =============================================================================

function inferExprList(
    exprs: Expression[],
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    if (exprs.length === 0) return UNKNOWN_TYPE;

    let currentEnv = env;
    let lastType: TypeExpr = UNKNOWN_TYPE;

    for (const expr of exprs) {
        lastType = inferExpr(expr, currentEnv, errors);
        if (expr.kind === "let") {
            currentEnv = currentEnv.child();
            // Bind the let name in child env
            const bindType = expr.type ?? lastType;
            currentEnv.bind(expr.name, bindType);
        }
    }

    return lastType;
}

function inferExpr(
    expr: Expression,
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    switch (expr.kind) {
        case "literal":
            return inferLiteral(expr);

        case "ident":
            return env.getType(expr.name) ?? UNKNOWN_TYPE;

        case "binop":
            return inferBinop(expr, env, errors);

        case "unop":
            return inferUnop(expr, env, errors);

        case "call":
            return inferCall(expr, env, errors);

        case "if":
            return inferIf(expr, env, errors);

        case "let":
            return inferLet(expr, env, errors);

        case "match":
            return inferMatch(expr, env, errors);

        case "array":
            return inferArray(expr, env, errors);

        case "tuple_expr":
            return inferTuple(expr, env, errors);

        case "record_expr":
            return inferRecordExpr(expr, env, errors);

        case "enum_constructor":
            return inferEnumConstructor(expr, env, errors);

        case "access":
            return inferAccess(expr, env, errors);

        case "lambda":
            return inferLambda(expr, env, errors);

        case "block":
            return inferExprList(expr.body, env.child(), errors);

        case "string_interp":
            return inferStringInterp(expr, env, errors);
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
): TypeExpr {
    const leftType = inferExpr(expr.left, env, errors);
    const rightType = inferExpr(expr.right, env, errors);

    // unknown propagation
    if (isUnknown(leftType) || isUnknown(rightType)) return UNKNOWN_TYPE;

    const op = expr.op;

    // Logical operators: and, or, implies
    if (op === "and" || op === "or" || op === "implies") {
        if (!isBool(leftType)) {
            errors.push(typeMismatch(expr.id, BOOL_TYPE, leftType));
        }
        if (!isBool(rightType)) {
            errors.push(typeMismatch(expr.id, BOOL_TYPE, rightType));
        }
        return BOOL_TYPE;
    }

    // Comparison operators: ==, !=, <, >, <=, >=
    if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
        if (!typesEqual(leftType, rightType, env)) {
            errors.push(typeMismatch(expr.id, leftType, rightType));
        }
        return BOOL_TYPE;
    }

    // Arithmetic: +, -, *, /, %
    if (op === "+") {
        // + works on numeric types AND strings
        if (isString(leftType) && isString(rightType)) return STRING_TYPE;
        if (isNumeric(leftType, env) && isNumeric(rightType, env)) {
            if (!typesEqual(leftType, rightType, env)) {
                errors.push(typeMismatch(expr.id, leftType, rightType));
                return UNKNOWN_TYPE;
            }
            return leftType;
        }
        errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, leftType)); // Unknown since both numeric/String are valid expected
        return UNKNOWN_TYPE;
    }

    // -, *, /, % — numeric only
    if (isNumeric(leftType, env) && isNumeric(rightType, env)) {
        if (!typesEqual(leftType, rightType, env)) {
            errors.push(typeMismatch(expr.id, leftType, rightType));
            return UNKNOWN_TYPE;
        }
        return leftType;
    }

    errors.push(typeMismatch(expr.id, UNKNOWN_TYPE, leftType)); // Expected numeric
    return UNKNOWN_TYPE;
}

function inferUnop(
    expr: Expression & { kind: "unop" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const operandType = inferExpr(expr.operand, env, errors);
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
): TypeExpr {
    const fnType = inferExpr(expr.fn, env, errors);
    if (isUnknown(fnType)) {
        // If fn is unknown, we can't type-check args. Infer them for side effects (let bindings)
        for (const arg of expr.args) inferExpr(arg, env, errors);
        return UNKNOWN_TYPE;
    }

    const resolved = resolveType(fnType, env);
    if (resolved.kind !== "fn_type") {
        errors.push(notAFunction(expr.id, fnType));
        // Still infer arg types for error propagation
        for (const arg of expr.args) inferExpr(arg, env, errors);
        return UNKNOWN_TYPE;
    }

    // Check arity
    if (expr.args.length !== resolved.params.length) {
        errors.push(arityMismatch(expr.id, resolved.params.length, expr.args.length));
    }

    // Check arg types (up to the minimum of args/params)
    const checkCount = Math.min(expr.args.length, resolved.params.length);
    for (let i = 0; i < checkCount; i++) {
        const argType = inferExpr(expr.args[i]!, env, errors);
        checkExpectedType(argType, resolved.params[i]!, expr.args[i]!.id, env, errors);
    }

    // Infer remaining surplus args
    for (let i = checkCount; i < expr.args.length; i++) {
        inferExpr(expr.args[i]!, env, errors);
    }

    return resolved.returnType;
}

function inferIf(
    expr: Expression & { kind: "if" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const condType = inferExpr(expr.condition, env, errors);
    checkExpectedType(condType, BOOL_TYPE, expr.id, env, errors);

    const thenType = inferExprList(expr.then, env.child(), errors);

    if (expr.else) {
        const elseType = inferExprList(expr.else, env.child(), errors);
        if (!isUnknown(thenType) && !isUnknown(elseType)) {
            if (!typesEqual(thenType, elseType, env)) {
                errors.push(typeMismatch(expr.id, thenType, elseType));
            }
        }
        return thenType;
    }

    // No else → Option<thenType>
    return { kind: "option", inner: thenType };
}

function inferLet(
    expr: Expression & { kind: "let" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const valType = inferExpr(expr.value, env, errors);

    if (expr.type) {
        checkExpectedType(valType, expr.type, expr.id, env, errors);
        return expr.type;
    }

    return valType;
}

function inferMatch(
    expr: Expression & { kind: "match" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const targetType = inferExpr(expr.target, env, errors);
    let resultType: TypeExpr | null = null;

    for (const arm of expr.arms) {
        const armEnv = env.child();
        inferPattern(arm.pattern, targetType, armEnv, env, errors);
        const bodyType = inferExprList(arm.body, armEnv, errors);

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
): TypeExpr {
    if (expr.elements.length === 0) {
        return { kind: "array", element: UNKNOWN_TYPE };
    }

    const firstType = inferExpr(expr.elements[0]!, env, errors);

    for (let i = 1; i < expr.elements.length; i++) {
        const elType = inferExpr(expr.elements[i]!, env, errors);
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
): TypeExpr {
    const elementTypes = expr.elements.map((el) => inferExpr(el, env, errors));
    return { kind: "tuple", elements: elementTypes };
}

function inferRecordExpr(
    expr: Expression & { kind: "record_expr" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const def = env.lookupTypeDef(expr.name);
    if (!def) {
        const cands = env.allTypeDefNames("record");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "name", value: findCandidates(expr.name, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownRecord(expr.id, expr.name, cands, suggestion));
        // Still infer field value types
        for (const f of expr.fields) inferExpr(f.value, env, errors);
        return UNKNOWN_TYPE;
    }
    if (def.kind !== "record") {
        const cands = env.allTypeDefNames("record");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "name", value: findCandidates(expr.name, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownRecord(expr.id, expr.name, cands, suggestion));
        for (const f of expr.fields) inferExpr(f.value, env, errors);
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
            inferExpr(fieldInit.value, env, errors);
            continue;
        }

        const valType = inferExpr(fieldInit.value, env, errors);
        checkExpectedType(valType, fieldDef.type, expr.id, env, errors);
    }

    return { kind: "named", name: expr.name };
}

function inferEnumConstructor(
    expr: Expression & { kind: "enum_constructor" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const def = env.lookupTypeDef(expr.enumName);
    if (!def) {
        const cands = env.allTypeDefNames("enum");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "enumName", value: findCandidates(expr.enumName, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownEnum(expr.id, expr.enumName, cands, suggestion));
        for (const f of expr.fields) inferExpr(f.value, env, errors);
        return UNKNOWN_TYPE;
    }
    if (def.kind !== "enum") {
        const cands = env.allTypeDefNames("enum");
        const suggestion: FixSuggestion | undefined = cands.length > 0
            ? { nodeId: expr.id, field: "enumName", value: findCandidates(expr.enumName, cands)[0] ?? cands[0] }
            : undefined;
        errors.push(unknownEnum(expr.id, expr.enumName, cands, suggestion));
        for (const f of expr.fields) inferExpr(f.value, env, errors);
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
        for (const f of expr.fields) inferExpr(f.value, env, errors);
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
            inferExpr(fieldInit.value, env, errors);
            continue;
        }
        const valType = inferExpr(fieldInit.value, env, errors);
        checkExpectedType(valType, fieldDef.type, expr.id, env, errors);
    }

    return { kind: "named", name: expr.enumName };
}

function inferAccess(
    expr: Expression & { kind: "access" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    const targetType = inferExpr(expr.target, env, errors);
    if (isUnknown(targetType)) return UNKNOWN_TYPE;

    const resolved = resolveType(targetType, env);
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
): TypeExpr {
    const lamEnv = env.child();
    for (const param of expr.params) {
        lamEnv.bind(param.name, param.type);
    }
    const bodyType = inferExprList(expr.body, lamEnv, errors);
    return {
        kind: "fn_type",
        params: expr.params.map((p) => p.type),
        effects: [],
        returnType: bodyType,
    } satisfies FunctionType;
}

function inferStringInterp(
    expr: Expression & { kind: "string_interp" },
    env: TypeEnv,
    errors: StructuredError[],
): TypeExpr {
    for (const part of expr.parts) {
        const partType = inferExpr(part, env, errors);
        checkExpectedType(partType, STRING_TYPE, part.id, env, errors);
    }
    return STRING_TYPE;
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
        return resolved.name === "Int" || resolved.name === "Float";
    }
    if (resolved.kind === "unit_type") return true;
    return false;
}



function inferLiteralPatternType(value: number | string | boolean): TypeExpr {
    if (typeof value === "boolean") return BOOL_TYPE;
    if (typeof value === "string") return STRING_TYPE;
    if (typeof value === "number") {
        return Number.isInteger(value) ? INT_TYPE : FLOAT_TYPE;
    }
    return UNKNOWN_TYPE;
}

