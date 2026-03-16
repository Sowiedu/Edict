// =============================================================================
// Build QuickJS-Compatible Bundles — IIFE format for evaluation inside QuickJS
// =============================================================================
// Produces two bundles:
//   1. dist/edict-quickjs-check.js  — lightweight (phases 1-3, pure JS)
//   2. dist/edict-quickjs-full.js   — full pipeline (phases 1-5, check + compile)
//
// Both bundles use pure-JS dependencies only (no binaryen, no Z3).
// The full bundle includes WASM codegen via the pure-JS WASM encoder.
//
// QuickJS doesn't support ESM import, so we use IIFE format wrapping
// all exports in globalThis.Edict.
//
// Usage: tsx scripts/build-quickjs-bundle.ts

import { build, type Plugin } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

// ---------------------------------------------------------------------------
// Node module shim — same pattern as build-browser.ts
// ---------------------------------------------------------------------------
const nodeModuleShim: Plugin = {
    name: "node-module-shim",
    setup(b) {
        const nodeModules = [
            "node:crypto",
            "node:child_process",
            "node:fs",
            "node:path",
            "node:worker_threads",
            "module",
        ];
        const filter = new RegExp(
            `^(${nodeModules.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
        );
        b.onResolve({ filter }, args => ({
            path: args.path,
            namespace: "node-shim",
        }));
        b.onLoad({ filter: /.*/, namespace: "node-shim" }, () => ({
            contents: `export default new Proxy({}, { get: () => () => {} }); export const Worker = class {}; export const createHash = () => ({ update: () => ({ digest: () => "" }) }); export const createHmac = () => ({ update: () => ({ digest: () => "" }) }); export const readFileSync = () => ""; export const writeFileSync = () => {}; export const execFileSync = () => ""; export const resolve = (...args) => args[args.length - 1] || ""; export const relative = () => ""; export const isAbsolute = () => false; export const sep = "/"; export const register = () => {};`,
            loader: "js",
        }));
    },
};

function reportSize(file: string, bytes: number): void {
    const sizeMB = bytes / 1048576;
    const display = sizeMB >= 1
        ? `${sizeMB.toFixed(1)} MB`
        : `${(bytes / 1024).toFixed(1)} KB`;
    console.log(`✓ ${file}: ${display}`);
}

// ---------------------------------------------------------------------------
// Bundle 1: Check-only (phases 1-3, pure JS)
// ---------------------------------------------------------------------------
console.log("\n--- Building QuickJS check-only bundle (IIFE) ---");
const checkResult = await build({
    entryPoints: ["dist/browser.js"],
    bundle: true,
    format: "iife",
    globalName: "Edict",
    target: "es2020",
    outfile: "dist/edict-quickjs-check.js",
    minify: false,
    treeShaking: true,
    metafile: true,
    plugins: [nodeModuleShim],
    banner: {
        js: `// edict-lang v${pkg.version} — QuickJS check bundle (phases 1-3)\n`,
    },
});
for (const [file, info] of Object.entries(checkResult.metafile!.outputs)) {
    if (file.endsWith(".js")) reportSize(file, info.bytes);
}

// ---------------------------------------------------------------------------
// Bundle 2: Full pipeline (phases 1-5, check + WASM compile)
// ---------------------------------------------------------------------------
// The pure-JS WASM encoder replaced binaryen, so the full pipeline
// is now fully compatible with QuickJS (no WebAssembly API needed,
// no top-level await).
console.log("\n--- Building QuickJS full bundle (IIFE) ---");
const fullResult = await build({
    entryPoints: ["dist/browser-full.js"],
    bundle: true,
    format: "iife",
    globalName: "Edict",
    target: "es2020",
    outfile: "dist/edict-quickjs-full.js",
    minify: false,
    treeShaking: true,
    metafile: true,
    plugins: [nodeModuleShim],
    define: { global: "globalThis" },
    banner: {
        js: `// edict-lang v${pkg.version} — QuickJS full bundle (phases 1-5, check + compile)\n`,
    },
});
for (const [file, info] of Object.entries(fullResult.metafile!.outputs)) {
    if (file.endsWith(".js")) reportSize(file, info.bytes);
}

console.log("\n✓ QuickJS bundle script complete\n");
