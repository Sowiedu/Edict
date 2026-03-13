/**
 * @module edict-lang
 *
 * Edict Public API — the complete compiler pipeline and supporting utilities.
 *
 * Pipeline phases (in order):
 * 1. **Validation** — structural AST validation (`validate`)
 * 2. **Resolution** — name resolution with did-you-mean suggestions (`resolve`)
 * 3. **Type Checking** — bidirectional type inference (`typeCheck`)
 * 4. **Effect Checking** — call-graph-based effect propagation (`effectCheck`)
 * 5. **Contract Verification** — Z3 SMT proving of pre/post contracts (`contractVerify`)
 * 6. **Code Generation** — WASM compilation via binaryen (`compile`)
 * 7. **Execution** — WASM instantiation and execution (`run`, `runDirect`)
 *
 * Convenience wrappers: `check` (phases 1–5), `compileAndRun` (phases 1–7).
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
// Phase 3 — Effect Checking: call-graph effect propagation
// ---------------------------------------------------------------------------
export { effectCheck } from "./effects/effect-check.js";
export type { EffectCheckResult } from "./effects/effect-check.js";
export { buildCallGraph, collectCalls } from "./effects/call-graph.js";
export type { CallEdge, CallGraph, EffectSource } from "./effects/call-graph.js";

// ---------------------------------------------------------------------------
// Phase 4 — Contract Verification: Z3 SMT proving of pre/post contracts
// ---------------------------------------------------------------------------
export { contractVerify, clearVerificationCache, type ContractVerifyOptions } from "./contracts/verify.js";
export type { ContractVerifyResult } from "./contracts/verify.js";
export { getZ3, resetZ3 } from "./contracts/z3-context.js";
export { translateExpr, translateExprList, createParamVariables } from "./contracts/translate.js";
export type { TranslationContext, TranslationError } from "./contracts/translate.js";
export { computeVerificationHash } from "./contracts/hash.js";

// ---------------------------------------------------------------------------
// IR Lowering: AST + TypedModuleInfo → mid-level IR
// ---------------------------------------------------------------------------
export { lowerModule } from "./ir/lower.js";
export { optimize } from "./ir/optimize.js";

// ---------------------------------------------------------------------------
// Deploy: Worker scaffold generation for edge runtimes
// ---------------------------------------------------------------------------
export { generateWorkerScaffold, getHostBuiltinNames } from "./deploy/scaffold.js";
export type { WorkerConfig, WorkerBundle, WorkerBundleFile, ScaffoldResult } from "./deploy/scaffold.js";

// ---------------------------------------------------------------------------
// Full Pipeline: validate → resolve → typeCheck → effectCheck → contractVerify
// ---------------------------------------------------------------------------
export { check } from "./check.js";
export type { CheckResult } from "./check.js";

// ---------------------------------------------------------------------------
// Browser Pipeline: validate → resolve → typeCheck → effectCheck (no contracts)
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
    ConcreteEffect,
    EffectVariable,
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
export { VALID_APPROVAL_SCOPES, isConcreteEffect, isEffectVariable } from "./ast/nodes.js";

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
// Phase 5 — Code Generation: WASM compilation via binaryen
// ---------------------------------------------------------------------------
export { compile } from "./codegen/codegen.js";
export type {
    CompileResult,
    CompileSuccess,
    CompileFailure,
    CompileOptions,
} from "./codegen/codegen.js";
export { run, runDirect } from "./codegen/runner.js";
export type { RunResult, RunLimits } from "./codegen/runner.js";
export type { ReplayToken, ReplayEntry } from "./codegen/replay-types.js";
export { createRecordingAdapter } from "./codegen/recording-adapter.js";
export { createReplayAdapter, ReplayExhaustedError } from "./codegen/replay-adapter.js";
export { compileAndRun } from "./compile.js";
export type {
    CompileAndRunResult,
    CompileAndRunSuccess,
    CompileAndRunFailure,
} from "./compile.js";
export { StringTable } from "./codegen/string-table.js";
export { BUILTIN_FUNCTIONS, isBuiltin, getBuiltin } from "./builtins/builtins.js";

// ---------------------------------------------------------------------------
// Host Adapters: platform-specific I/O implementations (Node, Browser, Cloudflare)
// ---------------------------------------------------------------------------
export type { EdictHostAdapter } from "./codegen/host-adapter.js";
export { NodeHostAdapter } from "./codegen/node-host-adapter.js";
export { BrowserHostAdapter } from "./codegen/browser-host-adapter.js";
export { CloudflareHostAdapter } from "./codegen/cloudflare-host-adapter.js";
export type { CloudflareHostAdapterOptions } from "./codegen/cloudflare-host-adapter.js";
export { EdictOomError } from "./builtins/host-helpers.js";

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
// Compact AST Format: token-efficient abbreviated AST representation
// ---------------------------------------------------------------------------
export { expandCompact, isCompactAst, compactSchemaReference, KIND_SYNONYMS } from "./compact/expand.js";

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
// Multi-Module Compilation: cross-module resolution and linking
// ---------------------------------------------------------------------------
export { checkMultiModule } from "./multi-module.js";
export type { MultiModuleCheckResult } from "./multi-module.js";

// ---------------------------------------------------------------------------
// Incremental Checking: re-verify only changed definitions
// ---------------------------------------------------------------------------
export { incrementalCheck } from "./incremental/check.js";
export type { IncrementalCheckResult } from "./incremental/check.js";
export { buildDepGraph, transitiveDependents } from "./incremental/dep-graph.js";
export type { DepGraph } from "./incremental/dep-graph.js";
export { diffDefinitions } from "./incremental/diff.js";

// ---------------------------------------------------------------------------
// Test-Contract Bridge: auto-generate tests from Z3-verified contracts
// ---------------------------------------------------------------------------
export { generateTests } from "./contracts/generate-tests.js";
export type { GeneratedTest, GenerateTestsResult } from "./contracts/generate-tests.js";

// ---------------------------------------------------------------------------
// Schema Migration: auto-migrate ASTs from older schema versions
// ---------------------------------------------------------------------------
export { migrateToLatest, applyMigration, CURRENT_SCHEMA_VERSION, MINIMUM_SCHEMA_VERSION, MIGRATION_REGISTRY } from "./migration/migrate.js";
export type { Migration, MigrationOp, MigrationResult, MigrationSuccess, MigrationFailure } from "./migration/migrate.js";

// ---------------------------------------------------------------------------
// Skills: portable skill packaging and invocation
// ---------------------------------------------------------------------------
export { packageSkill, typeToString } from "./skills/package.js";
export { invokeSkill } from "./skills/invoke.js";
export type {
    SkillPackage,
    SkillMetadata,
    PackageSkillInput,
    PackageSkillResult,
    PackageSkillSuccess,
    PackageSkillFailure,
    InvokeSkillResult,
} from "./skills/types.js";

// ---------------------------------------------------------------------------
// Mid-Level IR: codegen-friendly representation between AST and WASM
// ---------------------------------------------------------------------------
export { countIRNodes, irExprKindLabel } from "./ir/types.js";
export type {
    IRModule,
    IRImport,
    IRFunction,
    IRParam,
    IRClosureVar,
    IRConstant,
    IRRecordDef,
    IRFieldDef,
    IREnumDef,
    IRVariantDef,
    IRExpr,
    IRLiteral,
    IRIdent,
    IRIdentScope,
    IRBinop,
    IRUnop,
    IRCall,
    IRCallKind,
    IRIf,
    IRLet,
    IRBlock,
    IRMatch,
    IRMatchArm,
    IRArray,
    IRTuple,
    IRRecordExpr,
    IREnumConstructor,
    IRFieldInit,
    IRAccess,
    IRLambdaRef,
    IRStringInterp,
    IRStringInterpPart,
} from "./ir/types.js";

// ---------------------------------------------------------------------------
// IR Codegen: compile IR expressions → WASM (parallel path to AST codegen)
// ---------------------------------------------------------------------------
export { compileIRExpr, irExprWasmType } from "./codegen/compile-ir-expr.js";
