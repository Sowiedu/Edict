// =============================================================================
// MCP Prompts + Additional Handler Branch Coverage Tests
// =============================================================================
// Tests the MCP prompt functions and covers remaining handler/tool branches.

import { describe, it, expect } from "vitest";
import {
    promptWriteProgram,
    promptFixError,
    promptAddContracts,
    promptReviewAst,
} from "../../src/mcp/prompts.js";
import { patchTool } from "../../src/mcp/tools/patch.js";
import { lintTool } from "../../src/mcp/tools/lint.js";
import { handleCheck, handleCompile, handleRun } from "../../src/mcp/handlers.js";

// =============================================================================
// Prompts
// =============================================================================

describe("MCP prompts", () => {
    it("promptWriteProgram returns messages with schema and example", () => {
        const result = promptWriteProgram("Create a calculator");
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.role).toBe("user");
        expect(result.messages[0]!.content.text).toContain("calculator");
        expect(result.messages[0]!.content.text).toContain("module");
    });

    it("promptFixError returns structured fix guidance", () => {
        const errJson = JSON.stringify({ error: "type_mismatch", nodeId: "n-001" });
        const result = promptFixError(errJson);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.content.text).toContain("type_mismatch");
    });

    it("promptAddContracts returns contracts guidance with example", () => {
        const result = promptAddContracts('{"kind":"module"}');
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.content.text).toContain("postcondition");
        expect(result.messages[0]!.content.text).toContain("module");
    });

    it("promptReviewAst returns review checklist", () => {
        const result = promptReviewAst('{"kind":"module"}');
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.content.text).toContain("Review checklist");
        expect(result.messages[0]!.content.text).toContain("module");
    });
});

// =============================================================================
// MCP patchTool — handler branch coverage
// =============================================================================

describe("patchTool handler", () => {
    it("returns success for valid patch", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }],
        };
        const result = await patchTool.handler({
            ast,
            patches: [{ nodeId: "fn-001", op: "replace", field: "name", value: "main" }],
            returnAst: false,
        });
        expect(result.isError).toBeUndefined();
    });

    it("returns error for invalid patch", async () => {
        const result = await patchTool.handler({
            ast: {
                kind: "module", id: "mod-001", name: "test", imports: [],
                definitions: [],
            },
            patches: [{ nodeId: "nonexistent", op: "replace", field: "x", value: "y" }],
            returnAst: false,
        });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.errors).toBeDefined();
    });

    it("includes patchedAst when returnAst is true", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 0 }],
            }],
        };
        const result = await patchTool.handler({
            ast,
            patches: [{ nodeId: "fn-001", op: "replace", field: "name", value: "main" }],
            returnAst: true,
        });
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.patchedAst).toBeDefined();
    });
});

// =============================================================================
// MCP lintTool — error path
// =============================================================================

describe("lintTool handler — additional coverage", () => {
    it("returns lint results for valid module with no warnings", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [
                    { kind: "post", id: "post-001", condition: { kind: "binop", id: "bin-001", op: ">=", left: { kind: "ident", id: "id-r1", name: "result" }, right: { kind: "literal", id: "lit-001", value: 0 } } },
                ],
                body: [
                    {
                        kind: "call", id: "call-001",
                        fn: { kind: "ident", id: "id-print-001", name: "print" },
                        args: [{ kind: "literal", id: "lit-msg-001", value: "hello" }],
                    },
                    { kind: "literal", id: "lit-ret-001", value: 0 },
                ],
            }],
        };
        const result = await lintTool.handler({ ast });
        expect(result.isError).toBeUndefined();
    });
});

// =============================================================================
// Handler edge cases — compile and run
// =============================================================================

describe("handleCompile + handleRun cycle", () => {
    it("compiles and runs a simple program", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 42 }],
            }],
        };
        const compileResult = await handleCompile(ast) as any;
        expect(compileResult.ok).toBe(true);
        expect(compileResult.wasm).toBeDefined();

        const runResult = await handleRun(compileResult.wasm!);
        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(42);
    });

    it("handleCompile returns errors for invalid AST", async () => {
        const result = await handleCompile({ invalid: true });
        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
    });

    it("handleRun returns error for invalid base64", async () => {
        const result = await handleRun("invalid-base64");
        // Invalid WASM should fail during instantiation
        expect(result.exitCode).toBeDefined();
    });

    it("handleCheck returns errors for type mismatch", async () => {
        const ast = {
            kind: "module", id: "mod-001", name: "test", imports: [],
            definitions: [{
                kind: "fn", id: "fn-001", name: "main", params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Bool" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 42 }],
            }],
        };
        const result = await handleCheck(ast);
        expect(result.ok).toBe(false);
        expect(result.errors!.some(e => e.error === "type_mismatch")).toBe(true);
    });
});
