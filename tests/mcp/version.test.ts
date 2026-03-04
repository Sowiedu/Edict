import { describe, it, expect } from "vitest";
import { handleVersion } from "../../src/mcp/handlers.js";
import { BUILTIN_FUNCTIONS } from "../../src/codegen/builtins.js";

describe("handleVersion", () => {
    it("returns correctly structured capability information", () => {
        const result = handleVersion();

        expect(typeof result.version).toBe("string");
        expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(result.schemaVersion).toBe("1.0");
        expect(Array.isArray(result.builtins)).toBe(true);
        expect(typeof result.features).toBe("object");
        expect(typeof result.limits).toBe("object");
    });

    it("includes all statically defined builtins", () => {
        const result = handleVersion();
        const expectedBuiltins = Array.from(BUILTIN_FUNCTIONS.keys());

        expect(result.builtins).toHaveLength(expectedBuiltins.length);
        for (const builtin of expectedBuiltins) {
            expect(result.builtins).toContain(builtin);
        }
    });

    it("has sane feature flags and limits", () => {
        const result = handleVersion();

        expect(typeof result.features.contracts).toBe("boolean");
        expect(typeof result.features.effects).toBe("boolean");

        expect(typeof result.limits.z3TimeoutMs).toBe("number");
        expect(result.limits.z3TimeoutMs).toBeGreaterThan(0);
    });
});
