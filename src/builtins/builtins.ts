// =============================================================================
// Builtins — Built-in functions available to all Edict programs
// =============================================================================
// These are not defined in user code. The resolver and type checker
// register them automatically. The codegen imports them from the host.

import type { FunctionType } from "../ast/types.js";
import { INT_TYPE, FLOAT_TYPE, STRING_TYPE, BOOL_TYPE, ARRAY_INT_TYPE, OPTION_INT_TYPE } from "../ast/type-constants.js";

export interface BuiltinFunction {
    /** Edict-level function type signature (includes effects, params, returnType) */
    type: FunctionType;
    /** WASM import: [module, base] names */
    wasmImport: [string, string];
}

/**
 * All built-in functions.
 *
 * `print` takes a String and returns a String (the value printed).
 * At the WASM level, it's imported as host.print(ptr, len) → ptr
 * (returns the same pointer for passthrough).
 */
export const BUILTIN_FUNCTIONS: ReadonlyMap<string, BuiltinFunction> = new Map([
    [
        "print",
        {
            type: {
                kind: "fn_type",
                params: [STRING_TYPE],
                effects: ["io"],
                returnType: STRING_TYPE,
            },
            wasmImport: ["host", "print"],
        },
    ],
    [
        "string_replace",
        {
            type: {
                kind: "fn_type",
                params: [STRING_TYPE, STRING_TYPE, STRING_TYPE],
                effects: ["pure"],
                returnType: STRING_TYPE,
            },
            wasmImport: ["host", "string_replace"],
        },
    ],
    // =========================================================================
    // String builtins — pure, string handling needed
    // =========================================================================
    [
        "string_length",
        {
            type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "string_length"],
        },
    ],
    [
        "substring",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, INT_TYPE, INT_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "substring"],
        },
    ],
    [
        "string_concat",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "string_concat"],
        },
    ],
    [
        "string_indexOf",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "string_indexOf"],
        },
    ],
    [
        "toUpperCase",
        {
            type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "toUpperCase"],
        },
    ],
    [
        "toLowerCase",
        {
            type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "toLowerCase"],
        },
    ],
    [
        "string_trim",
        {
            type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "string_trim"],
        },
    ],
    [
        "string_startsWith",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "string_startsWith"],
        },
    ],
    [
        "string_endsWith",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "string_endsWith"],
        },
    ],
    [
        "string_contains",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "string_contains"],
        },
    ],
    [
        "string_repeat",
        {
            type: { kind: "fn_type", params: [STRING_TYPE, INT_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "string_repeat"],
        },
    ],
    // =========================================================================
    // Math builtins — pure, no string handling needed
    // =========================================================================
    [
        "abs",
        {
            type: { kind: "fn_type", params: [INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "abs"],
        },
    ],
    [
        "min",
        {
            type: { kind: "fn_type", params: [INT_TYPE, INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "min"],
        },
    ],
    [
        "max",
        {
            type: { kind: "fn_type", params: [INT_TYPE, INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "max"],
        },
    ],
    [
        "pow",
        {
            type: { kind: "fn_type", params: [INT_TYPE, INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "pow"],
        },
    ],
    [
        "sqrt",
        {
            type: { kind: "fn_type", params: [FLOAT_TYPE], effects: ["pure"], returnType: FLOAT_TYPE },
            wasmImport: ["host", "sqrt"],
        },
    ],
    [
        "floor",
        {
            type: { kind: "fn_type", params: [FLOAT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "floor"],
        },
    ],
    [
        "ceil",
        {
            type: { kind: "fn_type", params: [FLOAT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "ceil"],
        },
    ],
    [
        "round",
        {
            type: { kind: "fn_type", params: [FLOAT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "round"],
        },
    ],
    // =========================================================================
    // Type conversion builtins — pure, cross-type conversion
    // =========================================================================
    [
        "intToString",
        {
            type: { kind: "fn_type", params: [INT_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "intToString"],
        },
    ],
    [
        "floatToString",
        {
            type: { kind: "fn_type", params: [FLOAT_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "floatToString"],
        },
    ],
    [
        "boolToString",
        {
            type: { kind: "fn_type", params: [BOOL_TYPE], effects: ["pure"], returnType: STRING_TYPE },
            wasmImport: ["host", "boolToString"],
        },
    ],
    [
        "floatToInt",
        {
            type: { kind: "fn_type", params: [FLOAT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "floatToInt"],
        },
    ],
    [
        "intToFloat",
        {
            type: { kind: "fn_type", params: [INT_TYPE], effects: ["pure"], returnType: FLOAT_TYPE },
            wasmImport: ["host", "intToFloat"],
        },
    ],
    // =========================================================================
    // Array builtins — pure, operate on heap-allocated [length][elem0][elem1]...
    // =========================================================================
    [
        "array_length",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "array_length"],
        },
    ],
    [
        "array_get",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE, INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "array_get"],
        },
    ],
    [
        "array_set",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE, INT_TYPE, INT_TYPE], effects: ["pure"], returnType: ARRAY_INT_TYPE },
            wasmImport: ["host", "array_set"],
        },
    ],
    [
        "array_push",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE, INT_TYPE], effects: ["pure"], returnType: ARRAY_INT_TYPE },
            wasmImport: ["host", "array_push"],
        },
    ],
    [
        "array_pop",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE], effects: ["pure"], returnType: ARRAY_INT_TYPE },
            wasmImport: ["host", "array_pop"],
        },
    ],
    [
        "array_concat",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE, ARRAY_INT_TYPE], effects: ["pure"], returnType: ARRAY_INT_TYPE },
            wasmImport: ["host", "array_concat"],
        },
    ],
    [
        "array_slice",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE, INT_TYPE, INT_TYPE], effects: ["pure"], returnType: ARRAY_INT_TYPE },
            wasmImport: ["host", "array_slice"],
        },
    ],
    [
        "array_isEmpty",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "array_isEmpty"],
        },
    ],
    [
        "array_contains",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE, INT_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "array_contains"],
        },
    ],
    [
        "array_reverse",
        {
            type: { kind: "fn_type", params: [ARRAY_INT_TYPE], effects: ["pure"], returnType: ARRAY_INT_TYPE },
            wasmImport: ["host", "array_reverse"],
        },
    ],
    // =========================================================================
    // HOF array builtins — WASM-native (not host-imported)
    // These use call_indirect to invoke closure arguments, so they must be
    // generated as WASM functions in codegen, not imported from the host.
    // wasmImport sentinel ["__wasm", "..."] signals codegen to skip import.
    // =========================================================================
    [
        "array_map",
        {
            type: {
                kind: "fn_type",
                params: [
                    ARRAY_INT_TYPE,
                    { kind: "fn_type", params: [INT_TYPE], effects: [], returnType: INT_TYPE },
                ],
                effects: ["pure"],
                returnType: ARRAY_INT_TYPE,
            },
            wasmImport: ["__wasm", "array_map"],
        },
    ],
    [
        "array_filter",
        {
            type: {
                kind: "fn_type",
                params: [
                    ARRAY_INT_TYPE,
                    { kind: "fn_type", params: [INT_TYPE], effects: [], returnType: BOOL_TYPE },
                ],
                effects: ["pure"],
                returnType: ARRAY_INT_TYPE,
            },
            wasmImport: ["__wasm", "array_filter"],
        },
    ],
    [
        "array_reduce",
        {
            type: {
                kind: "fn_type",
                params: [
                    ARRAY_INT_TYPE,
                    INT_TYPE,
                    { kind: "fn_type", params: [INT_TYPE, INT_TYPE], effects: [], returnType: INT_TYPE },
                ],
                effects: ["pure"],
                returnType: INT_TYPE,
            },
            wasmImport: ["__wasm", "array_reduce"],
        },
    ],
    // =========================================================================
    // Option builtins — operate on heap-allocated [tag: i32][value: i32]
    // =========================================================================
    [
        "isSome",
        {
            type: { kind: "fn_type", params: [OPTION_INT_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "isSome"],
        },
    ],
    [
        "isNone",
        {
            type: { kind: "fn_type", params: [OPTION_INT_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
            wasmImport: ["host", "isNone"],
        },
    ],
    [
        "unwrap",
        {
            type: { kind: "fn_type", params: [OPTION_INT_TYPE], effects: ["fails"], returnType: INT_TYPE },
            wasmImport: ["host", "unwrap"],
        },
    ],
    [
        "unwrapOr",
        {
            type: { kind: "fn_type", params: [OPTION_INT_TYPE, INT_TYPE], effects: ["pure"], returnType: INT_TYPE },
            wasmImport: ["host", "unwrapOr"],
        },
    ],
]);

/**
 * Check if a name refers to a built-in function.
 */
export function isBuiltin(name: string): boolean {
    return BUILTIN_FUNCTIONS.has(name);
}

/**
 * Get the built-in function definition, or undefined.
 */
export function getBuiltin(name: string): BuiltinFunction | undefined {
    return BUILTIN_FUNCTIONS.get(name);
}
