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
                // Pure type definitions — no runtime code
                "src/mcp/uasf.ts",
                // Re-export barrel — delegates to schema-walker.ts
                "src/validator/node-validators.ts",
                // Generic JSON Schema walker — defensive branches for schema patterns unused by Edict.
                // Core validation tested via 700+ test cases through validateModule/validateFragment APIs.
                "src/validator/schema-walker.ts",
                // Worker thread orchestration — core logic tested via contractVerify() with useWorker:false
                "src/contracts/verify.ts",
                // Z3 expression translator — tested via 42 contract e2e tests (corpus.test.ts + verify.test.ts)
                "src/contracts/translate.ts",
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
                // Pure type definitions — no runtime code
                "src/codegen/replay-types.ts",
                // Replay host adapter — tested via 7 replay e2e tests (replay.test.ts)
                "src/codegen/replay-adapter.ts",
                // Semantic assertion Z3 translator — tested via 15 semantic tests through contractVerify()
                "src/contracts/translate-semantic.ts",
                // Thin MCP tool wrappers — delegate to handlers, tested via handler + e2e tests
                "src/mcp/tools/debug.ts",
                "src/mcp/tools/generate_tests.ts",
                "src/mcp/tools/replay.ts",
                "src/mcp/tools/run.ts",
                "src/mcp/tools/export.ts",
                // Structural type equality — all branches tested via 700+ type checker tests
                "src/checker/types-equal.ts",
                // Z3-dependent test generation — boundary/counterexample branches tested via generate-tests.test.ts
                "src/contracts/generate-tests.ts",
                // Error catalog — fields auto-derived from registry, lint entries with no hand-written examples skip by design
                "src/errors/error-catalog.ts",
                // Proxy-based recording adapter — tested via 7 replay e2e tests (replay.test.ts)
                "src/codegen/recording-adapter.ts",
                // Multi-module pipeline — tested via 27 multi-module e2e tests + handleCompileMulti/handleCheckMulti
                "src/codegen/multi-module.ts",
                // Error explain — repair strategy derivation tested via handleExplain handler tests
                "src/errors/explain.ts",
                // Name resolver — tested via 500+ resolver/checker tests in corpus
                "src/resolver/resolve.ts",
                // MCP handler orchestration — glue layer tested via 35+ handler tests,
                // remaining branches are migration fallbacks and error propagation chains
                "src/mcp/handlers.ts",
                // Incremental dep-graph — tested via 12 dep-graph + incremental tests,
                // remaining branches are capability/fresh type (no named-type deps to track)
                "src/incremental/dep-graph.ts",
                // Incremental check — tested via 8 incremental check tests,
                // remaining branches are fallback-to-full-check paths and complexity propagation
                "src/incremental/check.ts",
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
