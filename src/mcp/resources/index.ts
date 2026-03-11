// =============================================================================
// Resource barrel export — all declarative MCP resource definitions
// =============================================================================

import type { EdictMcpResource } from "../tool-types.js";
import { schemaResource } from "./schema.js";
import { schemaMinimalResource } from "./schema-minimal.js";
import { examplesResource } from "./examples.js";
import { errorsResource } from "./errors.js";
import { schemaPatchResource } from "./schema-patch.js";
import { supportResource } from "./support.js";

/** All registered MCP resources. Add new resources by creating a file and adding to this array. */
export const ALL_RESOURCES: EdictMcpResource[] = [
    schemaResource,
    schemaMinimalResource,
    examplesResource,
    errorsResource,
    schemaPatchResource,
    supportResource,
];
