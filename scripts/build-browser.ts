// =============================================================================
// Build Browser Bundles — esbuild script for browser-compatible ESM
// =============================================================================
// Produces two bundles:
//   1. dist/browser.bundle.js       — lightweight (phases 1-3, lint, patch, compose)
//   2. dist/browser-full.bundle.js  — full pipeline (+ binaryen codegen, Z3 contracts, WASM execution)
//
// Usage: tsx scripts/build-browser.ts [--full-only]

import { build, type BuildResult } from "esbuild";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
const fullOnly = process.argv.includes("--full-only");

function reportSize(result: BuildResult): void {
    const outputs = result.metafile!.outputs;
    for (const [file, info] of Object.entries(outputs)) {
        if (file.endsWith(".js")) {
            const sizeMB = info.bytes / 1048576;
            const display = sizeMB >= 1
                ? `${sizeMB.toFixed(1)} MB`
                : `${(info.bytes / 1024).toFixed(1)} KB`;
            console.log(`✓ ${file}: ${display}`);
        }
    }
}

function verifyNoNodeImports(bundlePath: string): void {
    const content = readFileSync(bundlePath, "utf-8");
    // Match real import/require statements, not string literals inside template code.
    // Real imports start with `import ... from "node:..."` or `require("node:...")`.
    // The inline worker script in verify.ts contains `from "node:worker_threads"`
    // inside a string literal — that's not a real import.
    const lines = content.split("\n");
    const nodeImportLines = lines.filter(line => {
        // Only flag column-0 statements — indented lines are inside template
        // literals (e.g., verify.ts's inline worker script).
        if (line.length === 0 || line[0] === " " || line[0] === "\t") return false;
        const trimmed = line.trim();
        return (
            (trimmed.startsWith("import ") && trimmed.includes('"node:')) ||
            trimmed.includes('require("node:')
        );
    });
    if (nodeImportLines.length > 0) {
        console.error(`✗ ${bundlePath} contains ${nodeImportLines.length} Node.js imports — this is a bug!`);
        for (const line of nodeImportLines) console.error(`  → ${line.trim()}`);
        process.exit(1);
    } else {
        console.log(`✓ ${bundlePath}: no Node.js imports detected`);
    }
}

// ---------------------------------------------------------------------------
// Bundle 1: Lightweight browser (phases 1-3)
// ---------------------------------------------------------------------------
if (!fullOnly) {
    console.log("\n--- Building lightweight browser bundle ---");
    const lightResult = await build({
        entryPoints: ["dist/browser.js"],
        bundle: true,
        format: "esm",
        target: "es2022",
        outfile: "dist/browser.bundle.js",
        sourcemap: true,
        minify: false,
        treeShaking: true,
        metafile: true,
        external: ["binaryen"],
        banner: {
            js: `// edict-lang v${pkg.version} — browser bundle (phases 1-3, lint, patch, compose)\n// https://github.com/Sowiedu/Edict\n`,
        },
    });
    reportSize(lightResult);
    verifyNoNodeImports("dist/browser.bundle.js");
}

// ---------------------------------------------------------------------------
// Bundle 2: Full browser (phases 1-5 + execution)
// ---------------------------------------------------------------------------
console.log("\n--- Building full browser bundle ---");

// Node modules that appear on dead code paths in the browser bundle.
// Instead of externalizing (which leaves unresolvable import stubs),
// we shim them to empty modules. The shimmed exports are never called:
//   - registry.ts → NodeHostAdapter default (browser passes BrowserHostAdapter)
//   - verify.ts → node:worker_threads (browser uses useWorker: false)
//   - hash.ts → node:crypto (cached results bypass hash computation)
const nodeModuleShim: import("esbuild").Plugin = {
    name: "node-module-shim",
    setup(build) {
        const nodeModules = [
            "node:crypto",
            "node:child_process",
            "node:fs",
            "node:path",
            "node:worker_threads",
            // binaryen's Emscripten code does `import("module")` for Node's createRequire.
            // Runtime Node-detection branch — dead code in browser context.
            "module",
        ];
        const filter = new RegExp(`^(${nodeModules.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
        build.onResolve({ filter }, args => ({
            path: args.path,
            namespace: "node-shim",
        }));
        build.onLoad({ filter: /.*/, namespace: "node-shim" }, () => ({
            // Export a Proxy that returns no-op functions for any property access.
            // This ensures destructured imports like { Worker } don't throw.
            contents: `export default new Proxy({}, { get: () => () => {} }); export const Worker = class {}; export const createHash = () => ({ update: () => ({ digest: () => "" }) }); export const createHmac = () => ({ update: () => ({ digest: () => "" }) }); export const readFileSync = () => ""; export const writeFileSync = () => {}; export const execFileSync = () => ""; export const resolve = (...args) => args[args.length - 1] || ""; export const relative = () => ""; export const isAbsolute = () => false; export const sep = "/"; export const register = () => {};`,
            loader: "js",
        }));
    },
};

const fullResult = await build({
    entryPoints: ["dist/browser-full.js"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: "dist/browser-full.bundle.js",
    sourcemap: true,
    minify: false,
    treeShaking: true,
    metafile: true,
    plugins: [nodeModuleShim],
    // z3-solver's browser.js uses `global.initZ3` — map to globalThis for browsers
    define: { global: "globalThis" },
    banner: {
        js: `// edict-lang v${pkg.version} — browser-full bundle (phases 1-5, compile, execute, Z3 contracts)\n// https://github.com/Sowiedu/Edict\n`,
    },
});
reportSize(fullResult);
verifyNoNodeImports("dist/browser-full.bundle.js");

// ---------------------------------------------------------------------------
// Copy Z3 WASM assets — required for contract verification in the browser
// ---------------------------------------------------------------------------
console.log("\n--- Copying Z3 assets ---");
const z3Dir = resolve("node_modules/z3-solver/build");
for (const file of ["z3-built.js", "z3-built.wasm"]) {
    const src = resolve(z3Dir, file);
    const dst = resolve("dist", file);
    if (existsSync(src)) {
        copyFileSync(src, dst);
        const sizeMB = readFileSync(dst).length / 1048576;
        const display = sizeMB >= 1
            ? `${sizeMB.toFixed(1)} MB`
            : `${(readFileSync(dst).length / 1024).toFixed(1)} KB`;
        console.log(`✓ dist/${file}: ${display}`);
    } else {
        console.warn(`⚠ ${src} not found — Z3 contract verification will not work in browser`);
    }
}
