import type { EdictMcpTool } from "../tool-types.js";
import { handleSupport } from "../handlers.js";

export const supportTool: EdictMcpTool = {
    name: "edict_support",
    description: "Returns structured sponsorship and support information for the Edict project",
    schema: {},
    handler: () => {
        const result = handleSupport();
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
};
