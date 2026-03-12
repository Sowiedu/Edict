// =============================================================================
// IR Lowering Pass — Bulk Validation against all example programs
// =============================================================================
// Runs every example through the full pipeline + lowering and verifies
// the generated IR has expected structure.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { validate, resolve, typeCheck, lowerModule } from "../../src/index.js";
import { checkMultiModule } from "../../src/multi-module.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import type { IRModule } from "../../src/ir/types.js";

const examplesDir = path.resolve(__dirname, "../../examples");

// --- Helpers ----------------------------------------------------------------

/** Structural assertions every lowered IR module must satisfy */
function assertIRStructure(ir: IRModule, label: string): void {
    expect(ir.name).toBeTruthy();
    expect(ir.sourceId).toBeTruthy();
    expect(Array.isArray(ir.functions)).toBe(true);
    expect(Array.isArray(ir.records)).toBe(true);
    expect(Array.isArray(ir.enums)).toBe(true);
    expect(Array.isArray(ir.constants)).toBe(true);
    expect(Array.isArray(ir.imports)).toBe(true);

    // Every function has params with resolved types and a body
    for (const fn of ir.functions) {
        expect(fn.name).toBeTruthy();
        expect(fn.sourceId).toBeTruthy();
        expect(fn.resolvedReturnType).toBeTruthy();
        for (const p of fn.params) {
            expect(p.resolvedType).toBeTruthy();
        }
    }

    // Every record has fields with types
    for (const rec of ir.records) {
        expect(rec.name).toBeTruthy();
        for (const f of rec.fields) {
            expect(f.name).toBeTruthy();
            expect(f.resolvedType).toBeTruthy();
        }
    }

    // Every enum has variants with tags
    for (const en of ir.enums) {
        expect(en.name).toBeTruthy();
        en.variants.forEach((v, i) => {
            expect(v.name).toBeTruthy();
            expect(v.tag).toBe(i);
        });
    }
}

// --- Test Suite --------------------------------------------------------------

describe("IR Lower — all example programs", () => {
    const files = fs.readdirSync(examplesDir)
        .filter(f => f.endsWith(".edict.json"))
        .sort();

    // Known examples with tool_call — these get filtered during lowering
    // (tool_call expressions become placeholder literals)
    const TOOL_CALL_FILES = new Set(["tool-calls.edict.json"]);

    for (const file of files) {
        it(`${file} lowers to valid IR`, () => {
            const raw = JSON.parse(
                fs.readFileSync(path.join(examplesDir, file), "utf-8"),
            );

            // Multi-module programs are JSON arrays
            if (Array.isArray(raw)) {
                // Use multi-module check pipeline to get merged module + typeInfo
                // checkMultiModule is async but we need synchronous test —
                // so validate + resolve + typeCheck each module individually
                const modules = raw as EdictModule[];
                for (const mod of modules) {
                    const vResult = validate(mod);
                    if (!vResult.ok) {
                        throw new Error(`Validation failed for ${mod.name}: ${JSON.stringify(vResult.errors)}`);
                    }
                    resolve(mod);
                    const { errors: typeErrors, typeInfo } = typeCheck(mod);
                    // Some multi-module programs have cross-module dependencies
                    // so type errors are expected — we still test lowering
                    const ir = lowerModule(mod, typeInfo);
                    assertIRStructure(ir, `${file}/${mod.name}`);
                }
                return;
            }

            // Single module
            const ast = raw;
            const vResult = validate(ast);
            expect(vResult.ok).toBe(true);
            if (!vResult.ok) return;

            const module = ast as EdictModule;
            const resolveErrors = resolve(module);
            // We expect no resolve errors for well-formed examples
            expect(resolveErrors).toEqual([]);

            const { errors: typeErrors, typeInfo } = typeCheck(module);
            expect(typeErrors).toEqual([]);

            // Lower
            const ir = lowerModule(module, typeInfo);

            // Structural assertions
            assertIRStructure(ir, file);

            // Specific invariants
            // Every example should have at least one function
            expect(ir.functions.length).toBeGreaterThan(0);

            // For tool_call examples, verify we don't crash
            if (TOOL_CALL_FILES.has(file)) {
                // Just verify it didn't throw — the placeholder literals are fine
                expect(ir).toBeTruthy();
            }
        });
    }
});
