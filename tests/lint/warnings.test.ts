// =============================================================================
// Lint Warnings Factory + Branch Coverage Tests
// =============================================================================
// Covers the warnings.ts factory functions and the redundantEffect ternary
// branch for empty vs non-empty requiredEffects.

import { describe, it, expect } from "vitest";
import {
    unusedVariable,
    unusedImport,
    missingContract,
    oversizedFunction,
    emptyBody,
    redundantEffect,
} from "../../src/lint/warnings.js";

describe("lint warning factories", () => {
    it("unusedVariable creates correct warning", () => {
        const w = unusedVariable("n-001", "x");
        expect(w.warning).toBe("unused_variable");
        expect(w.severity).toBe("warning");
        expect(w.nodeId).toBe("n-001");
        expect(w.name).toBe("x");
    });

    it("unusedImport creates correct warning", () => {
        const w = unusedImport("n-001", "math", ["sin", "cos"]);
        expect(w.warning).toBe("unused_import");
        expect(w.unusedNames).toEqual(["sin", "cos"]);
    });

    it("missingContract creates correct warning", () => {
        const w = missingContract("n-001", "add");
        expect(w.warning).toBe("missing_contract");
        expect(w.functionName).toBe("add");
    });

    it("oversizedFunction creates correct warning", () => {
        const w = oversizedFunction("n-001", "bigFn", 200, 50);
        expect(w.warning).toBe("oversized_function");
        expect(w.expressionCount).toBe(200);
        expect(w.threshold).toBe(50);
    });

    it("emptyBody creates correct warning", () => {
        const w = emptyBody("n-001", "noop");
        expect(w.warning).toBe("empty_body");
    });

    // The critical branch coverage test — requiredEffects.length > 0 vs === 0
    describe("redundantEffect", () => {
        it("uses requiredEffects when non-empty", () => {
            const w = redundantEffect("n-001", "main", ["io"], ["pure"]);
            expect(w.redundantEffects).toEqual(["io"]);
            expect(w.suggestion!.value).toEqual(["pure"]);
        });

        it("falls back to ['pure'] when requiredEffects is empty", () => {
            const w = redundantEffect("n-001", "main", ["io"], []);
            expect(w.suggestion!.value).toEqual(["pure"]);
        });
    });
});
