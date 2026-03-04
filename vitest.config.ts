import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        include: ["tests/**/*.test.ts"],
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
