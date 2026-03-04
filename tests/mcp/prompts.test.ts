// =============================================================================
// MCP Prompt Template Tests
// =============================================================================

import { describe, it, expect } from "vitest";

import {
    promptWriteProgram,
    promptFixError,
    promptAddContracts,
    promptReviewAst,
} from "../../src/mcp/prompts.js";

// =============================================================================
// write_program
// =============================================================================

describe("promptWriteProgram", () => {
    it("returns valid prompt result with messages", () => {
        const result = promptWriteProgram("Print the numbers 1 to 10");
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.description).toBeDefined();
    });

    it("includes the task description in the prompt", () => {
        const task = "Calculate fibonacci numbers";
        const result = promptWriteProgram(task);
        const text = result.messages[0]!.content.text;
        expect(text).toContain(task);
    });

    it("includes minimal schema in the prompt", () => {
        const result = promptWriteProgram("Hello world");
        const text = result.messages[0]!.content.text;
        // Schema should contain core AST node kinds
        expect(text).toContain("module");
        expect(text).toContain("fn");
    });

    it("includes hello world example", () => {
        const result = promptWriteProgram("Hello world");
        const text = result.messages[0]!.content.text;
        expect(text).toContain("Hello, World!");
    });

    it("includes builtin function names", () => {
        const result = promptWriteProgram("test");
        const text = result.messages[0]!.content.text;
        expect(text).toContain("print");
    });

    it("message has correct role structure", () => {
        const result = promptWriteProgram("test");
        const msg = result.messages[0]!;
        expect(msg.role).toBe("user");
        expect(msg.content.type).toBe("text");
        expect(typeof msg.content.text).toBe("string");
    });
});

// =============================================================================
// fix_error
// =============================================================================

describe("promptFixError", () => {
    const sampleError = JSON.stringify({
        error: "type_mismatch",
        nodeId: "lit-001",
        expected: { kind: "basic", name: "Int" },
        actual: { kind: "basic", name: "String" },
    });

    it("returns valid prompt result", () => {
        const result = promptFixError(sampleError);
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.description).toBeDefined();
    });

    it("embeds the error JSON in the prompt", () => {
        const result = promptFixError(sampleError);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("type_mismatch");
        expect(text).toContain("lit-001");
    });

    it("includes fix strategy guidance", () => {
        const result = promptFixError(sampleError);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("nodeId");
        expect(text).toContain("expected");
        expect(text).toContain("edict_patch");
    });

    it("lists common error types", () => {
        const result = promptFixError(sampleError);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("undefined_reference");
        expect(text).toContain("effect_violation");
        expect(text).toContain("contract_failure");
    });
});

// =============================================================================
// add_contracts
// =============================================================================

describe("promptAddContracts", () => {
    const sampleAst = JSON.stringify({
        kind: "module",
        id: "mod-001",
        name: "test",
        imports: [],
        definitions: [],
    });

    it("returns valid prompt result", () => {
        const result = promptAddContracts(sampleAst);
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.description).toBeDefined();
    });

    it("embeds the AST in the prompt", () => {
        const result = promptAddContracts(sampleAst);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("mod-001");
    });

    it("includes contracts example", () => {
        const result = promptAddContracts(sampleAst);
        const text = result.messages[0]!.content.text;
        // The contracts example has safeDivide and pre/post conditions
        expect(text).toContain("safeDivide");
        expect(text).toContain("pre");
        expect(text).toContain("post");
    });

    it("explains Z3 verification", () => {
        const result = promptAddContracts(sampleAst);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("Z3");
    });
});

// =============================================================================
// review_ast
// =============================================================================

describe("promptReviewAst", () => {
    const sampleAst = JSON.stringify({
        kind: "module",
        id: "mod-review-001",
        name: "review_target",
        imports: [],
        definitions: [],
    });

    it("returns valid prompt result", () => {
        const result = promptReviewAst(sampleAst);
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.description).toBeDefined();
    });

    it("embeds the AST in the prompt", () => {
        const result = promptReviewAst(sampleAst);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("mod-review-001");
    });

    it("includes review checklist", () => {
        const result = promptReviewAst(sampleAst);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("ID uniqueness");
        expect(text).toContain("Effect correctness");
        expect(text).toContain("Dead code");
    });

    it("includes available builtins", () => {
        const result = promptReviewAst(sampleAst);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("print");
        expect(text).toContain("string_length");
    });

    it("includes valid effects list", () => {
        const result = promptReviewAst(sampleAst);
        const text = result.messages[0]!.content.text;
        expect(text).toContain("pure");
        expect(text).toContain("io");
        expect(text).toContain("reads");
    });
});
