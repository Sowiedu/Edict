// =============================================================================
// Edict Pipeline — compileAndRun(ast) → Promise<RunResult>
// =============================================================================
// Full end-to-end: validate → resolve → typeCheck → effectCheck → compile → run.

import { check, type CheckResult } from "./check.js";
import { compile, type CompileResult } from "./codegen/codegen.js";
import { run, type RunResult } from "./codegen/runner.js";
import type { StructuredError } from "./errors/structured-errors.js";

export interface CompileAndRunSuccess extends RunResult {
    ok: true;
}

export interface CompileAndRunFailure {
    ok: false;
    phase: "check" | "compile";
    errors: StructuredError[];
}

export type CompileAndRunResult = CompileAndRunSuccess | CompileAndRunFailure;

/**
 * Full pipeline: check → compile → run.
 *
 * @param ast - Raw JSON AST (parsed from .edict.json)
 * @returns The run result with captured output, or errors from whichever phase failed.
 */
export async function compileAndRun(ast: unknown): Promise<CompileAndRunResult> {
    // Phase 1–4: check
    const checkResult: CheckResult = await check(ast);

    if (!checkResult.ok || !checkResult.module) {
        return {
            ok: false,
            phase: "check",
            errors: checkResult.errors,
        };
    }

    // Phase 5: compile to WASM
    const compileResult: CompileResult = compile(checkResult.module);

    if (!compileResult.ok) {
        return {
            ok: false,
            phase: "compile",
            errors: compileResult.errors,
        };
    }

    // Phase 6: run
    const runResult = await run(compileResult.wasm);

    return {
        ok: true,
        ...runResult,
    };
}
