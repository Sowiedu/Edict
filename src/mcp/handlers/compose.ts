// =============================================================================
// Compose Handler
// =============================================================================

import { check } from "../../check.js";
import type { StructuredError } from "../../errors/structured-errors.js";
import { expandCompact } from "../../compact/expand.js";
import { compose } from "../../compose/compose.js";
import type { EdictFragment } from "../../ast/nodes.js";
import { migrateToLatest } from "../../migration/migrate.js";

// =============================================================================
// Result type
// =============================================================================

export interface ComposeHandlerResult {
    ok: boolean;
    module?: unknown;
    errors?: StructuredError[];
}

// =============================================================================
// Handler
// =============================================================================

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
