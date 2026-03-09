import { describe, it, expect } from "vitest";
import { validate } from "../../src/validator/validate.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Validates all example programs in the examples/ directory.
 */
describe("example programs", () => {
    const examplesDir = join(import.meta.dirname, "../../examples");
    const files = readdirSync(examplesDir).filter((f) =>
        f.endsWith(".edict.json"),
    );

    it("has at least 10 example programs", () => {
        expect(files.length).toBeGreaterThanOrEqual(10);
    });

    for (const file of files) {
        it(`validates ${file}`, () => {
            const content = readFileSync(join(examplesDir, file), "utf-8");
            const ast = JSON.parse(content);

            // Multi-module examples are JSON arrays — validate each module
            const modules = Array.isArray(ast) ? ast : [ast];
            for (const mod of modules) {
                const result = validate(mod);
                if (!result.ok) {
                    console.error(`Validation errors in ${file}:`, JSON.stringify(result.errors, null, 2));
                }
                expect(result).toEqual({ ok: true });
            }
        });
    }
});
