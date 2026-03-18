// =============================================================================
// MCP Server — declarative tool/resource/prompt registration
// =============================================================================
// Each tool, resource, and prompt is defined as a declarative object in its
// own file. This module imports them via barrel exports and registers them
// with the MCP SDK. To add a new tool, create a file in tools/ and add it
// to tools/index.ts — no changes to this file needed.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";

import { ALL_TOOLS } from "./tools/index.js";
import { ALL_RESOURCES } from "./resources/index.js";
import { ALL_PROMPTS } from "./prompt-defs/index.js";
import { EDICT_INSTRUCTIONS } from "./agent-guide.js";

/** Read version from package.json. Falls back gracefully in CJS bundles
 *  (e.g. Smithery scanner) where `import.meta.url` is unavailable. */
function getVersion(): string {
    try {
        const req = createRequire(import.meta.url);
        return (req("../../package.json") as { version: string }).version;
    } catch {
        return "0.0.0";
    }
}

// =============================================================================
// Server setup
// =============================================================================

export function createEdictServer(): McpServer {
    const server = new McpServer({
        name: "edict-compiler",
        version: getVersion(),
    }, {
        instructions: EDICT_INSTRUCTIONS,
    });

    // -------------------------------------------------------------------------
    // Tools — auto-register from declarative definitions
    // -------------------------------------------------------------------------
    for (const tool of ALL_TOOLS) {
        if (tool.description) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            server.tool(tool.name, tool.description, tool.schema, tool.handler as any);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            server.tool(tool.name, tool.schema, tool.handler as any);
        }
    }

    // -------------------------------------------------------------------------
    // Resources — auto-register from declarative definitions
    // -------------------------------------------------------------------------
    for (const resource of ALL_RESOURCES) {
        server.resource(
            resource.name,
            resource.uri,
            { description: resource.description, mimeType: resource.mimeType },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resource.handler as any,
        );
    }

    // -------------------------------------------------------------------------
    // Prompts — auto-register from declarative definitions
    // -------------------------------------------------------------------------
    for (const prompt of ALL_PROMPTS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        server.prompt(prompt.name, prompt.description, prompt.schema, prompt.handler as any);
    }

    return server;
}
