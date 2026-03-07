import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        testTimeout: 15_000,
        include: ["tests/**/*.test.ts"],
        // Binaryen WASM modules share global state in worker threads — use forks
        // (separate processes) for isolation. Limit concurrency because WASM tests
        // spawn internal worker threads; too many concurrent forks → CPU starvation → timeouts.
        pool: "forks",
        maxForks: 4,
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: [
                "src/index.ts",
                "src/ast/types.ts",
                "src/mcp/server.ts",
                "src/mcp/create-server.ts",
                // Pure type definitions — no runtime code to cover
                "src/mcp/tool-types.ts",
                "src/codegen/host-adapter.ts",
                // Re-export barrels — actual code tested via canonical imports
                "src/codegen/builtins.ts",
                "src/mcp/tools/index.ts",
                "src/mcp/resources/index.ts",
                "src/mcp/prompt-defs/index.ts",
                // Browser-only stub — not testable in Node runtime
                "src/codegen/browser-host-adapter.ts",
                // Pure types / re-export barrel — no runtime code
                "src/builtins/builtin-types.ts",
                "src/builtins/builtins.ts",
                // Host-domain builtins — require WASM runtime, tested via e2e HTTP programs
                "src/builtins/domains/http.ts",
                // Prompt template ternaries (example ? ast : "{}") always truthy — untestable false branch
                "src/mcp/prompts.ts",
                // Worker-based runner — error/exit/OOM handlers require process-level failures
                "src/codegen/runner.ts",
                // Codegen WASM builders — construct binaryen IR, tested via 27 e2e
                // codegen test files that compile and run real Edict programs.
                // Unit-testing individual binaryen calls isn't practical.
                "src/codegen/closures.ts",
                "src/codegen/imports.ts",
                "src/codegen/hof-generators.ts",
                "src/codegen/compile-calls.ts",
                "src/codegen/compile-data.ts",
                "src/codegen/compile-expr.ts",
                "src/codegen/compile-match.ts",
                "src/codegen/compile-scalars.ts",
                "src/codegen/node-host-adapter.ts",
            ],
            thresholds: {
                branches: 89,
                functions: 98,
                lines: 95,
                statements: 95,
            },
        },
    },
});
