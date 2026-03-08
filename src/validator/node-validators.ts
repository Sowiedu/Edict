// =============================================================================
// Node Validators — Backward Compatibility Re-exports
// =============================================================================
// This file re-exports validation functions from the schema-driven walker.
// The original 1,580 lines of hand-written validators have been replaced by
// the schema walker in schema-walker.ts, which reads the generated JSON Schema
// at runtime to perform all structural validation automatically.

export {
    validateModule,
    validateFragment,
    validateExpression,
    validateTypeExpr,
} from "./schema-walker.js";
