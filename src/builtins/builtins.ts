// Re-export from canonical metadata module for backwards compatibility.
// This file is imported by resolver, checker, and effects — it must NOT
// transitively import Node-specific modules (node:crypto, binaryen, etc).
export { BUILTIN_FUNCTIONS, isBuiltin, getBuiltin } from "./builtin-meta.js";
export type { BuiltinFunction } from "./builtin-meta.js";
