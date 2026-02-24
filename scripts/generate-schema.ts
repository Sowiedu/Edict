// =============================================================================
// JSON Schema Generator for Edict AST
// =============================================================================
// Generates a JSON Schema from the TypeScript AST interfaces.
// Usage: npm run generate-schema

import { resolve, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as TJS from "typescript-json-schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Point to the tsconfig
const tsconfig = resolve(projectRoot, "tsconfig.json");

// Build the schema generator
const program = TJS.getProgramFromFiles(
    [resolve(projectRoot, "src/ast/nodes.ts")],
    {
        strict: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        moduleResolution: /* bundler isn't supported by TJS, use node */ undefined,
    },
    projectRoot,
);

const settings: TJS.PartialArgs = {
    required: true,
    noExtraProps: false,
    strictNullChecks: true,
    ref: true,
};

// Generate from EdictModule — the root AST type
const schema = TJS.generateSchema(program, "EdictModule", settings);

if (!schema) {
    console.error("❌ Failed to generate schema for EdictModule");
    process.exit(1);
}

// Write output
const outputDir = resolve(projectRoot, "schema");
mkdirSync(outputDir, { recursive: true });

const outputPath = resolve(outputDir, "edict.schema.json");
writeFileSync(outputPath, JSON.stringify(schema, null, 2) + "\n");

console.log(`✅ Schema written to ${outputPath}`);
