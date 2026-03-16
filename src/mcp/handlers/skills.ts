// =============================================================================
// Skill Handlers — Export, Package, Import
// =============================================================================

import { packageSkill } from "../../skills/package.js";
import { invokeSkill } from "../../skills/invoke.js";
import { validate } from "../../validator/validate.js";
import { check } from "../../check.js";
import { compile } from "../../codegen/codegen.js";
import type { RunLimits } from "../../codegen/runner.js";
import type { StructuredError } from "../../errors/structured-errors.js";
import { expandCompact } from "../../compact/expand.js";
import { migrateToLatest } from "../../migration/migrate.js";
import type { EdictModule } from "../../ast/nodes.js";

// =============================================================================
// Result types
// =============================================================================

export interface ExportResult {
    ok: boolean;
    skill?: unknown;
    errors?: StructuredError[];
}

export interface PackageSkillHandlerResult {
    ok: boolean;
    skill?: unknown;
    error?: string;
}

export interface ImportSkillResult {
    ok: boolean;
    output?: string;
    exitCode?: number;
    error?: string;
}

// =============================================================================
// Handlers
// =============================================================================

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
