// =============================================================================
// Build Browser Bundle — esbuild script for browser-compatible ESM
// =============================================================================
// Bundles dist/browser.js (tsc output) into a single self-contained ESM file.
// Zero external dependencies — all code including JSON schemas is inlined.
//
// The browser entry point imports only from Node-free modules:
//   - builtin-meta.ts (type metadata) instead of registry.ts (runtime)
//   - No codegen, contracts, or MCP modules
//
// Usage: tsx scripts/build-browser.ts

import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

const result = await build({
    entryPoints: ["dist/browser.js"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: "dist/browser.bundle.js",
    sourcemap: true,
    minify: false, // Keep readable for debugging; consumers can minify
    treeShaking: true,
    metafile: true,
    // binaryen is externalized because the array domain's HOF builtins
    // (array_map, array_filter, etc.) co-locate WASM generator references
    // with type metadata. The generators are never invoked from browser
    // context — they only run during WASM codegen (Phase 5).
    external: ["binaryen"],
    banner: {
        js: `// edict-lang v${pkg.version} — browser bundle (phases 1-3, lint, patch, compose)\n// https://github.com/Sowiedu/Edict\n`,
    },
});

// Report bundle size
const outputs = result.metafile!.outputs;
for (const [file, info] of Object.entries(outputs)) {
    if (file.endsWith(".js")) {
        const sizeKB = (info.bytes / 1024).toFixed(1);
        console.log(`✓ ${file}: ${sizeKB} KB`);
    }
}

// Verify no Node imports leaked into the bundle
const bundleContent = readFileSync("dist/browser.bundle.js", "utf-8");
const nodeImportMatches = bundleContent.match(/from\s+"node:/g);
if (nodeImportMatches) {
    console.error(`✗ Bundle contains ${nodeImportMatches.length} Node.js imports — this is a bug!`);
    process.exit(1);
} else {
    console.log("✓ No Node.js imports detected in bundle");
}
