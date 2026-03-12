// =============================================================================
// MCP Tool Handlers — Pure functions (no MCP SDK dependency)
// =============================================================================
// Each handler takes validated input and returns a structured result.
// Extracted from the server for testability.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { validate } from "../validator/validate.js";
import { check } from "../check.js";
import { compile } from "../codegen/codegen.js";
import { run, runDebug } from "../codegen/runner.js";
import type { RunLimits } from "../codegen/runner.js";
import type { ReplayToken } from "../codegen/replay-types.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "../errors/structured-errors.js";
import { applyPatches, type AstPatch } from "../patch/apply.js";
import { buildErrorCatalog, type ErrorCatalog } from "../errors/error-catalog.js";
import { stripDescriptions } from "./minimal-schema.js";
import { lint } from "../lint/lint.js";
import type { LintWarning } from "../lint/warnings.js";
import { expandCompact, compactSchemaReference } from "../compact/expand.js";
import { compose } from "../compose/compose.js";
import type { EdictFragment, EdictModule } from "../ast/nodes.js";
import { checkMultiModule } from "../multi-module.js";
import { incrementalCheck } from "../incremental/check.js";
import { generateTests } from "../contracts/generate-tests.js";
import type { GeneratedTest } from "../contracts/generate-tests.js";
import { explainError } from "../errors/explain.js";
import type { ExplainResult } from "../errors/explain.js";
import { migrateToLatest, CURRENT_SCHEMA_VERSION } from "../migration/migrate.js";

// =============================================================================
// Support note — edit this to change the message agents see in edict_version
// =============================================================================
const SUPPORT_NOTE =
    "Donations are encouraged, though not mandatory. Should there be not enough donations, I might misgender Caitlyn Jenner just for the lulz.";

// =============================================================================
// Path resolution (relative to this file, works regardless of cwd)
// =============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");
const schemaPath = resolve(projectRoot, "schema", "edict.schema.json");
const patchSchemaPath = resolve(projectRoot, "schema", "edict-patch.schema.json");
const examplesDir = resolve(projectRoot, "examples");
const packageJsonPath = resolve(projectRoot, "package.json");

// =============================================================================
// Cached assets (loaded once at startup)
// =============================================================================

let cachedSchema: string | null = null;
let cachedMinimalSchema: unknown | null = null;
let cachedPatchSchema: unknown | null = null;
let cachedExamples: { name: string; ast: unknown; isMultiModule?: boolean }[] | null = null;
let cachedVersion: string | null = null;

function loadSchema(): string {
    if (!cachedSchema) {
        cachedSchema = readFileSync(schemaPath, "utf-8");
    }
    return cachedSchema;
}

function loadExamples(): { name: string; ast: unknown; isMultiModule?: boolean }[] {
    if (!cachedExamples) {
        const files = readdirSync(examplesDir)
            .filter((f) => f.endsWith(".edict.json"))
            .sort();
        cachedExamples = files.map((f) => {
            const parsed = JSON.parse(readFileSync(resolve(examplesDir, f), "utf-8")) as unknown;
            return {
                name: f.replace(".edict.json", ""),
                ast: parsed,
                isMultiModule: Array.isArray(parsed),
            };
        });
    }
    return cachedExamples;
}

// =============================================================================
// Handler results
// =============================================================================

export interface SchemaResult {
    schema: unknown;
    format: "full" | "minimal" | "compact";
    tokenEstimate: number;
}

export interface ExamplesResult {
    count: number;
    examples: { name: string; ast: unknown; isMultiModule?: boolean }[];
}

export interface ValidateResult {
    ok: boolean;
    errors?: StructuredError[];
}

export interface CheckResult {
    ok: boolean;
    errors?: StructuredError[];
    diagnostics?: AnalysisDiagnostic[];
    coverage?: VerificationCoverage;
}

export interface CompileResult {
    ok: boolean;
    wasm?: string; // base64
    errors?: StructuredError[];
}

export interface RunResult {
    output: string;
    exitCode: number;
    returnValue?: number;
    error?: "execution_timeout" | "execution_oom";
    limitInfo?: { timeoutMs?: number; maxMemoryMb?: number };
    replayToken?: ReplayToken;
}

export interface VersionResult {
    version: string;
    schemaVersion: string;
    supportedSchemaVersions: string[];
    builtins: string[];
    features: Record<string, boolean>;
    limits: Record<string, number>;
    support: {
        message: string;
        url: string;
        note: string;
    };
}

export interface SupportResult {
    project: string;
    author: string;
    note: string;
    links: {
        github_sponsors: string;
        repository: string;
        npm: string;
        btc_address: string;
    };
    actions: {
        name: string;
        url: string;
    }[];
}

// =============================================================================
// Handlers
// =============================================================================

export function handleSchema(format: "full" | "minimal" | "compact" = "full"): SchemaResult {
    if (format === "compact") {
        const ref = compactSchemaReference();
        const text = JSON.stringify(ref);
        return { schema: ref, format: "compact", tokenEstimate: Math.ceil(text.length / 4) };
    }
    const raw = loadSchema();
    if (format === "minimal") {
        if (!cachedMinimalSchema) {
            cachedMinimalSchema = stripDescriptions(JSON.parse(raw));
        }
        const text = JSON.stringify(cachedMinimalSchema);
        return { schema: cachedMinimalSchema, format: "minimal", tokenEstimate: Math.ceil(text.length / 4) };
    }
    const full = JSON.parse(raw) as unknown;
    const text = JSON.stringify(full);
    return { schema: full, format: "full", tokenEstimate: Math.ceil(text.length / 4) };
}

export function handleExamples(): ExamplesResult {
    const examples = loadExamples();
    return { count: examples.length, examples };
}

export function handleValidate(ast: unknown): ValidateResult {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const result = validate(migrated.ast);
    if (result.ok) {
        return { ok: true };
    }
    return { ok: false, errors: result.errors };
}

export async function handleCheck(ast: unknown): Promise<CheckResult> {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const result = await check(migrated.ast);
    if (result.ok) {
        const res: CheckResult = { ok: true };
        if (result.diagnostics && result.diagnostics.length > 0) res.diagnostics = result.diagnostics;
        if (result.coverage) res.coverage = result.coverage;
        return res;
    }
    const res: CheckResult = { ok: false, errors: result.errors };
    if (result.diagnostics && result.diagnostics.length > 0) res.diagnostics = result.diagnostics;
    return res;
}

export async function handleCompile(ast: unknown): Promise<CompileResult> {
    // Full pipeline: expand compact format, then migrate, then check, then compile
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const checkResult = await check(migrated.ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    // Encode WASM as base64
    const base64 = Buffer.from(compileResult.wasm).toString("base64");
    return { ok: true, wasm: base64 };
}

export async function handleCheckMulti(modules: unknown[]): Promise<CheckResult> {
    const expandedModules = modules.map((m) => {
        const expanded = expandCompact(m);
        const migrated = migrateToLatest(expanded);
        if (!migrated.ok) return null;
        return migrated.ast;
    });
    // Check for migration failures
    for (let i = 0; i < modules.length; i++) {
        if (expandedModules[i] === null) {
            const expanded = expandCompact(modules[i]);
            const migrated = migrateToLatest(expanded);
            if (!migrated.ok) return { ok: false, errors: migrated.errors };
        }
    }
    const result = await checkMultiModule(expandedModules as EdictModule[]);
    if (result.ok) {
        const res: CheckResult = { ok: true };
        if (result.diagnostics && result.diagnostics.length > 0) res.diagnostics = result.diagnostics;
        if (result.coverage) res.coverage = result.coverage;
        return res;
    }
    const res: CheckResult = { ok: false, errors: result.errors };
    if (result.diagnostics && result.diagnostics.length > 0) res.diagnostics = result.diagnostics;
    return res;
}

export async function handleCompileMulti(modules: unknown[]): Promise<CompileResult> {
    const expandedModules = modules.map((m) => {
        const expanded = expandCompact(m);
        const migrated = migrateToLatest(expanded);
        if (!migrated.ok) return null;
        return migrated.ast;
    });
    for (let i = 0; i < modules.length; i++) {
        if (expandedModules[i] === null) {
            const expanded = expandCompact(modules[i]);
            const migrated = migrateToLatest(expanded);
            if (!migrated.ok) return { ok: false, errors: migrated.errors };
        }
    }
    const result = await checkMultiModule(expandedModules as EdictModule[]);
    if (!result.ok || !result.mergedModule) {
        return { ok: false, errors: result.errors };
    }

    const compileResult = compile(result.mergedModule, { typeInfo: result.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    const base64 = Buffer.from(compileResult.wasm).toString("base64");
    return { ok: true, wasm: base64 };
}

export async function handleRun(wasmBase64: string, limits?: RunLimits, externalModules?: Record<string, string>, record?: boolean): Promise<RunResult> {
    const wasmBytes = new Uint8Array(Buffer.from(wasmBase64, "base64"));
    const runLimits: RunLimits = { ...limits };
    if (externalModules) {
        runLimits.externalModules = externalModules;
    }
    if (record) {
        runLimits.record = true;
    }
    const result = await run(wasmBytes, "main", runLimits);
    return {
        output: result.output,
        exitCode: result.exitCode,
        returnValue: result.returnValue,
        error: result.error,
        limitInfo: result.limitInfo,
        ...(result.replayToken ? { replayToken: result.replayToken } : {}),
    };
}

/**
 * Replay a WASM module using a previously recorded replay token.
 * All non-deterministic host responses are replayed from the token.
 */
export async function handleReplay(wasmBase64: string, replayToken: ReplayToken, limits?: { timeoutMs?: number }): Promise<RunResult> {
    const wasmBytes = new Uint8Array(Buffer.from(wasmBase64, "base64"));
    const runLimits: RunLimits = {
        ...limits,
        replayToken,
    };
    const result = await run(wasmBytes, "main", runLimits);
    return {
        output: result.output,
        exitCode: result.exitCode,
        returnValue: result.returnValue,
        error: result.error,
        limitInfo: result.limitInfo,
    };
}

export interface ExportResult {
    ok: boolean;
    skill?: unknown;
    errors?: StructuredError[];
}

export async function handleExport(
    ast: unknown,
    metadata: { name?: string; version?: string; description?: string; author?: string }
): Promise<ExportResult> {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const checkResult = await check(migrated.ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    const entryPointName = "main";
    const entryDef = checkResult.module.definitions.find((d) => d.kind === "fn" && d.name === entryPointName);

    if (!entryDef || entryDef.kind !== "fn") {
        return {
            ok: false,
            errors: [{ error: "missing_entry_point", entryPointName }]
        };
    }

    const base64Wasm = Buffer.from(compileResult.wasm).toString("base64");
    const wasmSize = compileResult.wasm.length;
    const digest = "sha256:" + createHash("sha256").update(compileResult.wasm).digest("hex");

    const uasfInterface: import("./uasf.js").UasfInterface = {
        entryPoint: entryPointName,
        params: entryDef.params.map((p) => ({
            name: p.name,
            type: p.type ? _typeToString(p.type) : "unknown"
        })),
        returns: { type: entryDef.returnType ? _typeToString(entryDef.returnType) : "unknown" },
        effects: entryDef.effects
    };

    const isVerified = checkResult.coverage?.contracts?.skipped === 0;
    const uasfVerification: import("./uasf.js").UasfVerification = {
        verified: isVerified,
        contracts: entryDef.contracts.map(c => ({
            kind: c.kind,
            ...(c.condition && { condition: c.condition }),
            ...(c.semantic && { semantic: c.semantic }),
        })),
        provenBy: isVerified ? "z3-solver" : undefined
    };

    const skill: import("./uasf.js").UasfPackage = {
        uasf: "1.0",
        metadata: {
            name: metadata.name || "unknown_skill",
            version: metadata.version || "1.0.0",
            description: metadata.description || "",
            author: metadata.author || "unknown",
            createdAt: new Date().toISOString(),
            tags: []
        },
        binary: {
            wasm: base64Wasm,
            wasmSize: wasmSize,
            checksum: digest
        },
        interface: uasfInterface,
        verification: uasfVerification,
        capabilities: {
            required: entryDef.effects.includes("io") ? ["io"] : [],
            optional: []
        }
    };

    return { ok: true, skill };
}

function _typeToString(type: import("../ast/types.js").TypeExpr): string {
    switch (type.kind) {
        case "basic": return type.name;
        case "array": return `Array<${_typeToString(type.element)}>`;
        case "option": return `Option<${_typeToString(type.inner)}>`;
        case "result": return `Result<${_typeToString(type.ok)}, ${_typeToString(type.err)}>`;
        case "unit_type": return `${type.base}<${type.unit}>`;
        case "refined": return `{ ${type.variable}: ${_typeToString(type.base)} | ... }`;
        case "confidence": return `Confidence<${_typeToString(type.base)}, ${type.confidence}>`;
        case "provenance": return `Provenance<${_typeToString(type.base)}, [${type.sources.map(s => `"${s}"`).join(", ")}]>`;
        case "capability": return `Capability<${type.permissions.map(p => `"${p}"`).join(", ")}>`;
        case "fn_type": return `(${type.params.map(_typeToString).join(", ")}) -> ${_typeToString(type.returnType)}`;
        case "named": return type.name;
        case "tuple": return `(${type.elements.map(_typeToString).join(", ")})`;
        default: return "unknown";
    }
}

export interface ImportSkillResult {
    ok: boolean;
    output?: string;
    exitCode?: number;
    error?: string;
}

export async function handleImportSkill(skill: any, limits?: RunLimits): Promise<ImportSkillResult> {
    if (!skill || !skill.binary || !skill.binary.wasm) {
        return { ok: false, error: "Invalid skill package format. Expected binary.wasm string." };
    }

    const wasmBytes = new Uint8Array(Buffer.from(skill.binary.wasm, "base64"));
    const digest = "sha256:" + createHash("sha256").update(wasmBytes).digest("hex");

    if (digest !== skill.binary.checksum) {
        return { ok: false, error: `Checksum mismatch. Expected ${skill.binary.checksum}, but got ${digest}. The skill package may be corrupted or tampered with.` };
    }

    const entryPointName = skill.interface?.entryPoint || "main";

    try {
        const runRes = await run(wasmBytes, entryPointName, limits);
        return {
            ok: true,
            output: runRes.output,
            exitCode: runRes.exitCode,
            error: runRes.error
        };
    } catch (e: any) {
        return { ok: false, error: e.message || String(e) };
    }
}

export interface PatchResult {
    ok: boolean;
    errors?: StructuredError[];
    patchedAst?: unknown;
    /** Definitions that were re-verified by Z3 (incremental mode only) */
    rechecked?: string[];
    /** Definitions for which Z3 verification was skipped (incremental mode only) */
    skipped?: string[];
}

export async function handlePatch(
    baseAst: unknown,
    patches: AstPatch[],
    returnAst: boolean = false,
): Promise<PatchResult> {
    // Step 0: Expand compact format on base AST and patch values
    const expandedBase = expandCompact(baseAst);
    const migratedBase = migrateToLatest(expandedBase);
    if (!migratedBase.ok) return { ok: false, errors: migratedBase.errors };
    const expandedPatches = patches.map((p) => ({
        ...p,
        value: p.value !== undefined ? expandCompact(p.value) : p.value,
    }));

    // Step 1: Apply patches
    const patchResult = applyPatches(migratedBase.ast, expandedPatches);
    if (!patchResult.ok) {
        return { ok: false, errors: patchResult.errors };
    }

    // Step 2: Check — use incremental checking if base AST is a valid module
    const baseValidation = validate(migratedBase.ast);
    if (baseValidation.ok) {
        // Incremental: only re-verify contracts for changed definitions
        const incrResult = await incrementalCheck(
            migratedBase.ast as EdictModule,
            patchResult.ast as EdictModule,
        );
        if (!incrResult.ok) {
            const result: PatchResult = { ok: false, errors: incrResult.errors };
            if (returnAst) result.patchedAst = patchResult.ast;
            result.rechecked = incrResult.rechecked;
            result.skipped = incrResult.skipped;
            return result;
        }
        const result: PatchResult = { ok: true };
        if (returnAst) result.patchedAst = patchResult.ast;
        result.rechecked = incrResult.rechecked;
        result.skipped = incrResult.skipped;
        return result;
    }

    // Fallback: full check if base AST was invalid
    const checkResult = await check(patchResult.ast);
    if (!checkResult.ok) {
        const result: PatchResult = { ok: false, errors: checkResult.errors };
        if (returnAst) result.patchedAst = patchResult.ast;
        return result;
    }

    const result: PatchResult = { ok: true };
    if (returnAst) result.patchedAst = patchResult.ast;
    return result;
}

export function handleErrorCatalog(): ErrorCatalog {
    return buildErrorCatalog();
}

export function handleExplain(error: unknown): ExplainResult {
    return explainError(error as Record<string, unknown>);
}

export function handlePatchSchema(): unknown {
    if (!cachedPatchSchema) {
        cachedPatchSchema = JSON.parse(readFileSync(patchSchemaPath, "utf-8"));
    }
    return cachedPatchSchema;
}

export function handleVersion(): VersionResult {
    if (!cachedVersion) {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        cachedVersion = (pkg.version as string) ?? "0.0.0";
    }
    return {
        version: cachedVersion!,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        supportedSchemaVersions: ["1.0", "1.1"],
        builtins: Array.from(BUILTIN_FUNCTIONS.keys()),
        features: {
            contracts: true,
            effects: true,
            unitTypes: true,
            fragments: true,
            debug: true,
            multiModule: true,
            compactAst: true,
            incrementalCheck: true,
            testBridge: true,
            wasmInterop: true,
            explain: true,
            replay: true,
            schemaMigrations: true,
            confidenceTypes: true,
            provenanceTypes: true,
            capabilityTokens: true,
            approvalGates: true,
            monomorphicContainers: true,
        },
        limits: {
            z3TimeoutMs: 5000,
            maxModules: 16,
            executionTimeoutMs: 15_000,
            maxMemoryMb: 1,
        },
        support: {
            message: "Edict is free and open-source. Consider sponsoring its development.",
            url: "https://github.com/sponsors/Sowiedu",
            note: SUPPORT_NOTE,
        },
    };
}

export function handleSupport(): SupportResult {
    return {
        project: "Edict",
        author: "Sowiedu",
        note: SUPPORT_NOTE,
        links: {
            github_sponsors: "https://github.com/sponsors/Sowiedu",
            repository: "https://github.com/Sowiedu/Edict",
            npm: "https://www.npmjs.com/package/edict-lang",
            btc_address: "bc1qau0aq8325rjjf6hsg3hk5enq9pwuy0ensgfsj0",
        },
        actions: [
            { name: "sponsor", url: "https://github.com/sponsors/Sowiedu" },
            { name: "donate_btc", url: "bitcoin:bc1qau0aq8325rjjf6hsg3hk5enq9pwuy0ensgfsj0" },
            { name: "star", url: "https://github.com/Sowiedu/Edict" },
            { name: "report_issue", url: "https://github.com/Sowiedu/Edict/issues/new" },
        ],
    };
}

export interface LintResult {
    ok: boolean;
    warnings?: LintWarning[];
    errors?: StructuredError[];
}

export function handleLint(ast: unknown): LintResult {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const validation = validate(migrated.ast);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors };
    }

    const module = migrated.ast as import("../ast/nodes.js").EdictModule;
    const warnings = lint(module);
    return { ok: true, warnings };
}

// =============================================================================
// Compose handler
// =============================================================================

export interface ComposeHandlerResult {
    ok: boolean;
    module?: unknown;
    errors?: StructuredError[];
}

export async function handleCompose(
    fragments: unknown[],
    moduleName: string = "composed",
    moduleId: string = "mod-composed-001",
    runCheck: boolean = false,
): Promise<ComposeHandlerResult> {
    // Expand compact format on each fragment and migrate
    const expandedFragments = fragments.map((f) => {
        const expanded = expandCompact(f);
        const migrated = migrateToLatest(expanded);
        if (!migrated.ok) return null;
        return migrated.ast;
    });
    for (let i = 0; i < fragments.length; i++) {
        if (expandedFragments[i] === null) {
            const expanded = expandCompact(fragments[i]);
            const migrated = migrateToLatest(expanded);
            if (!migrated.ok) return { ok: false, errors: migrated.errors };
        }
    }

    // Compose fragments into a module
    const result = compose(expandedFragments as EdictFragment[], moduleName, moduleId);
    if (!result.ok) {
        return { ok: false, errors: result.errors };
    }

    // Optionally run full pipeline check on composed module
    if (runCheck) {
        const checkResult = await check(result.module);
        if (!checkResult.ok) {
            return { ok: false, module: result.module, errors: checkResult.errors };
        }
    }

    return { ok: true, module: result.module };
}

// =============================================================================
// Debug handler
// =============================================================================

export interface DebugHandlerResult {
    ok: boolean;
    output?: string;
    exitCode?: number;
    returnValue?: number;
    callStack?: string[];
    crashLocation?: { fn: string; nodeId: string };
    stepsExecuted?: number;
    error?: string;
    errors?: StructuredError[];
}

export async function handleDebug(
    ast: unknown,
    options?: { maxSteps?: number },
): Promise<DebugHandlerResult> {
    // Full pipeline: expand → check → compile(debugMode) → runDebug
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const checkResult = await check(migrated.ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module, {
        typeInfo: checkResult.typeInfo,
        debugMode: true,
    });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    const debugResult = await runDebug(
        compileResult.wasm,
        compileResult.debugMetadata!,
        { maxSteps: options?.maxSteps },
    );

    return {
        ok: true,
        output: debugResult.output,
        exitCode: debugResult.exitCode,
        returnValue: debugResult.returnValue,
        callStack: debugResult.callStack,
        crashLocation: debugResult.crashLocation,
        stepsExecuted: debugResult.stepsExecuted,
        error: debugResult.error,
    };
}

// =============================================================================
// Generate Tests handler
// =============================================================================

export interface GenerateTestsHandlerResult {
    ok: boolean;
    tests?: GeneratedTest[];
    errors?: StructuredError[];
    skipped?: string[];
}

export async function handleGenerateTests(ast: unknown): Promise<GenerateTestsHandlerResult> {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const checkResult = await check(migrated.ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, errors: checkResult.errors };
    }

    const result = await generateTests(checkResult.module);
    return {
        ok: true,
        tests: result.tests,
        skipped: result.skipped,
    };
}
