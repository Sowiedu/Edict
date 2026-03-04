// =============================================================================
// Per-Node Validation Logic
// =============================================================================
// Validates individual AST nodes: checks required fields exist and have
// correct types, recursively validates children.

import {
    VALID_EFFECTS,
    VALID_BINARY_OPS,
    VALID_UNARY_OPS,
    VALID_BASIC_TYPE_NAMES,
    VALID_DEFINITION_KINDS,
    VALID_EXPRESSION_KINDS,
    VALID_TYPE_KINDS,
    VALID_PATTERN_KINDS,
} from "../ast/nodes.js";
import type { StructuredError } from "../errors/structured-errors.js";
import {
    missingField,
    invalidFieldType,
    unknownNodeKind,
    invalidEffect,
    invalidOperator,
    invalidBasicTypeName,
    conflictingEffects,
} from "../errors/structured-errors.js";
import type { IdTracker } from "./id-tracker.js";

// =============================================================================
// Helpers
// =============================================================================

type AnyNode = Record<string, unknown>;

function isObject(v: unknown): v is AnyNode {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
    return typeof v === "string";
}

function isArray(v: unknown): v is unknown[] {
    return Array.isArray(v);
}

function getNodeId(node: AnyNode): string | null {
    return isString(node["id"]) ? node["id"] : null;
}

/**
 * Assert a field exists and is a string. Returns the string or records error.
 */
function requireString(
    node: AnyNode,
    field: string,
    path: string,
    errors: StructuredError[],
): string | null {
    const val = node[field];
    if (val === undefined || val === null) {
        errors.push(missingField(path, getNodeId(node), field, "string"));
        return null;
    }
    if (!isString(val)) {
        errors.push(
            invalidFieldType(path, getNodeId(node), field, "string", typeof val),
        );
        return null;
    }
    return val;
}

/**
 * Assert a field exists and is an array. Returns the array or records error.
 */
function requireArray(
    node: AnyNode,
    field: string,
    path: string,
    errors: StructuredError[],
): unknown[] | null {
    const val = node[field];
    if (val === undefined || val === null) {
        errors.push(missingField(path, getNodeId(node), field, "array"));
        return null;
    }
    if (!isArray(val)) {
        errors.push(
            invalidFieldType(path, getNodeId(node), field, "array", typeof val),
        );
        return null;
    }
    return val;
}

/**
 * Assert a field exists and is an object. Returns the object or records error.
 */
function requireObject(
    node: AnyNode,
    field: string,
    path: string,
    errors: StructuredError[],
): AnyNode | null {
    const val = node[field];
    if (val === undefined || val === null) {
        errors.push(missingField(path, getNodeId(node), field, "object"));
        return null;
    }
    if (!isObject(val)) {
        errors.push(
            invalidFieldType(path, getNodeId(node), field, "object", typeof val),
        );
        return null;
    }
    return val;
}

/**
 * Track an ID field if present.
 */
function trackId(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const id = requireString(node, "id", path, errors);
    if (id !== null) {
        idTracker.track(id, path);
    }
}

/**
 * Validate an effects array:
 * 1. Every element must be a valid effect string.
 * 2. If "pure" is present, it must be the only effect (contradictory otherwise).
 */
function validateEffectsArray(
    effects: unknown[],
    path: string,
    nodeId: string | null,
    errors: StructuredError[],
): void {
    let hasPure = false;

    for (let i = 0; i < effects.length; i++) {
        if (
            !isString(effects[i]) ||
            !(VALID_EFFECTS as readonly string[]).includes(effects[i] as string)
        ) {
            errors.push(
                invalidEffect(
                    `${path}.effects[${i}]`,
                    nodeId,
                    String(effects[i]),
                    VALID_EFFECTS,
                ),
            );
        } else if (effects[i] === "pure") {
            hasPure = true;
        }
    }

    if (hasPure && effects.length > 1) {
        errors.push(
            conflictingEffects(
                `${path}.effects`,
                nodeId,
                effects as string[],
            ),
        );
    }
}

// =============================================================================
// Module Validation
// =============================================================================

export function validateModule(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(
            invalidFieldType("$", null, "$", "object", typeof node),
        );
        return;
    }

    const kind = node["kind"];
    if (kind !== "module") {
        if (kind === undefined) {
            errors.push(missingField(path, null, "kind", "string"));
        } else {
            errors.push(unknownNodeKind(path, String(kind), ["module"]));
        }
        return;
    }

    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const imports = requireArray(node, "imports", path, errors);
    if (imports) {
        for (let i = 0; i < imports.length; i++) {
            validateImport(imports[i], `${path}.imports[${i}]`, errors, idTracker);
        }
    }

    const defs = requireArray(node, "definitions", path, errors);
    if (defs) {
        for (let i = 0; i < defs.length; i++) {
            validateDefinition(
                defs[i],
                `${path}.definitions[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}

// =============================================================================
// Import Validation
// =============================================================================

function validateImport(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "import") {
        errors.push(unknownNodeKind(path, String(kind ?? "undefined"), ["import"]));
        return;
    }

    trackId(node, path, errors, idTracker);
    requireString(node, "module", path, errors);

    const names = requireArray(node, "names", path, errors);
    if (names) {
        for (let i = 0; i < names.length; i++) {
            if (!isString(names[i])) {
                errors.push(
                    invalidFieldType(
                        `${path}.names[${i}]`,
                        getNodeId(node),
                        `names[${i}]`,
                        "string",
                        typeof names[i],
                    ),
                );
            }
        }
    }
}

// =============================================================================
// Definition Validation
// =============================================================================

function validateDefinition(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (!isString(kind)) {
        errors.push(missingField(path, getNodeId(node), "kind", "string"));
        return;
    }

    switch (kind) {
        case "fn":
            validateFunctionDef(node, path, errors, idTracker);
            break;
        case "type":
            validateTypeDef(node, path, errors, idTracker);
            break;
        case "record":
            validateRecordDef(node, path, errors, idTracker);
            break;
        case "enum":
            validateEnumDef(node, path, errors, idTracker);
            break;
        case "const":
            validateConstDef(node, path, errors, idTracker);
            break;
        default:
            errors.push(unknownNodeKind(path, kind, [...VALID_DEFINITION_KINDS]));
    }
}

// =============================================================================
// Function Definition
// =============================================================================

function validateFunctionDef(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    // Params
    const params = requireArray(node, "params", path, errors);
    if (params) {
        for (let i = 0; i < params.length; i++) {
            validateParam(params[i], `${path}.params[${i}]`, errors, idTracker);
        }
    }

    // Effects
    const effects = requireArray(node, "effects", path, errors);
    if (effects) {
        validateEffectsArray(effects, path, getNodeId(node), errors);
    }

    // Return type
    const retType = requireObject(node, "returnType", path, errors);
    if (retType) {
        validateTypeExpr(retType, `${path}.returnType`, errors, idTracker);
    }

    // Contracts
    const contracts = requireArray(node, "contracts", path, errors);
    if (contracts) {
        for (let i = 0; i < contracts.length; i++) {
            validateContract(
                contracts[i],
                `${path}.contracts[${i}]`,
                errors,
                idTracker,
            );
        }
    }

    // Body
    const body = requireArray(node, "body", path, errors);
    if (body) {
        for (let i = 0; i < body.length; i++) {
            validateExpression(body[i], `${path}.body[${i}]`, errors, idTracker);
        }
    }
}

// =============================================================================
// Other Definitions
// =============================================================================

function validateTypeDef(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const def = requireObject(node, "definition", path, errors);
    if (def) {
        validateTypeExpr(def, `${path}.definition`, errors, idTracker);
    }
}

function validateRecordDef(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const fields = requireArray(node, "fields", path, errors);
    if (fields) {
        for (let i = 0; i < fields.length; i++) {
            validateRecordField(
                fields[i],
                `${path}.fields[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}

function validateRecordField(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "field") {
        errors.push(unknownNodeKind(path, String(kind ?? "undefined"), ["field"]));
        return;
    }

    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const type = requireObject(node, "type", path, errors);
    if (type) {
        validateTypeExpr(type, `${path}.type`, errors, idTracker);
    }

    // Optional defaultValue
    if (node["defaultValue"] !== undefined) {
        validateExpression(
            node["defaultValue"],
            `${path}.defaultValue`,
            errors,
            idTracker,
        );
    }
}

function validateEnumDef(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const variants = requireArray(node, "variants", path, errors);
    if (variants) {
        for (let i = 0; i < variants.length; i++) {
            validateEnumVariant(
                variants[i],
                `${path}.variants[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}

function validateEnumVariant(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "variant") {
        errors.push(
            unknownNodeKind(path, String(kind ?? "undefined"), ["variant"]),
        );
        return;
    }

    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const fields = requireArray(node, "fields", path, errors);
    if (fields) {
        for (let i = 0; i < fields.length; i++) {
            validateRecordField(
                fields[i],
                `${path}.fields[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}

function validateConstDef(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const type = requireObject(node, "type", path, errors);
    if (type) {
        validateTypeExpr(type, `${path}.type`, errors, idTracker);
    }

    const value = requireObject(node, "value", path, errors);
    if (value) {
        validateExpression(value, `${path}.value`, errors, idTracker);
    }
}

// =============================================================================
// Param & Contract
// =============================================================================

function validateParam(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "param") {
        errors.push(unknownNodeKind(path, String(kind ?? "undefined"), ["param"]));
        return;
    }

    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const type = requireObject(node, "type", path, errors);
    if (type) {
        validateTypeExpr(type, `${path}.type`, errors, idTracker);
    }
}

function validateContract(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "pre" && kind !== "post") {
        errors.push(
            unknownNodeKind(path, String(kind ?? "undefined"), ["pre", "post"]),
        );
        return;
    }

    trackId(node, path, errors, idTracker);

    const condition = requireObject(node, "condition", path, errors);
    if (condition) {
        validateExpression(condition, `${path}.condition`, errors, idTracker);
    }
}

// =============================================================================
// Type Expressions
// =============================================================================

export function validateTypeExpr(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (!isString(kind)) {
        errors.push(missingField(path, null, "kind", "string"));
        return;
    }

    switch (kind) {
        case "basic":
            validateBasicType(node, path, errors);
            break;
        case "array":
            validateArrayType(node, path, errors, idTracker);
            break;
        case "option":
            validateOptionType(node, path, errors, idTracker);
            break;
        case "result":
            validateResultType(node, path, errors, idTracker);
            break;
        case "unit_type":
            validateUnitType(node, path, errors);
            break;
        case "refined":
            validateRefinedType(node, path, errors, idTracker);
            break;
        case "fn_type":
            validateFnType(node, path, errors, idTracker);
            break;
        case "named":
            requireString(node, "name", path, errors);
            break;
        case "tuple":
            validateTupleType(node, path, errors, idTracker);
            break;
        default:
            errors.push(unknownNodeKind(path, kind, [...VALID_TYPE_KINDS]));
    }
}

function validateBasicType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
): void {
    const name = requireString(node, "name", path, errors);
    if (
        name !== null &&
        !(VALID_BASIC_TYPE_NAMES as readonly string[]).includes(name)
    ) {
        errors.push(invalidBasicTypeName(path, null, name, VALID_BASIC_TYPE_NAMES));
    }
}

function validateArrayType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const element = requireObject(node, "element", path, errors);
    if (element) {
        validateTypeExpr(element, `${path}.element`, errors, idTracker);
    }
}

function validateOptionType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const inner = requireObject(node, "inner", path, errors);
    if (inner) {
        validateTypeExpr(inner, `${path}.inner`, errors, idTracker);
    }
}

function validateResultType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const ok = requireObject(node, "ok", path, errors);
    if (ok) {
        validateTypeExpr(ok, `${path}.ok`, errors, idTracker);
    }
    const err = requireObject(node, "err", path, errors);
    if (err) {
        validateTypeExpr(err, `${path}.err`, errors, idTracker);
    }
}

function validateUnitType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
): void {
    const base = requireString(node, "base", path, errors);
    if (base !== null && base !== "Int" && base !== "Float") {
        errors.push(
            invalidFieldType(path, null, "base", '"Int" | "Float"', `"${base}"`),
        );
    }
    requireString(node, "unit", path, errors);
}

function validateRefinedType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const base = requireObject(node, "base", path, errors);
    if (base) {
        validateTypeExpr(base, `${path}.base`, errors, idTracker);
    }
    requireString(node, "variable", path, errors);

    const pred = requireObject(node, "predicate", path, errors);
    if (pred) {
        validateExpression(pred, `${path}.predicate`, errors, idTracker);
    }
}

function validateFnType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const params = requireArray(node, "params", path, errors);
    if (params) {
        for (let i = 0; i < params.length; i++) {
            if (!isObject(params[i])) {
                errors.push(
                    invalidFieldType(
                        `${path}.params[${i}]`,
                        null,
                        `params[${i}]`,
                        "object",
                        typeof params[i],
                    ),
                );
            } else {
                validateTypeExpr(
                    params[i] as AnyNode,
                    `${path}.params[${i}]`,
                    errors,
                    idTracker,
                );
            }
        }
    }

    const effects = requireArray(node, "effects", path, errors);
    if (effects) {
        validateEffectsArray(effects, path, null, errors);
    }

    const ret = requireObject(node, "returnType", path, errors);
    if (ret) {
        validateTypeExpr(ret, `${path}.returnType`, errors, idTracker);
    }
}

function validateTupleType(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const elements = requireArray(node, "elements", path, errors);
    if (elements) {
        for (let i = 0; i < elements.length; i++) {
            if (!isObject(elements[i])) {
                errors.push(
                    invalidFieldType(
                        `${path}.elements[${i}]`,
                        null,
                        `elements[${i}]`,
                        "object",
                        typeof elements[i],
                    ),
                );
            } else {
                validateTypeExpr(
                    elements[i] as AnyNode,
                    `${path}.elements[${i}]`,
                    errors,
                    idTracker,
                );
            }
        }
    }
}

// =============================================================================
// Expression Validation
// =============================================================================

export function validateExpression(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (!isString(kind)) {
        errors.push(missingField(path, null, "kind", "string"));
        return;
    }

    switch (kind) {
        case "literal":
            validateLiteral(node, path, errors, idTracker);
            break;
        case "ident":
            validateIdentifier(node, path, errors, idTracker);
            break;
        case "binop":
            validateBinaryOp(node, path, errors, idTracker);
            break;
        case "unop":
            validateUnaryOp(node, path, errors, idTracker);
            break;
        case "call":
            validateCall(node, path, errors, idTracker);
            break;
        case "if":
            validateIfExpr(node, path, errors, idTracker);
            break;
        case "let":
            validateLetExpr(node, path, errors, idTracker);
            break;
        case "match":
            validateMatchExpr(node, path, errors, idTracker);
            break;
        case "array":
            validateArrayExpr(node, path, errors, idTracker);
            break;
        case "tuple_expr":
            validateTupleExpr(node, path, errors, idTracker);
            break;
        case "record_expr":
            validateRecordExpr(node, path, errors, idTracker);
            break;
        case "enum_constructor":
            validateEnumConstructorExpr(node, path, errors, idTracker);
            break;
        case "access":
            validateFieldAccess(node, path, errors, idTracker);
            break;
        case "lambda":
            validateLambdaExpr(node, path, errors, idTracker);
            break;
        case "block":
            validateBlockExpr(node, path, errors, idTracker);
            break;
        case "string_interp":
            validateStringInterp(node, path, errors, idTracker);
            break;
        default:
            errors.push(unknownNodeKind(path, kind, [...VALID_EXPRESSION_KINDS]));
    }
}

// =============================================================================
// Individual Expression Validators
// =============================================================================

function validateLiteral(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const val = node["value"];
    if (val === undefined || val === null) {
        errors.push(
            missingField(path, getNodeId(node), "value", "number | string | boolean"),
        );
    } else if (
        typeof val !== "number" &&
        typeof val !== "string" &&
        typeof val !== "boolean"
    ) {
        errors.push(
            invalidFieldType(
                path,
                getNodeId(node),
                "value",
                "number | string | boolean",
                typeof val,
            ),
        );
    }

    // Optional type annotation
    if (node["type"] !== undefined && node["type"] !== null) {
        if (!isObject(node["type"])) {
            errors.push(
                invalidFieldType(
                    path,
                    getNodeId(node),
                    "type",
                    "object",
                    typeof node["type"],
                ),
            );
        } else {
            validateTypeExpr(node["type"], `${path}.type`, errors, idTracker);
        }
    }
}

function validateIdentifier(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);
}

function validateBinaryOp(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const op = requireString(node, "op", path, errors);
    if (op !== null && !(VALID_BINARY_OPS as readonly string[]).includes(op)) {
        errors.push(invalidOperator(path, getNodeId(node), op, VALID_BINARY_OPS));
    }

    const left = requireObject(node, "left", path, errors);
    if (left) {
        validateExpression(left, `${path}.left`, errors, idTracker);
    }

    const right = requireObject(node, "right", path, errors);
    if (right) {
        validateExpression(right, `${path}.right`, errors, idTracker);
    }
}

function validateUnaryOp(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const op = requireString(node, "op", path, errors);
    if (op !== null && !(VALID_UNARY_OPS as readonly string[]).includes(op)) {
        errors.push(invalidOperator(path, getNodeId(node), op, VALID_UNARY_OPS));
    }

    const operand = requireObject(node, "operand", path, errors);
    if (operand) {
        validateExpression(operand, `${path}.operand`, errors, idTracker);
    }
}

function validateCall(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    // fn is now an Expression (not a string) — enables higher-order calls
    const fn = requireObject(node, "fn", path, errors);
    if (fn) {
        validateExpression(fn, `${path}.fn`, errors, idTracker);
    }

    const args = requireArray(node, "args", path, errors);
    if (args) {
        for (let i = 0; i < args.length; i++) {
            validateExpression(args[i], `${path}.args[${i}]`, errors, idTracker);
        }
    }
}

function validateIfExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const cond = requireObject(node, "condition", path, errors);
    if (cond) {
        validateExpression(cond, `${path}.condition`, errors, idTracker);
    }

    const thenBranch = requireArray(node, "then", path, errors);
    if (thenBranch) {
        for (let i = 0; i < thenBranch.length; i++) {
            validateExpression(
                thenBranch[i],
                `${path}.then[${i}]`,
                errors,
                idTracker,
            );
        }
    }

    const elseBranch = node["else"];
    if (elseBranch !== undefined && elseBranch !== null) {
        if (!isArray(elseBranch)) {
            errors.push(
                invalidFieldType(path, getNodeId(node), "else", "array", typeof elseBranch),
            );
        } else {
            for (let i = 0; i < elseBranch.length; i++) {
                validateExpression(
                    elseBranch[i],
                    `${path}.else[${i}]`,
                    errors,
                    idTracker,
                );
            }
        }
    }
}

function validateLetExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    // Optional type annotation
    if (node["type"] !== undefined && node["type"] !== null) {
        if (!isObject(node["type"])) {
            errors.push(
                invalidFieldType(
                    path,
                    getNodeId(node),
                    "type",
                    "object",
                    typeof node["type"],
                ),
            );
        } else {
            validateTypeExpr(node["type"], `${path}.type`, errors, idTracker);
        }
    }

    const value = requireObject(node, "value", path, errors);
    if (value) {
        validateExpression(value, `${path}.value`, errors, idTracker);
    }
}

function validateMatchExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const target = requireObject(node, "target", path, errors);
    if (target) {
        validateExpression(target, `${path}.target`, errors, idTracker);
    }

    const arms = requireArray(node, "arms", path, errors);
    if (arms) {
        for (let i = 0; i < arms.length; i++) {
            validateMatchArm(arms[i], `${path}.arms[${i}]`, errors, idTracker);
        }
    }
}

function validateMatchArm(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "arm") {
        errors.push(unknownNodeKind(path, String(kind ?? "undefined"), ["arm"]));
        return;
    }

    trackId(node, path, errors, idTracker);

    const pattern = requireObject(node, "pattern", path, errors);
    if (pattern) {
        validatePattern(pattern, `${path}.pattern`, errors);
    }

    const body = requireArray(node, "body", path, errors);
    if (body) {
        for (let i = 0; i < body.length; i++) {
            validateExpression(body[i], `${path}.body[${i}]`, errors, idTracker);
        }
    }
}

function validatePattern(
    node: unknown,
    path: string,
    errors: StructuredError[],
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (!isString(kind)) {
        errors.push(missingField(path, null, "kind", "string"));
        return;
    }

    switch (kind) {
        case "literal_pattern": {
            const val = node["value"];
            if (val === undefined || val === null) {
                errors.push(
                    missingField(path, null, "value", "number | string | boolean"),
                );
            } else if (
                typeof val !== "number" &&
                typeof val !== "string" &&
                typeof val !== "boolean"
            ) {
                errors.push(
                    invalidFieldType(
                        path,
                        null,
                        "value",
                        "number | string | boolean",
                        typeof val,
                    ),
                );
            }
            break;
        }
        case "wildcard":
            // No additional fields needed
            break;
        case "binding":
            requireString(node, "name", path, errors);
            break;
        case "constructor": {
            requireString(node, "name", path, errors);
            const fields = requireArray(node, "fields", path, errors);
            if (fields) {
                for (let i = 0; i < fields.length; i++) {
                    validatePattern(fields[i], `${path}.fields[${i}]`, errors);
                }
            }
            break;
        }
        default:
            errors.push(unknownNodeKind(path, kind, [...VALID_PATTERN_KINDS]));
    }
}

function validateArrayExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const elements = requireArray(node, "elements", path, errors);
    if (elements) {
        for (let i = 0; i < elements.length; i++) {
            validateExpression(
                elements[i],
                `${path}.elements[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}

function validateTupleExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const elements = requireArray(node, "elements", path, errors);
    if (elements) {
        for (let i = 0; i < elements.length; i++) {
            validateExpression(
                elements[i],
                `${path}.elements[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}

function validateRecordExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "name", path, errors);

    const fields = requireArray(node, "fields", path, errors);
    if (fields) {
        for (let i = 0; i < fields.length; i++) {
            validateFieldInit(fields[i], `${path}.fields[${i}]`, path, getNodeId(node), errors, idTracker);
        }
    }
}

function validateEnumConstructorExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);
    requireString(node, "enumName", path, errors);
    requireString(node, "variant", path, errors);

    const fields = requireArray(node, "fields", path, errors);
    if (fields) {
        for (let i = 0; i < fields.length; i++) {
            validateFieldInit(fields[i], `${path}.fields[${i}]`, path, getNodeId(node), errors, idTracker);
        }
    }
}

/**
 * Validate a FieldInit node ({ kind: "field_init", name, value }).
 */
function validateFieldInit(
    node: unknown,
    path: string,
    _parentPath: string,
    _parentId: string | null,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    if (!isObject(node)) {
        errors.push(invalidFieldType(path, null, path, "object", typeof node));
        return;
    }

    const kind = node["kind"];
    if (kind !== "field_init") {
        errors.push(unknownNodeKind(path, String(kind ?? "undefined"), ["field_init"]));
        return;
    }

    requireString(node, "name", path, errors);

    const val = requireObject(node, "value", path, errors);
    if (val) {
        validateExpression(val, `${path}.value`, errors, idTracker);
    }
}

function validateFieldAccess(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const target = requireObject(node, "target", path, errors);
    if (target) {
        validateExpression(target, `${path}.target`, errors, idTracker);
    }

    requireString(node, "field", path, errors);
}

function validateLambdaExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const params = requireArray(node, "params", path, errors);
    if (params) {
        for (let i = 0; i < params.length; i++) {
            validateParam(params[i], `${path}.params[${i}]`, errors, idTracker);
        }
    }

    const body = requireArray(node, "body", path, errors);
    if (body) {
        for (let i = 0; i < body.length; i++) {
            validateExpression(body[i], `${path}.body[${i}]`, errors, idTracker);
        }
    }
}

function validateBlockExpr(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const body = requireArray(node, "body", path, errors);
    if (body) {
        for (let i = 0; i < body.length; i++) {
            validateExpression(body[i], `${path}.body[${i}]`, errors, idTracker);
        }
    }
}

function validateStringInterp(
    node: AnyNode,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    trackId(node, path, errors, idTracker);

    const parts = requireArray(node, "parts", path, errors);
    if (parts) {
        for (let i = 0; i < parts.length; i++) {
            validateExpression(
                parts[i],
                `${path}.parts[${i}]`,
                errors,
                idTracker,
            );
        }
    }
}
