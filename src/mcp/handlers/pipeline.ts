// =============================================================================
// Pipeline Handlers — Validate, Check, Compile, Run, Replay, Lint, Generate Tests
// =============================================================================

import { validate } from "../../validator/validate.js";
import { check } from "../../check.js";
import { compile } from "../../codegen/codegen.js";
import { run } from "../../codegen/runner.js";
import type { RunLimits } from "../../codegen/runner.js";
import type { ReplayToken } from "../../codegen/replay-types.js";
import type { StructuredError, AnalysisDiagnostic, VerificationCoverage } from "../../errors/structured-errors.js";
import { expandCompact } from "../../compact/expand.js";
import { migrateToLatest } from "../../migration/migrate.js";
import { lint } from "../../lint/lint.js";
import type { LintWarning } from "../../lint/warnings.js";
import { checkMultiModule } from "../../multi-module.js";
import { generateTests } from "../../contracts/generate-tests.js";
import type { GeneratedTest } from "../../contracts/generate-tests.js";
import type { EdictModule } from "../../ast/nodes.js";

// =============================================================================
// Result types
// =============================================================================

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

export interface LintResult {
    ok: boolean;
    warnings?: LintWarning[];
    errors?: StructuredError[];
}

export interface GenerateTestsHandlerResult {
    ok: boolean;
    tests?: GeneratedTest[];
    errors?: StructuredError[];
    skipped?: string[];
}

// =============================================================================
// Handlers
// =============================================================================

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

export function handleLint(ast: unknown): LintResult {
    const expanded = expandCompact(ast);
    const migrated = migrateToLatest(expanded);
    if (!migrated.ok) return { ok: false, errors: migrated.errors };
    const validation = validate(migrated.ast);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors };
    }

    const module = migrated.ast as EdictModule;
    const warnings = lint(module);
    return { ok: true, warnings };
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
