// =============================================================================
// MCP Tool Wrapper Tests — compose, debug, export, import_skill
// =============================================================================
// Exercises handler → tool wrapper paths (success + error) for the 4 tool
// wrappers sitting at 20% coverage.

import { describe, it, expect } from "vitest";
import { composeTool } from "../../src/mcp/tools/compose.js";
import { debugTool } from "../../src/mcp/tools/debug.js";
import { exportTool } from "../../src/mcp/tools/export.js";
import { importSkillTool } from "../../src/mcp/tools/import_skill.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validModule = {
    kind: "module",
    id: "mod-001",
    name: "Test",
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn-001",
            name: "main",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "literal", id: "lit-001", value: 42 }],
        },
    ],
};

const validFragment = {
    kind: "fragment",
    id: "frag-001",
    provides: ["helper"],
    requires: [],
    imports: [],
    definitions: [
        {
            kind: "fn",
            id: "fn-h-001",
            name: "helper",
            params: [],
            effects: ["pure"],
            returnType: { kind: "basic", name: "Int" },
            contracts: [],
            body: [{ kind: "literal", id: "lit-h-001", value: 1 }],
        },
    ],
};

// =============================================================================
// composeTool
// =============================================================================

describe("composeTool wrapper", () => {
    it("returns ok response for valid fragments", async () => {
        const result = await composeTool.handler({ fragments: [validFragment] });
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.ok).toBe(true);
        expect(parsed.module).toBeDefined();
    });

    it("returns isError for fragments with unsatisfied requirements", async () => {
        const needyFragment = {
            ...validFragment,
            requires: ["nonexistent"],
        };
        const result = await composeTool.handler({ fragments: [needyFragment] });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.errors).toBeDefined();
    });
});

// =============================================================================
// debugTool
// =============================================================================

describe("debugTool wrapper", () => {
    it("returns debug result for a valid AST", async () => {
        const result = await debugTool.handler({ ast: validModule });
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.ok).toBe(true);
    });

    it("returns isError for an invalid AST", async () => {
        const result = await debugTool.handler({ ast: { invalid: true } });
        // handleDebug checks the AST — returns ok:false errors (not thrown)
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.ok).toBe(false);
    });
});

// =============================================================================
// exportTool
// =============================================================================

describe("exportTool wrapper", () => {
    it("returns skill package for a valid AST", async () => {
        const result = await exportTool.handler({ ast: validModule, metadata: {} });
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.uasf).toBeDefined();
        expect(parsed.binary).toBeDefined();
    });

    it("returns isError for AST without entry point", async () => {
        const noMain = {
            ...validModule,
            definitions: [
                {
                    ...validModule.definitions[0],
                    id: "fn-002",
                    name: "not_main",
                },
            ],
        };
        const result = await exportTool.handler({ ast: noMain, metadata: {} });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.errors).toBeDefined();
    });
});

// =============================================================================
// importSkillTool
// =============================================================================

describe("importSkillTool wrapper", () => {
    it("returns ok for a valid skill package", async () => {
        // First export a valid skill
        const exportResult = await exportTool.handler({ ast: validModule, metadata: {} });
        const skill = JSON.parse((exportResult.content[0] as any).text);

        const result = await importSkillTool.handler({ skill });
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.ok).toBe(true);
    });

    it("returns isError for missing binary", async () => {
        const result = await importSkillTool.handler({ skill: { binary: null } });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.error).toBeDefined();
    });

    it("returns isError when skill has no binary.wasm", async () => {
        const result = await importSkillTool.handler({ skill: {} });
        expect(result.isError).toBe(true);
    });
});

// =============================================================================
// composeTool — check=true branch that fails
// =============================================================================

describe("composeTool wrapper — check branch", () => {
    it("returns isError when check=true and pipeline fails", async () => {
        // Fragment with type error: returns String but declares Int
        const badFragment = {
            kind: "fragment",
            id: "frag-bad-001",
            provides: ["main"],
            requires: [],
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-bad-001",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{ kind: "literal", id: "lit-bad-001", value: "not_an_int" }],
                },
            ],
        };

        const result = await composeTool.handler({
            fragments: [badFragment],
            check: true,
        });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed.errors).toBeDefined();
    });
});
