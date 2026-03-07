import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        include: ["tests/**/*.test.ts"],
        // Binaryen WASM modules share global state in worker threads — use forks
        // (separate processes) for isolation. Limit concurrency because WASM tests
        // spawn internal worker threads; too many concurrent forks → CPU starvation → timeouts.
        pool: "forks",
        poolOptions: { forks: { maxForks: 4 } },
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/index.ts", "src/ast/types.ts", "src/mcp/server.ts", "src/mcp/create-server.ts"],
            thresholds: {
                branches: 89,
                functions: 98,
                lines: 95,
                statements: 95,
            },
        },
    },
});
