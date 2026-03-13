// =============================================================================
// Tool barrel export — all declarative MCP tool definitions
// =============================================================================

import type { EdictMcpTool } from "../tool-types.js";
import { schemaTool } from "./schema.js";
import { versionTool } from "./version.js";
import { examplesTool } from "./examples.js";
import { validateTool } from "./validate.js";
import { checkTool } from "./check.js";
import { compileTool } from "./compile.js";
import { runTool } from "./run.js";
import { patchTool } from "./patch.js";
import { errorsTool } from "./errors.js";
import { lintTool } from "./lint.js";
import { composeTool } from "./compose.js";
import { debugTool } from "./debug.js";
import { exportTool } from "./export.js";
import { importSkillTool } from "./import_skill.js";
import { packageSkillTool } from "./package_skill.js";
import { invokeSkillTool } from "./invoke_skill.js";
import { generateTestsTool } from "./generate_tests.js";
import { explainTool } from "./explain.js";
import { replayTool } from "./replay.js";
import { supportTool } from "./support.js";
import { deployTool } from "./deploy.js";

/** All registered MCP tools. Add new tools by creating a file and adding to this array. */
export const ALL_TOOLS: EdictMcpTool[] = [
    schemaTool,
    versionTool,
    examplesTool,
    validateTool,
    checkTool,
    compileTool,
    runTool,
    patchTool,
    errorsTool,
    lintTool,
    composeTool,
    debugTool,
    exportTool,
    importSkillTool,
    packageSkillTool,
    invokeSkillTool,
    generateTestsTool,
    explainTool,
    replayTool,
    supportTool,
    deployTool,
];
