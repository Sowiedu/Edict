// =============================================================================
// edict://guide MCP Resource Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { guideResource } from "../../src/mcp/resources/guide.js";

describe("guideResource", () => {
    it("returns contents with uri edict://guide", async () => {
        const result = await guideResource.handler();
        expect(result.contents).toHaveLength(1);
        expect(result.contents[0].uri).toBe("edict://guide");
    });

    it("returns application/json mimeType", async () => {
        const result = await guideResource.handler();
        expect(result.contents[0].mimeType).toBe("application/json");
    });

    it("returns valid JSON in text field", async () => {
        const result = await guideResource.handler();
        const parsed = JSON.parse(result.contents[0].text);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe("object");
    });

    it("guide contains expected top-level keys", async () => {
        const result = await guideResource.handler();
        const guide = JSON.parse(result.contents[0].text);
        // buildAgentGuide() returns an AgentGuide with known keys
        expect(guide).toHaveProperty("workflow");
        expect(guide).toHaveProperty("template");
    });
});
