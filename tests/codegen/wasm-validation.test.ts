import { describe, it, expect } from "vitest";
import { compile } from "../../src/codegen/codegen.js";
import type { EdictModule } from "../../src/ast/nodes.js";

// We want to test that a failed binaryen validation emits a WasmValidationError.
// However, it's hard to trick our compiler into producing invalid WASM without using unsupported features.
// So we check that our error type interface works as expected by triggering
// an unimplemented feature (like modulo on floats) which should now return a WasmValidationError.

describe("WASM Validation & Codegen Errors", () => {
    it("returns StructuredError for unsupported float modulo", () => {
        const mod: EdictModule = {
            kind: "module",
            name: "test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-001",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Float" },
                    contracts: [],
                    body: [
                        {
                            kind: "binop",
                            id: "binop-001",
                            op: "%",
                            left: { kind: "literal", id: "lit-001", value: 5.5, type: { kind: "basic", name: "Float" } },
                            right: { kind: "literal", id: "lit-002", value: 2.0, type: { kind: "basic", name: "Float" } }
                        }
                    ]
                }
            ]
        };

        const result = compile(mod);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.error).toBe("wasm_validation_error");
        }
    });
});
