// =============================================================================
// Shared Type Constants — Singleton TypeExpr instances
// =============================================================================
// Avoids duplicating the same type constant objects across modules.
// Import these instead of defining local copies.

import type { TypeExpr } from "./types.js";

export const INT_TYPE: TypeExpr = { kind: "basic", name: "Int" };
export const INT64_TYPE: TypeExpr = { kind: "basic", name: "Int64" };
export const FLOAT_TYPE: TypeExpr = { kind: "basic", name: "Float" };
export const STRING_TYPE: TypeExpr = { kind: "basic", name: "String" };
export const BOOL_TYPE: TypeExpr = { kind: "basic", name: "Bool" };
export const UNKNOWN_TYPE: TypeExpr = { kind: "named", name: "unknown" };
export const ARRAY_INT_TYPE: TypeExpr = { kind: "array", element: INT_TYPE };
export const OPTION_INT_TYPE: TypeExpr = { kind: "option", inner: INT_TYPE };
export const RESULT_INT_TYPE: TypeExpr = { kind: "result", ok: INT_TYPE, err: INT_TYPE };
export const RESULT_STRING_TYPE: TypeExpr = { kind: "result", ok: STRING_TYPE, err: STRING_TYPE };
