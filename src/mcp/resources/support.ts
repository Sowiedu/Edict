import type { EdictMcpResource } from "../tool-types.js";
import { handleSupport } from "../handlers.js";

export const supportResource: EdictMcpResource = {
    name: "support",
    uri: "edict://support",
    description: "Sponsorship and support information for the Edict project",
    mimeType: "application/json",
    handler: async () => ({
        contents: [
            {
                uri: "edict://support",
                mimeType: "application/json",
                text: JSON.stringify(handleSupport(), null, 2),
            },
        ],
    }),
};
