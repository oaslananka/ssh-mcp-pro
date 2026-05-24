import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/setup-logs.ts"],
    reporters: ["default", "junit"],
    outputFile: {
      junit: "test-results/junit.xml",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/index.ts",
        "src/server-http.ts",
        "src/render-http.ts",
        "src/remote/agent-executor.ts",
        "src/remote/agent-cli.ts",
        "src/remote/config.ts",
        "src/remote/control-plane.ts",
        "src/remote/mcp-tools.ts",
        "src/remote/store.ts",
        "src/remote/util.ts",
        "src/remote/websocket.ts",
      ],
      reporter: ["text", "lcov", "html", "cobertura"],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 90,
        statements: 90,
      },
    },
  },
});
