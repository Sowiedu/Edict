// =============================================================================
// Debug Handler
// =============================================================================

import { check } from "../../check.js";
import { compile } from "../../codegen/codegen.js";
import { runDebug } from "../../codegen/runner.js";
import type { StructuredError } from "../../errors/structured-errors.js";

// =============================================================================
// Result type
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

// =============================================================================
// Handler
// =============================================================================

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
