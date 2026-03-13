import { z } from "zod";
import type { EdictMcpTool } from "../tool-types.js";
import { handleDeploy } from "../handlers.js";

export const deployTool: EdictMcpTool = {
    name: "edict_deploy",
    description: "Deploy an Edict program to a target. Runs the full pipeline (validate → check → compile) then packages for the specified target. Targets: 'wasm_binary' (returns WASM + metadata), 'cloudflare' (generates Worker bundle).",
    schema: {
        ast: z.any().describe("The Edict JSON AST to deploy"),
        target: z.string().describe("Deploy target: 'wasm_binary' or 'cloudflare'"),
        config: z.object({
            name: z.string().optional().describe("Deployment name (used as Worker name for cloudflare target)"),
            route: z.string().optional().describe("Route pattern for cloudflare target (e.g., '/api/process')"),
            compatibilityDate: z.string().optional().describe("Wrangler compatibility date for cloudflare target"),
            kvNamespaces: z.array(z.object({
                binding: z.string(),
                id: z.string(),
            })).optional().describe("KV namespace bindings for cloudflare target"),
        }).optional().describe("Target-specific configuration"),
    },
    handler: async ({ ast, target, config }) => {
        const result = await handleDeploy(ast, target, config);
        if (result.ok) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } else {
            return {
                content: [
                    { type: "text" as const, text: JSON.stringify({ errors: result.errors }, null, 2) },
                ],
                isError: true,
            };
        }
    },
};
