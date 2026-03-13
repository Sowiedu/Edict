/**
 * @module edict-lang/browser
 *
 * Edict Browser API — the Node-free subset of the compiler pipeline.
 *
 * This entry point exports everything that runs without Node.js APIs.
 * It includes phases 1–3 (validate, resolve, typeCheck, effectCheck),
 * plus lint, patch, compose, compact expansion, migration, and error utilities.
 *
 * Excluded (require Node.js):
 * - Phase 4: Contract verification (Z3, worker threads)
 * - Phase 5–6: WASM compilation and execution (binaryen, worker threads)
 * - MCP server (filesystem, crypto)
 * - Incremental checking (crypto for hashing)
 *
 * Convenience wrapper: `checkBrowser` (phases 1–3 without contract verification).
 */

// ---------------------------------------------------------------------------
// Phase 1 — Validation: structural AST schema checking
// ---------------------------------------------------------------------------
export { validate, validateFragmentAst } from "./validator/validate.js";
export type {
    ValidationResult,
    ValidationSuccess,
    ValidationFailure,
} from "./validator/validate.js";

// ---------------------------------------------------------------------------
// Phase 2a — Name Resolution: identifier binding with Levenshtein suggestions
// ---------------------------------------------------------------------------
export { resolve } from "./resolver/resolve.js";
export { Scope } from "./resolver/scope.js";
export type { SymbolKind, SymbolInfo } from "./resolver/scope.js";
export { levenshteinDistance, findCandidates } from "./resolver/levenshtein.js";

// ---------------------------------------------------------------------------
// Phase 2b — Type Checking: bidirectional type inference
// ---------------------------------------------------------------------------
export { typeCheck } from "./checker/check.js";
export type { TypedModuleInfo, TypeCheckResult } from "./checker/check.js";
export { TypeEnv } from "./checker/type-env.js";
export { typesEqual, isUnknown, resolveType } from "./checker/types-equal.js";

// ---------------------------------------------------------------------------
// Phase 2c — Complexity Checking: AST size and depth limits
// ---------------------------------------------------------------------------
export { complexityCheck } from "./checker/complexity.js";

// ---------------------------------------------------------------------------
// Phase 3 — Effect Checking: call-graph effect propagation
// ---------------------------------------------------------------------------
export { effectCheck } from "./effects/effect-check.js";
export type { EffectCheckResult } from "./effects/effect-check.js";
export { buildCallGraph, collectCalls } from "./effects/call-graph.js";
export type { CallEdge, CallGraph, EffectSource } from "./effects/call-graph.js";

// ---------------------------------------------------------------------------
// Browser Pipeline — validate → resolve → typeCheck → effectCheck (no contracts)
// ---------------------------------------------------------------------------
export { checkBrowser } from "./check-browser.js";
export type { CheckBrowserResult } from "./check-browser.js";

// ---------------------------------------------------------------------------
// AST Node Types: all expression, definition, and pattern types
// ---------------------------------------------------------------------------
export type {
    EdictModule,
    EdictFragment,
    Import,
    Definition,
    FunctionDef,
    TypeDef,
    RecordDef,
    EnumDef,
    ConstDef,
    RecordField,
    EnumVariant,
    Param,
    Contract,
    Effect,
    Expression,
    Literal,
    Identifier,
    BinaryOp,
    BinaryOperator,
    UnaryOp,
    UnaryOperator,
    Call,
    IfExpr,
    LetExpr,
    MatchExpr,
    MatchArm,
    Pattern,
    LiteralPattern,
    WildcardPattern,
    BindingPattern,
    ConstructorPattern,
    ArrayExpr,
    TupleExpr,
    RecordExpr,
    EnumConstructor,
    FieldAccess,
    LambdaExpr,
    BlockExpr,
    FieldInit,
    StringInterp,
    IntentDeclaration,
    IntentInvariant,
    ExpressionInvariant,
    SemanticInvariant,
    ApprovalGate,
    ApprovalScope,
    ToolDef,
    ToolCallExpr,
    RetryPolicy,
    BackoffKind,
} from "./ast/nodes.js";
export { VALID_APPROVAL_SCOPES } from "./ast/nodes.js";

// ---------------------------------------------------------------------------
// Type Expressions: all type annotation node types
// ---------------------------------------------------------------------------
export type {
    TypeExpr,
    BasicType,
    ArrayType,
    OptionType,
    ResultType,
    UnitType,
    RefinedType,
    FunctionType,
    NamedType,
    TupleType,
} from "./ast/types.js";

// ---------------------------------------------------------------------------
// Error Types: structured error interfaces for all pipeline phases
// ---------------------------------------------------------------------------
export type {
    StructuredError,
    DuplicateIdError,
    UnknownNodeKindError,
    MissingFieldError,
    InvalidFieldTypeError,
    InvalidEffectError,
    InvalidOperatorError,
    InvalidBasicTypeName,
    ConflictingEffectsError,
    // Phase 2
    UndefinedReferenceError,
    DuplicateDefinitionError,
    UnknownRecordError,
    UnknownEnumError,
    UnknownVariantError,
    TypeMismatchError,
    UnitMismatchError,
    ArityMismatchError,
    NotAFunctionError,
    UnknownFieldError,
    MissingRecordFieldsError,
    // Phase 3
    EffectViolationError,
    EffectInPureError,
    // Phase 4 (types only — still useful for consumers even without contract verification)
    ContractFailureError,
    VerificationTimeoutError,
    UndecidablePredicateError,
    PreconditionNotMetError,
    // Patch errors
    PatchNodeNotFoundError,
    PatchInvalidFieldError,
    PatchIndexOutOfRangeError,
    PatchDeleteNotInArrayError,
    // Analysis diagnostics
    AnalysisDiagnostic,
    AnalysisDiagnosticKind,
    VerificationCoverage,
    // Composition errors
    UnsatisfiedRequirementError,
    DuplicateProvisionError,
    // Multi-module errors
    CircularImportError,
    UnresolvedModuleError,
    DuplicateModuleNameError,
    // Migration errors
    MigrationFailedError,
    UnsupportedSchemaVersionError,
    // Approval errors
    ApprovalPropagationMissingError,
    // Tool errors
    UnknownToolError,
    ToolArgMismatchError,
} from "./errors/structured-errors.js";

// ---------------------------------------------------------------------------
// Error Constructors: factory functions for all structured error types
// ---------------------------------------------------------------------------
export {
    // Phase 1
    duplicateId,
    unknownNodeKind,
    missingField,
    invalidFieldType,
    invalidEffect,
    invalidOperator,
    invalidBasicTypeName,
    conflictingEffects,
    // Phase 2
    undefinedReference,
    duplicateDefinition,
    unknownRecord,
    unknownEnum,
    unknownVariant,
    typeMismatch,
    unitMismatch,
    arityMismatch,
    notAFunction,
    unknownField,
    missingRecordFields,
    // Phase 3
    effectViolation,
    effectInPure,
    // Phase 4 (constructors — useful for test fixtures even without Z3)
    contractFailure,
    verificationTimeout,
    undecidablePredicate,
    preconditionNotMet,
    // Patch errors
    patchNodeNotFound,
    patchInvalidField,
    patchIndexOutOfRange,
    patchDeleteNotInArray,
    // Analysis diagnostics
    analysisDiagnostic,
    // Composition errors
    unsatisfiedRequirement,
    duplicateProvision,
    // Multi-module errors
    circularImport,
    unresolvedModule,
    duplicateModuleName,
    // Migration errors
    migrationFailed,
    unsupportedSchemaVersion,
    // Approval errors
    approvalPropagationMissing,
    // Tool errors
    unknownTool,
    toolArgMismatch,
} from "./errors/structured-errors.js";

// ---------------------------------------------------------------------------
// Error Catalog: machine-readable registry of all error types with examples
// ---------------------------------------------------------------------------
export { buildErrorCatalog } from "./errors/error-catalog.js";
export type { ErrorCatalog, ErrorCatalogEntry } from "./errors/error-catalog.js";

// ---------------------------------------------------------------------------
// Error Explain: structured repair context from error catalog
// ---------------------------------------------------------------------------
export { explainError } from "./errors/explain.js";
export type { ExplainResult, ExplainResultFound, ExplainResultNotFound, RepairAction } from "./errors/explain.js";

// ---------------------------------------------------------------------------
// Lint: non-blocking code quality warnings
// ---------------------------------------------------------------------------
export { lint } from "./lint/lint.js";
export type { LintWarning } from "./lint/lint.js";
export type {
    UnusedVariableWarning,
    UnusedImportWarning,
    MissingContractWarning,
    OversizedFunctionWarning,
    EmptyBodyWarning,
    RedundantEffectWarning,
    IntentUnverifiedInvariantWarning,
    ApprovalMissingOnIoWarning,
    ToolCallNoRetryWarning,
    ToolCallNoTimeoutWarning,
} from "./lint/warnings.js";
export {
    unusedVariable,
    unusedImport,
    missingContract,
    oversizedFunction,
    emptyBody,
    redundantEffect,
    intentUnverifiedInvariant,
    approvalMissingOnIo,
    toolCallNoRetry,
    toolCallNoTimeout,
} from "./lint/warnings.js";

// ---------------------------------------------------------------------------
// Patch Engine: surgical AST modifications by nodeId
// ---------------------------------------------------------------------------
export { applyPatches } from "./patch/apply.js";
export type { AstPatch, PatchApplyResult } from "./patch/apply.js";

// ---------------------------------------------------------------------------
// Fragment Composition: merge fragments into a single module
// ---------------------------------------------------------------------------
export { compose } from "./compose/compose.js";
export type { ComposeResult } from "./compose/compose.js";

// ---------------------------------------------------------------------------
// Compact AST Format: token-efficient abbreviated AST representation
// ---------------------------------------------------------------------------
export { expandCompact, isCompactAst, compactSchemaReference, KIND_SYNONYMS } from "./compact/expand.js";

// ---------------------------------------------------------------------------
// Schema Migration: auto-migrate ASTs from older schema versions
// ---------------------------------------------------------------------------
export { migrateToLatest, applyMigration, CURRENT_SCHEMA_VERSION, MINIMUM_SCHEMA_VERSION, MIGRATION_REGISTRY } from "./migration/migrate.js";
export type { Migration, MigrationOp, MigrationResult, MigrationSuccess, MigrationFailure } from "./migration/migrate.js";

// ---------------------------------------------------------------------------
// Builtins: type metadata (Node-free — imports from builtin-meta, not registry)
// ---------------------------------------------------------------------------
export { BUILTIN_FUNCTIONS, isBuiltin, getBuiltin } from "./builtins/builtin-meta.js";
export type { BuiltinFunction } from "./builtins/builtin-meta.js";

// ---------------------------------------------------------------------------
// Host Adapter: browser-compatible platform adapter (Node-free)
// ---------------------------------------------------------------------------
export { BrowserHostAdapter } from "./codegen/browser-host-adapter.js";
export type { BrowserHostAdapterOptions } from "./codegen/browser-host-adapter.js";
export type { EdictHostAdapter } from "./codegen/host-adapter.js";

