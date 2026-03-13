// =============================================================================
// Schema-Driven AST Validator
// =============================================================================
// Validates Edict ASTs by walking the generated JSON Schema directly.
// Zero hand-written structural checks — the schema IS the source of truth.
// Only semantic checks (effects conflicts, import types) remain manual.

import type { StructuredError, FixSuggestion } from "../errors/structured-errors.js";
import {
    missingField,
    invalidFieldType,
    unknownNodeKind,
    invalidEffect,
    invalidOperator,
    invalidBasicTypeName,
    conflictingEffects,
    invalidSemanticAssertion,
} from "../errors/structured-errors.js";
import { findCandidates } from "../resolver/levenshtein.js";
import type { IdTracker } from "./id-tracker.js";

import moduleSchema from "../../schema/edict.schema.json" with { type: "json" };
import fragmentSchema from "../../schema/edict-fragment.schema.json" with { type: "json" };

// =============================================================================
// Types for JSON Schema subset we handle
// =============================================================================

type JsonSchema = Record<string, unknown>;
type AnyNode = Record<string, unknown>;

const definitions = (moduleSchema as JsonSchema)["definitions"] as Record<string, JsonSchema>;

// =============================================================================
// Helpers
// =============================================================================

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
 * Resolve a $ref string like "#/definitions/Expression" to its schema object.
 */
function resolveRef(ref: string): JsonSchema {
    const prefix = "#/definitions/";
    if (!ref.startsWith(prefix)) {
        throw new Error(`Unsupported $ref: ${ref}`);
    }
    const name = decodeURIComponent(ref.slice(prefix.length));
    const resolved = definitions[name];
    if (!resolved) {
        throw new Error(`Unknown $ref: ${ref}`);
    }
    return resolved;
}

/**
 * Get the concrete schema for a value, resolving $ref if present.
 */
function resolve(schema: JsonSchema): JsonSchema {
    if (schema["$ref"]) {
        return resolveRef(schema["$ref"] as string);
    }
    return schema;
}

/**
 * Format a type expectation string from a JSON Schema type field.
 */
function formatExpectedType(schema: JsonSchema): string {
    const type = schema["type"];
    if (isArray(type)) {
        return (type as string[]).join(" | ");
    }
    if (isString(type)) {
        return type;
    }
    if (schema["enum"]) {
        return "string";
    }
    if (schema["anyOf"]) {
        return "object";
    }
    if (schema["$ref"]) {
        return formatExpectedType(resolve(schema));
    }
    return "unknown";
}

/**
 * Check if a value matches a JSON Schema type field.
 */
function matchesType(value: unknown, type: string | string[]): boolean {
    const types = isArray(type) ? type : [type];
    const actual = typeof value;
    for (const t of types) {
        if (t === "string" && actual === "string") return true;
        if (t === "number" && actual === "number") return true;
        if (t === "boolean" && actual === "boolean") return true;
        if (t === "object" && isObject(value)) return true;
        if (t === "array" && isArray(value)) return true;
    }
    return false;
}

// =============================================================================
// Error context detection — map schema $ref names to specific error types
// =============================================================================

// These $ref names get specialized error constructors instead of generic invalidFieldType
const EFFECT_REF = "#/definitions/Effect";
const BINARY_OP_REF = "#/definitions/BinaryOperator";
const UNARY_OP_REF = "#/definitions/UnaryOperator";

// BasicType.name has `enum` directly in the schema, we detect it by the field context
function isBasicTypeNameField(
    parentSchema: JsonSchema,
    fieldName: string,
): boolean {
    // BasicType has kind: "basic" and name field with enum
    const props = parentSchema["properties"] as Record<string, JsonSchema> | undefined;
    if (!props) return false;
    const kindProp = props["kind"];
    if (!kindProp) return false;
    if (kindProp["const"] === "basic" && fieldName === "name") return true;
    return false;
}

// =============================================================================
// Core Walker
// =============================================================================

/**
 * Validate a node against a concrete (non-union) object schema.
 */
function validateObject(
    node: AnyNode,
    schema: JsonSchema,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const properties = schema["properties"] as Record<string, JsonSchema> | undefined;
    const required = schema["required"] as string[] | undefined;

    if (!properties) return;

    // Track ID if required/present
    if (properties["id"] && isString(node["id"])) {
        idTracker.track(node["id"], path);
    } else if (required?.includes("id") && !isString(node["id"])) {
        if (node["id"] === undefined || node["id"] === null) {
            errors.push(missingField(path, null, "id", "string"));
        } else {
            errors.push(
                invalidFieldType(path, null, "id", "string", typeof node["id"]),
            );
        }
    }

    // Validate each declared property (skip "kind" and "id" — handled separately)
    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
        if (fieldName === "kind" || fieldName === "id") continue;

        const value = node[fieldName];
        const isRequired = required?.includes(fieldName) ?? false;
        const nodeId = getNodeId(node);

        // Resolve the field schema (follow $ref)
        const resolved = resolve(fieldSchema);
        const rawRef = fieldSchema["$ref"] as string | undefined;

        // Check presence
        if (value === undefined || value === null) {
            if (isRequired) {
                // For required returnType, provide a concrete template suggestion
                const suggestion: FixSuggestion | undefined =
                    fieldName === "returnType"
                        ? { nodeId: nodeId, field: "returnType", value: { kind: "basic", name: "Int" } }
                        : undefined;
                errors.push(
                    missingField(path, nodeId, fieldName, formatExpectedType(resolved), suggestion),
                );
            }
            continue;
        }

        // Validate based on schema shape
        if (resolved["type"]) {
            const schemaType = resolved["type"];

            // Enum string type (Effect, BinaryOperator, UnaryOperator, BasicType.name, UnitType.base)
            if (resolved["enum"]) {
                const validValues = resolved["enum"] as string[];
                if (!isString(value) || !validValues.includes(value)) {
                    const received = String(value);

                    // Emit specialized errors based on context
                    if (rawRef === EFFECT_REF) {
                        errors.push(
                            invalidEffect(
                                `${path}.${fieldName}`,
                                nodeId,
                                received,
                                validValues,
                            ),
                        );
                    } else if (rawRef === BINARY_OP_REF) {
                        errors.push(
                            invalidOperator(path, nodeId, received, validValues),
                        );
                    } else if (rawRef === UNARY_OP_REF) {
                        errors.push(
                            invalidOperator(path, nodeId, received, validValues),
                        );
                    } else if (isBasicTypeNameField(schema, fieldName)) {
                        errors.push(
                            invalidBasicTypeName(path, nodeId, received, validValues),
                        );
                    } else {
                        errors.push(
                            invalidFieldType(
                                path,
                                nodeId,
                                fieldName,
                                `"${validValues.join('" | "')}"`,
                                `"${received}"`,
                            ),
                        );
                    }
                    continue;
                }
                continue;
            }

            // Simple type check
            if (isString(schemaType) || isArray(schemaType)) {
                if (!matchesType(value, schemaType as string | string[])) {
                    errors.push(
                        invalidFieldType(
                            path,
                            nodeId,
                            fieldName,
                            formatExpectedType(resolved),
                            typeof value,
                        ),
                    );
                    continue;
                }
            }

            // Array with items — validate each element
            if (schemaType === "array" && resolved["items"]) {
                if (!isArray(value)) {
                    errors.push(
                        invalidFieldType(path, nodeId, fieldName, "array", typeof value),
                    );
                    continue;
                }
                const itemSchema = resolved["items"] as JsonSchema;
                const itemResolved = resolve(itemSchema);
                for (let i = 0; i < (value as unknown[]).length; i++) {
                    const item = (value as unknown[])[i];
                    // Primitive array items: emit error with relative field name
                    if (itemResolved["type"] && !itemResolved["anyOf"] && !itemResolved["properties"]) {
                        if (!matchesType(item, itemResolved["type"] as string | string[])) {
                            errors.push(
                                invalidFieldType(
                                    path,
                                    nodeId,
                                    `${fieldName}[${i}]`,
                                    formatExpectedType(itemResolved),
                                    typeof item,
                                ),
                            );
                        }
                    } else {
                        validateValue(
                            item,
                            itemSchema,
                            `${path}.${fieldName}[${i}]`,
                            errors,
                            idTracker,
                        );
                    }
                }
                continue;
            }

            // Nested object — recurse
            if (schemaType === "object" && resolved["properties"]) {
                if (!isObject(value)) {
                    errors.push(
                        invalidFieldType(path, nodeId, fieldName, "object", typeof value),
                    );
                    continue;
                }
                validateObject(
                    value,
                    resolved,
                    `${path}.${fieldName}`,
                    errors,
                    idTracker,
                );
                continue;
            }

            // Simple string/number/boolean — already type-checked above
            continue;
        }

        // anyOf — field is a discriminated union
        if (resolved["anyOf"]) {
            if (!isObject(value)) {
                errors.push(
                    invalidFieldType(path, nodeId, fieldName, "object", typeof value),
                );
                continue;
            }
            validateUnion(
                value,
                resolved["anyOf"] as JsonSchema[],
                `${path}.${fieldName}`,
                errors,
                idTracker,
            );
            continue;
        }
    }

    // Semantic checks
    runSemanticChecks(node, schema, path, errors, idTracker);
}

/**
 * Validate a value against an arbitrary field schema (handles $ref, anyOf, primitive types).
 */
function validateValue(
    value: unknown,
    schema: JsonSchema,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const resolved = resolve(schema);

    // anyOf — discriminated union (may include non-object branches like string enums)
    if (resolved["anyOf"]) {
        const branches = resolved["anyOf"] as JsonSchema[];

        // If value is a string, check if any branch is a string enum that includes it
        if (isString(value)) {
            for (const branch of branches) {
                const branchResolved = resolve(branch);
                if (branchResolved["enum"] && (branchResolved["enum"] as string[]).includes(value as string)) {
                    return; // valid match against enum branch
                }
                if (branchResolved["type"] === "string") {
                    return; // valid match against string type branch
                }
            }
            // No enum branch matched — report error
            errors.push(
                invalidFieldType(path, null, path, "object", typeof value),
            );
            return;
        }

        if (!isObject(value)) {
            errors.push(
                invalidFieldType(path, null, path, "object", typeof value),
            );
            return;
        }
        validateUnion(value, branches, path, errors, idTracker);
        return;
    }

    // Object with properties
    if (resolved["type"] === "object" && resolved["properties"]) {
        if (!isObject(value)) {
            errors.push(
                invalidFieldType(path, null, path, "object", typeof value),
            );
            return;
        }
        // Check kind if present
        const props = resolved["properties"] as Record<string, JsonSchema>;
        const kindProp = props["kind"];
        if (kindProp) {
            const kindConst = kindProp["const"] as string | undefined;
            const kindEnum = kindProp["enum"] as string[] | undefined;
            const kind = (value as AnyNode)["kind"];
            if (!isString(kind)) {
                // For concrete types with a known const/enum, emit unknownNodeKind
                const validKinds = kindConst ? [kindConst] : (kindEnum ?? []);
                errors.push(unknownNodeKind(path, "", validKinds));
                return;
            }
            if (kindConst && kind !== kindConst) {
                const suggestion = kindSuggestion(kind, [kindConst]);
                errors.push(unknownNodeKind(path, kind, [kindConst], suggestion));
                return;
            }
            if (kindEnum && !kindEnum.includes(kind)) {
                const suggestion = kindSuggestion(kind, kindEnum);
                errors.push(unknownNodeKind(path, kind, kindEnum, suggestion));
                return;
            }
        }
        validateObject(value as AnyNode, resolved, path, errors, idTracker);
        return;
    }

    // Enum type
    if (resolved["enum"]) {
        const validValues = resolved["enum"] as string[];
        if (!isString(value) || !validValues.includes(value)) {
            errors.push(
                invalidFieldType(path, null, path, "string", typeof value),
            );
        }
        return;
    }

    // Array type
    if (resolved["type"] === "array") {
        if (!isArray(value)) {
            errors.push(
                invalidFieldType(path, null, path, "array", typeof value),
            );
            return;
        }
        if (resolved["items"]) {
            const items = value as unknown[];
            const itemSchema = resolved["items"] as JsonSchema;
            for (let i = 0; i < items.length; i++) {
                validateValue(items[i], itemSchema, `${path}[${i}]`, errors, idTracker);
            }
        }
        return;
    }

    // Simple type check
    if (resolved["type"]) {
        if (!matchesType(value, resolved["type"] as string | string[])) {
            errors.push(
                invalidFieldType(
                    path,
                    null,
                    path,
                    formatExpectedType(resolved),
                    typeof value,
                ),
            );
        }
    }
}

/**
 * Generate a FixSuggestion for an unknown kind if a close Levenshtein match exists.
 */
function kindSuggestion(received: string, validKinds: readonly string[]): FixSuggestion | undefined {
    if (!received) return undefined;
    const candidates = findCandidates(received, validKinds as string[]);
    if (candidates.length === 0) return undefined;
    return { nodeId: null, field: "kind", value: candidates[0] };
}

/**
 * Validate a node against an anyOf union by matching on the `kind` discriminator.
 */
function validateUnion(
    node: AnyNode,
    branches: JsonSchema[],
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const kind = node["kind"];
    if (!isString(kind)) {
        // Collect valid kinds from branches to emit unknownNodeKind
        const validKinds: string[] = [];
        for (const branch of branches) {
            const resolved = resolve(branch);
            const props = resolved["properties"] as Record<string, JsonSchema> | undefined;
            if (!props?.["kind"]) continue;
            const kindSchema = props["kind"];
            if (kindSchema["const"]) validKinds.push(kindSchema["const"] as string);
            if (kindSchema["enum"]) validKinds.push(...(kindSchema["enum"] as string[]));
        }
        if (kind === undefined || kind === null) {
            errors.push(missingField(path, null, "kind", "string"));
        } else {
            const suggestion = kindSuggestion(String(kind), validKinds);
            errors.push(unknownNodeKind(path, String(kind), validKinds, suggestion));
        }
        return;
    }

    // Collect valid kinds and find matching branch
    const validKinds: string[] = [];
    for (const branch of branches) {
        const resolved = resolve(branch);
        const props = resolved["properties"] as Record<string, JsonSchema> | undefined;
        if (!props?.["kind"]) continue;

        const kindSchema = props["kind"];
        if (kindSchema["const"]) {
            const constVal = kindSchema["const"] as string;
            validKinds.push(constVal);
            if (kind === constVal) {
                validateObject(node, resolved, path, errors, idTracker);
                return;
            }
        }
        if (kindSchema["enum"]) {
            const enumVals = kindSchema["enum"] as string[];
            validKinds.push(...enumVals);
            if (enumVals.includes(kind)) {
                validateObject(node, resolved, path, errors, idTracker);
                return;
            }
        }
    }

    // No branch matched
    const suggestion = kindSuggestion(kind, validKinds);
    errors.push(unknownNodeKind(path, kind, validKinds, suggestion));
}

// =============================================================================
// Semantic Checks (not expressible in JSON Schema)
// =============================================================================

/**
 * Run semantic checks that can't be expressed in JSON Schema:
 * 1. Effects array: "pure" can't coexist with other effects
 * 2. Import types: keys must appear in names array
 */
function runSemanticChecks(
    node: AnyNode,
    schema: JsonSchema,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const props = schema["properties"] as Record<string, JsonSchema> | undefined;
    if (!props) return;

    const nodeId = getNodeId(node);

    // Effects conflict check — applies to any node with an "effects" array field
    if (props["effects"] && isArray(node["effects"])) {
        const effects = node["effects"] as unknown[];
        let hasPure = false;
        let hasEffectVar = false;

        // Resolve the items schema to find valid concrete effects.
        // Items may be a plain enum (ConcreteEffect) or an anyOf union (Effect = ConcreteEffect | EffectVariable).
        const effectSchema = resolve(props["effects"]);
        if (effectSchema["type"] === "array" && effectSchema["items"]) {
            const itemResolved = resolve(effectSchema["items"] as JsonSchema);

            // Extract valid concrete effect strings from schema
            let validEffects: string[] | null = null;
            if (itemResolved["enum"]) {
                // Plain enum: ConcreteEffect
                validEffects = itemResolved["enum"] as string[];
            } else if (itemResolved["anyOf"]) {
                // Union: Effect = ConcreteEffect | EffectVariable
                for (const branch of itemResolved["anyOf"] as JsonSchema[]) {
                    const branchResolved = resolve(branch);
                    if (branchResolved["enum"]) {
                        validEffects = branchResolved["enum"] as string[];
                        break;
                    }
                }
            }

            if (validEffects) {
                for (let i = 0; i < effects.length; i++) {
                    const eff = effects[i];

                    // Case 1: Effect variable object { kind: "effect_var", name: "..." }
                    if (isObject(eff) && (eff as AnyNode)["kind"] === "effect_var") {
                        hasEffectVar = true;
                        // Validate naming convention: single uppercase ASCII letter
                        const varName = (eff as AnyNode)["name"];
                        if (!isString(varName) || !/^[A-Z]$/.test(varName)) {
                            errors.push(
                                invalidFieldType(
                                    `${path}.effects[${i}]`,
                                    nodeId,
                                    "name",
                                    "single uppercase letter (A-Z)",
                                    isString(varName) ? `"${varName}"` : typeof varName,
                                ),
                            );
                        }
                        continue;
                    }

                    // Case 2: Concrete effect string
                    if (
                        !isString(eff) ||
                        !validEffects.includes(eff as string)
                    ) {
                        errors.push(
                            invalidEffect(
                                `${path}.effects[${i}]`,
                                nodeId,
                                String(eff),
                                validEffects,
                            ),
                        );
                    } else if (eff === "pure") {
                        hasPure = true;
                    }
                }
            }
        }

        // "pure" can't coexist with other concrete effects or effect variables
        if (hasPure && (effects.length > 1 || hasEffectVar)) {
            errors.push(
                conflictingEffects(
                    `${path}.effects`,
                    nodeId,
                    effects.map(e => isObject(e) ? `effect_var(${(e as AnyNode)["name"]})` : String(e)),
                ),
            );
        }
    }

    // Import types cross-field check — keys in "types" must appear in "names"
    const kindProp = props["kind"];
    if (kindProp?.["const"] === "import" && node["types"] !== undefined && node["types"] !== null) {
        const types = node["types"];
        const names = node["names"];
        if (isObject(types) && isArray(names)) {
            const nameSet = new Set(
                (names as unknown[]).filter(isString),
            );
            for (const [key, value] of Object.entries(types)) {
                if (nameSet.size > 0 && !nameSet.has(key)) {
                    errors.push(
                        invalidFieldType(
                            `${path}.types.${key}`,
                            nodeId,
                            `types.${key}`,
                            "name from imports.names",
                            `"${key}" (not in names)`,
                        ),
                    );
                }
                // Validate each type value as a TypeExpr
                // (Schema generates Record<string,TypeExpr> as just "type":"object",
                //  losing inner validation — must validate manually here)
                if (!isObject(value)) {
                    errors.push(
                        invalidFieldType(
                            `${path}.types.${key}`,
                            nodeId,
                            `types.${key}`,
                            "object (TypeExpr)",
                            typeof value,
                        ),
                    );
                } else {
                    const typeExprSchema = definitions["TypeExpr"];
                    if (typeExprSchema) {
                        validateValue(
                            value,
                            typeExprSchema,
                            `${path}.types.${key}`,
                            errors,
                            idTracker,
                        );
                    }
                }
            }
        } else if (!isObject(types)) {
            errors.push(
                invalidFieldType(path, nodeId, "types", "object", typeof types),
            );
        }
    }

    // Contract field check — applies to contract nodes (kind: "pre" | "post")
    // Contract must have exactly one of condition or semantic.
    // semantic is only valid on post contracts (v1).
    if (
        kindProp &&
        kindProp["enum"] &&
        (kindProp["enum"] as string[]).includes("pre") &&
        (kindProp["enum"] as string[]).includes("post")
    ) {
        const kind = node["kind"] as string;
        const hasCondition = node["condition"] !== undefined && node["condition"] !== null;
        const hasSemantic = node["semantic"] !== undefined && node["semantic"] !== null;

        if (!hasCondition && !hasSemantic) {
            errors.push(
                missingField(path, nodeId, "condition", "Expression or semantic: SemanticAssertion"),
            );
        }

        if (hasCondition && hasSemantic) {
            errors.push(
                invalidFieldType(path, nodeId, "semantic", "absent (condition is already set)", "object"),
            );
        }

        if (hasSemantic && kind === "pre") {
            errors.push(
                invalidFieldType(path, nodeId, "semantic", "absent (semantic assertions only valid on post contracts)", "object"),
            );
        }

        // Validate semantic assertion kind if present
        if (hasSemantic && isObject(node["semantic"])) {
            const semantic = node["semantic"] as AnyNode;
            const assertion = semantic["assertion"];
            const VALID = ["sorted", "permutation_of", "subset_of", "sum_preserved", "no_duplicates", "length_preserved", "bounded"];
            if (isString(assertion) && !VALID.includes(assertion)) {
                errors.push(
                    invalidSemanticAssertion(
                        nodeId ?? "",
                        nodeId ?? "",
                        assertion,
                        VALID,
                    ),
                );
            }
        }
    }

    // Blame confidence range check — confidence must be 0–1
    if (props["blame"] && isObject(node["blame"])) {
        const blame = node["blame"] as AnyNode;
        const confidence = blame["confidence"];
        if (typeof confidence === "number" && (confidence < 0 || confidence > 1)) {
            errors.push(
                invalidFieldType(
                    `${path}.blame`,
                    nodeId,
                    "confidence",
                    "number (0–1)",
                    String(confidence),
                ),
            );
        }
    }

    // minConfidence range check — must be 0–1
    if (props["minConfidence"] && typeof node["minConfidence"] === "number") {
        const minConf = node["minConfidence"] as number;
        if (minConf < 0 || minConf > 1) {
            errors.push(
                invalidFieldType(
                    path,
                    nodeId,
                    "minConfidence",
                    "number (0–1)",
                    String(minConf),
                ),
            );
        }
    }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Validate a node as an Edict module.
 */
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

    validateObject(node, moduleSchema as unknown as JsonSchema, path, errors, idTracker);
}

/**
 * Validate a node as an Edict fragment.
 */
export function validateFragment(
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
    if (kind !== "fragment") {
        if (kind === undefined) {
            errors.push(missingField(path, null, "kind", "string"));
        } else {
            errors.push(unknownNodeKind(path, String(kind), ["fragment"]));
        }
        return;
    }

    validateObject(node, fragmentSchema as unknown as JsonSchema, path, errors, idTracker);
}

/**
 * Validate an expression node (for direct exports / backward compat).
 */
export function validateExpression(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const exprSchema = definitions["Expression"];
    if (!exprSchema) {
        throw new Error("Expression not found in schema definitions");
    }
    validateValue(node, exprSchema, path, errors, idTracker);
}

/**
 * Validate a type expression node (for direct exports / backward compat).
 */
export function validateTypeExpr(
    node: unknown,
    path: string,
    errors: StructuredError[],
    idTracker: IdTracker,
): void {
    const typeSchema = definitions["TypeExpr"];
    if (!typeSchema) {
        throw new Error("TypeExpr not found in schema definitions");
    }
    validateValue(node, typeSchema, path, errors, idTracker);
}
