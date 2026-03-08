// =============================================================================
// Edict Public API
// =============================================================================

// Phase 1 — Validation
export { validate, validateFragmentAst } from "./validator/validate.js";
export type {
    ValidationResult,
    ValidationSuccess,
    ValidationFailure,
} from "./validator/validate.js";

// Phase 2 — Name Resolution
export { resolve } from "./resolver/resolve.js";
export { Scope } from "./resolver/scope.js";
export type { SymbolKind, SymbolInfo } from "./resolver/scope.js";
export { levenshteinDistance, findCandidates } from "./resolver/levenshtein.js";

// Phase 2 — Type Checking
export { typeCheck } from "./checker/check.js";
export type { TypedModuleInfo, TypeCheckResult } from "./checker/check.js";
export { TypeEnv } from "./checker/type-env.js";
export { typesEqual, isUnknown, resolveType } from "./checker/types-equal.js";

// Phase 3 — Effect Checking
export { effectCheck } from "./effects/effect-check.js";
export type { EffectCheckResult } from "./effects/effect-check.js";
export { buildCallGraph, collectCalls } from "./effects/call-graph.js";
export type { CallEdge, CallGraph } from "./effects/call-graph.js";

// Phase 4 — Contract Verification
export { contractVerify, clearVerificationCache } from "./contracts/verify.js";
export type { ContractVerifyResult } from "./contracts/verify.js";
export { getZ3, resetZ3 } from "./contracts/z3-context.js";
export { translateExpr, translateExprList, createParamVariables } from "./contracts/translate.js";
export type { TranslationContext, TranslationError } from "./contracts/translate.js";
export { computeVerificationHash } from "./contracts/hash.js";

// Pipeline
export { check } from "./check.js";
export type { CheckResult } from "./check.js";

// AST node types
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
} from "./ast/nodes.js";

// Type expressions
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

// Error types
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
    // Phase 4
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
} from "./errors/structured-errors.js";

// Error constructors (all phases)
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
    // Phase 4
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
} from "./errors/structured-errors.js";

// Phase 5 — Code generation
export { compile } from "./codegen/codegen.js";
export type {
    CompileResult,
    CompileSuccess,
    CompileFailure,
    CompileOptions,
} from "./codegen/codegen.js";
export { run, runDirect } from "./codegen/runner.js";
export type { RunResult, RunLimits } from "./codegen/runner.js";
export { compileAndRun } from "./compile.js";
export type {
    CompileAndRunResult,
    CompileAndRunSuccess,
    CompileAndRunFailure,
} from "./compile.js";
export { StringTable } from "./codegen/string-table.js";
export { BUILTIN_FUNCTIONS, isBuiltin, getBuiltin } from "./builtins/builtins.js";

// Host adapter system
export type { EdictHostAdapter } from "./codegen/host-adapter.js";
export { NodeHostAdapter } from "./codegen/node-host-adapter.js";
export { BrowserHostAdapter } from "./codegen/browser-host-adapter.js";
export { EdictOomError } from "./builtins/host-helpers.js";

// Error catalog
export { buildErrorCatalog } from "./errors/error-catalog.js";
export type { ErrorCatalog, ErrorCatalogEntry } from "./errors/error-catalog.js";

// Compact AST format
export { expandCompact, isCompactAst, compactSchemaReference } from "./compact/expand.js";

// Lint
export { lint } from "./lint/lint.js";
export type { LintWarning } from "./lint/lint.js";
export type {
    UnusedVariableWarning,
    UnusedImportWarning,
    MissingContractWarning,
    OversizedFunctionWarning,
    EmptyBodyWarning,
    RedundantEffectWarning,
} from "./lint/warnings.js";
export {
    unusedVariable,
    unusedImport,
    missingContract,
    oversizedFunction,
    emptyBody,
    redundantEffect,
} from "./lint/warnings.js";

// Patch engine
export { applyPatches } from "./patch/apply.js";
export type { AstPatch, PatchApplyResult } from "./patch/apply.js";

// Fragment composition
export { compose } from "./compose/compose.js";
export type { ComposeResult } from "./compose/compose.js";

