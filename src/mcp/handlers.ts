// =============================================================================
// MCP Tool Handlers — Pure functions (no MCP SDK dependency)
// =============================================================================
// Each handler takes validated input and returns a structured result.
// Extracted from the server for testability.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageSkill } from "../skills/package.js";
import { invokeSkill } from "../skills/invoke.js";

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
import { VALID_EFFECTS, type EdictFragment, type EdictModule } from "../ast/nodes.js";
import { checkMultiModule } from "../multi-module.js";
import { incrementalCheck } from "../incremental/check.js";
import { generateTests } from "../contracts/generate-tests.js";
import type { GeneratedTest } from "../contracts/generate-tests.js";
import { explainError } from "../errors/explain.js";
import type { ExplainResult } from "../errors/explain.js";
import { migrateToLatest, CURRENT_SCHEMA_VERSION } from "../migration/migrate.js";
import { generateWorkerScaffold } from "../deploy/scaffold.js";
import type { WorkerConfig } from "../deploy/scaffold.js";
import { deployToCloudflare } from "../deploy/cloudflare-api.js";
import { buildAgentGuide } from "./agent-guide.js";

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
let cachedAgentSchema: unknown | null = null;
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
    format: "full" | "minimal" | "compact" | "agent";
    tokenEstimate: number;
}

export interface ExamplesResult {
    count: number;
    examples: { name: string; ast: unknown; isMultiModule?: boolean }[];
    schemaSnippet: unknown; // agent-format schema bundle (same as handleSchema("agent").schema)
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

export function handleSchema(format: "full" | "minimal" | "compact" | "agent" = "full"): SchemaResult {
    if (format === "agent") {
        if (!cachedAgentSchema) {
            const compactRef = compactSchemaReference();
            if (!cachedMinimalSchema) {
                cachedMinimalSchema = stripDescriptions(JSON.parse(loadSchema()));
            }
            cachedAgentSchema = {
                schema: cachedMinimalSchema,
                compactFormat: compactRef,
                builtins: Array.from(BUILTIN_FUNCTIONS.keys()),
                effects: [...VALID_EFFECTS],
                schemaVersion: CURRENT_SCHEMA_VERSION,
                guide: buildAgentGuide(),
            };
        }
        const text = JSON.stringify(cachedAgentSchema);
        return { schema: cachedAgentSchema, format: "agent", tokenEstimate: Math.ceil(text.length / 4) };
    }
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
    const agentSchema = handleSchema("agent");
    return { count: examples.length, examples, schemaSnippet: agentSchema.schema };
}

export function handleValidate(ast: unknown): ValidateResult {
    const result = validate(ast);
    if (result.ok) {
        return { ok: true };
    }
    return { ok: false, errors: result.errors };
}

export async function handleCheck(ast: unknown): Promise<CheckResult> {
    const result = await check(ast);
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
    const checkResult = await check(ast);
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
    const result = await checkMultiModule(modules);
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
    const result = await checkMultiModule(modules);
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
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    // Delegate packaging to the standalone skills module
    const pkgResult = packageSkill({
        module: checkResult.module,
        wasm: compileResult.wasm,
        coverage: checkResult.coverage,
        metadata,
    });

    if (!pkgResult.ok) {
        return {
            ok: false,
            errors: [{ error: "missing_entry_point", entryPointName: "main" }],
        };
    }

    return { ok: true, skill: pkgResult.skill };
}

export interface PackageSkillHandlerResult {
    ok: boolean;
    skill?: unknown;
    error?: string;
}

export function handlePackageSkill(
    ast: unknown,
    wasmBase64: string,
    metadata?: { name?: string; version?: string; description?: string; author?: string },
): PackageSkillHandlerResult {
    // Expand and migrate before validation
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, error: `Schema migration failed: ${JSON.stringify(migrated.errors)}` };

    const validation = validate(migrated.ast);
    if (!validation.ok) return { ok: false, error: `Validation failed: ${JSON.stringify(validation.errors)}` };

    const module = migrated.ast as EdictModule;

    // Decode WASM from base64
    const wasm = new Uint8Array(Buffer.from(wasmBase64, "base64"));

    // Delegate to packageSkill
    const result = packageSkill({ module, wasm, metadata });
    if (!result.ok) {
        return { ok: false, error: result.error };
    }

    return { ok: true, skill: result.skill };
}

export interface ImportSkillResult {
    ok: boolean;
    output?: string;
    exitCode?: number;
    error?: string;
}

export async function handleImportSkill(skill: any, limits?: RunLimits): Promise<ImportSkillResult> {
    // Delegate to the standalone skills module
    const result = await invokeSkill(skill, limits);
    return {
        ok: result.ok,
        output: result.output,
        exitCode: result.exitCode,
        error: result.error,
    };
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
            effectPolymorphism: true,
            skillPackages: true,
            deploy: true,
            invoke: true,
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
    // Full pipeline: check -> compile(debugMode) -> runDebug
    const checkResult = await check(ast);
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
    const checkResult = await check(ast);
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

// =============================================================================
// Deploy handler
// =============================================================================

export interface DeployConfig {
    name?: string;
    route?: string;
    compatibilityDate?: string;
    kvNamespaces?: { binding: string; id: string }[];
}

export interface DeployResult {
    ok: boolean;
    target: string;
    // wasm_binary target fields
    wasm?: string;
    wasmSize?: number;
    verified?: boolean;
    effects?: string[];
    contracts?: number;
    // cloudflare target fields
    bundle?: { path: string; content: string }[];
    // common
    url?: string;
    status?: string;
    errors?: StructuredError[];
    /** Env vars required for live deployment (set when falling back to bundle-only). */
    credentialsRequired?: string[];
}

export async function handleDeploy(
    ast: unknown,
    target: string,
    config?: DeployConfig,
): Promise<DeployResult> {
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, target, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, target, errors: compileResult.errors };
    }

    // Extract metadata from the checked module
    const module = checkResult.module as EdictModule;
    const allEffects = new Set<string>();
    let contractCount = 0;
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            for (const eff of def.effects) {
                const effStr = typeof eff === "string" ? eff : (eff as { name: string }).name;
                allEffects.add(effStr);
            }
            contractCount += def.contracts.length;
        }
    }
    const hasContracts = contractCount > 0;
    const verified = hasContracts && checkResult.coverage?.contracts.proven === checkResult.coverage?.contracts.total;

    // Step 2: Dispatch to target
    switch (target) {
        case "wasm_binary": {
            const base64 = Buffer.from(compileResult.wasm).toString("base64");
            return {
                ok: true,
                target: "wasm_binary",
                wasm: base64,
                wasmSize: compileResult.wasm.length,
                verified,
                effects: Array.from(allEffects),
                contracts: contractCount,
                status: "ready",
            };
        }

        case "cloudflare": {
            const workerName = config?.name || module.name || "edict-worker";
            const workerConfig: WorkerConfig = {
                name: workerName,
                compatibilityDate: config?.compatibilityDate,
                kvNamespaces: config?.kvNamespaces,
            };

            const scaffoldResult = generateWorkerScaffold(compileResult.wasm, workerConfig);
            if (!scaffoldResult.ok) {
                return {
                    ok: false,
                    target: "cloudflare",
                    errors: [{ error: "scaffold_failed", reason: scaffoldResult.error } as unknown as StructuredError],
                };
            }

            const commonMeta = {
                wasmSize: compileResult.wasm.length,
                verified,
                effects: Array.from(allEffects),
                contracts: contractCount,
            };

            // Live deployment when credentials are available
            const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
            const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

            if (cfApiToken && cfAccountId) {
                const deployResult = await deployToCloudflare({
                    accountId: cfAccountId,
                    apiToken: cfApiToken,
                    scriptName: workerName,
                    bundle: scaffoldResult.bundle,
                    compatibilityDate: config?.compatibilityDate,
                });

                if (deployResult.ok) {
                    return {
                        ok: true,
                        target: "cloudflare",
                        ...commonMeta,
                        url: `${deployResult.url}${config?.route || ""}`,
                        status: "live",
                    };
                }

                return {
                    ok: false,
                    target: "cloudflare",
                    errors: [{
                        error: "deploy_failed",
                        code: deployResult.code,
                        reason: deployResult.error,
                        ...(deployResult.responseBody !== undefined
                            ? { responseBody: deployResult.responseBody }
                            : {}),
                    } as unknown as StructuredError],
                };
            }

            // Fallback: bundle-only when no credentials
            const bundle = scaffoldResult.bundle.files.map(f => ({
                path: f.path,
                content: f.content instanceof Uint8Array
                    ? Buffer.from(f.content).toString("base64")
                    : f.content,
            }));

            return {
                ok: true,
                target: "cloudflare",
                bundle,
                ...commonMeta,
                url: `https://${workerName}.workers.dev${config?.route || ""}`,
                status: "bundled",
                credentialsRequired: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
            };
        }

        default:
            return {
                ok: false,
                target,
                errors: [{
                    error: "unknown_deploy_target",
                    target,
                    validTargets: ["wasm_binary", "cloudflare"],
                } as unknown as StructuredError],
            };
    }
}

// =============================================================================
// Invoke handler — invoke deployed WASM services via HTTP
// =============================================================================

export interface InvokeResult {
    ok: boolean;
    output?: string;
    status?: number;
    durationMs?: number;
    error?: string;
    errorCode?: "unreachable" | "timeout" | "invalid_response" | "http_error";
}

export async function handleInvoke(
    url: string,
    input?: string,
    options?: { timeoutMs?: number; method?: string; headers?: Record<string, string> },
): Promise<InvokeResult> {
    const method = options?.method?.toUpperCase() ?? "POST";
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...options?.headers,
    };

    const start = Date.now();
    try {
        const fetchOptions: RequestInit = {
            method,
            headers,
            signal: AbortSignal.timeout(timeoutMs),
        };
        // Only set body for non-GET/HEAD methods when input is provided
        if (input !== undefined && method !== "GET" && method !== "HEAD") {
            fetchOptions.body = input;
        }

        const response = await fetch(url, fetchOptions);
        const body = await response.text();
        const durationMs = Date.now() - start;

        if (response.ok) {
            return { ok: true, output: body, status: response.status, durationMs };
        }
        return {
            ok: false,
            output: body,
            status: response.status,
            durationMs,
            error: `HTTP ${response.status}: ${response.statusText}`,
            errorCode: "http_error",
        };
    } catch (err: unknown) {
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);

        // Timeout detection: AbortSignal.timeout throws a TimeoutError (DOMException with name "TimeoutError")
        if (err instanceof DOMException && err.name === "TimeoutError") {
            return { ok: false, durationMs, error: `Request timed out after ${timeoutMs}ms`, errorCode: "timeout" };
        }
        // Also catch AbortError (in case of manual abort)
        if (err instanceof DOMException && err.name === "AbortError") {
            return { ok: false, durationMs, error: `Request aborted: ${message}`, errorCode: "timeout" };
        }

        // Network/DNS errors
        if (err instanceof TypeError || message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
            return { ok: false, durationMs, error: `Service unreachable: ${message}`, errorCode: "unreachable" };
        }

        return { ok: false, durationMs, error: `Unexpected error: ${message}`, errorCode: "invalid_response" };
    }
}
