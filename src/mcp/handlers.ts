// =============================================================================
// MCP Tool Handlers — Pure functions (no MCP SDK dependency)
// =============================================================================
// Each handler takes validated input and returns a structured result.
// Extracted from the server for testability.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../validator/validate.js";
import { check } from "../check.js";
import { compile } from "../codegen/codegen.js";
import { run } from "../codegen/runner.js";
import type { RunLimits } from "../codegen/runner.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "../errors/structured-errors.js";
import { applyPatches, type AstPatch } from "../patch/apply.js";
import { buildErrorCatalog, type ErrorCatalog } from "../errors/error-catalog.js";
import { stripDescriptions } from "./minimal-schema.js";
import { lint } from "../lint/lint.js";
import type { LintWarning } from "../lint/warnings.js";
import { expandCompact, compactSchemaReference } from "../compact/expand.js";

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
let cachedExamples: { name: string; ast: unknown }[] | null = null;
let cachedVersion: string | null = null;

function loadSchema(): string {
    if (!cachedSchema) {
        cachedSchema = readFileSync(schemaPath, "utf-8");
    }
    return cachedSchema;
}

function loadExamples(): { name: string; ast: unknown }[] {
    if (!cachedExamples) {
        const files = readdirSync(examplesDir)
            .filter((f) => f.endsWith(".edict.json"))
            .sort();
        cachedExamples = files.map((f) => ({
            name: f.replace(".edict.json", ""),
            ast: JSON.parse(readFileSync(resolve(examplesDir, f), "utf-8")) as unknown,
        }));
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
    examples: { name: string; ast: unknown }[];
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
}

export interface VersionResult {
    version: string;
    schemaVersion: string;
    builtins: string[];
    features: Record<string, boolean>;
    limits: Record<string, number>;
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
    const result = validate(expanded);
    if (result.ok) {
        return { ok: true };
    }
    return { ok: false, errors: result.errors };
}

export async function handleCheck(ast: unknown): Promise<CheckResult> {
    const expanded = expandCompact(ast);
    const result = await check(expanded);
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
    // Full pipeline: expand compact format, then check, then compile
    const expanded = expandCompact(ast);
    const checkResult = await check(expanded);
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

export async function handleRun(wasmBase64: string, limits?: RunLimits): Promise<RunResult> {
    const wasmBytes = new Uint8Array(Buffer.from(wasmBase64, "base64"));
    const result = await run(wasmBytes, "main", limits);
    return {
        output: result.output,
        exitCode: result.exitCode,
        returnValue: result.returnValue,
        error: result.error,
        limitInfo: result.limitInfo,
    };
}

export interface PatchResult {
    ok: boolean;
    errors?: StructuredError[];
    patchedAst?: unknown;
}

export async function handlePatch(
    baseAst: unknown,
    patches: AstPatch[],
    returnAst: boolean = false,
): Promise<PatchResult> {
    // Step 0: Expand compact format on base AST and patch values
    const expandedBase = expandCompact(baseAst);
    const expandedPatches = patches.map((p) => ({
        ...p,
        value: p.value !== undefined ? expandCompact(p.value) : p.value,
    }));

    // Step 1: Apply patches
    const patchResult = applyPatches(expandedBase, expandedPatches);
    if (!patchResult.ok) {
        return { ok: false, errors: patchResult.errors };
    }

    // Step 2: Run full check pipeline on patched AST
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
        schemaVersion: "1.0",
        builtins: Array.from(BUILTIN_FUNCTIONS.keys()),
        features: {
            contracts: true,
            effects: true,
            unitTypes: false,
            multiModule: false,
            compactAst: true,
        },
        limits: {
            z3TimeoutMs: 5000,
            maxModules: 1,
            executionTimeoutMs: 5000,
            maxMemoryMb: 1,
        },
    };
}

export interface LintResult {
    ok: boolean;
    warnings?: LintWarning[];
    errors?: StructuredError[];
}

export function handleLint(ast: unknown): LintResult {
    const expanded = expandCompact(ast);
    const validation = validate(expanded);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors };
    }

    const module = expanded as import("../ast/nodes.js").EdictModule;
    const warnings = lint(module);
    return { ok: true, warnings };
}
