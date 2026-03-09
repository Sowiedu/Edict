import { z } from "zod";
import type { EdictMcpTool } from "../tool-types.js";
import { handleGenerateTests } from "../handlers.js";

export const generateTestsTool: EdictMcpTool = {
    name: "edict_generate_tests",
    description: "Auto-generate structured test cases from Z3-verified contracts. For proven contracts, extracts boundary input values and expected outputs from Z3 models. For failing contracts, extracts counterexample inputs as regression tests. Returns an array of GeneratedTest objects — each with function name, input values, expected output, and source (boundary/counterexample). Use this to get free tests from formal specifications without writing them manually.",
    schema: {
        ast: z.unknown().describe("The Edict program AST (module) — same format as edict_check"),
    },
    handler: async ({ ast }) => {
        try {
            const result = await handleGenerateTests(ast);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (err: unknown) {
            return {
                content: [{ type: "text" as const, text: String(err) }],
                isError: true,
            };
        }
    },
};
