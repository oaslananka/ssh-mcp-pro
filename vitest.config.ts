import { defineConfig } from "vitest/config";

const nodeProjectConfig = {
  environment: "node",
  setupFiles: ["test/setup-logs.ts"],
} as const;

const sequentialForkConfig = {
  pool: "forks",
  maxWorkers: 1,
  fileParallelism: false,
} as const;

export default defineConfig({
  test: {
    reporters: ["default", "junit"],
    outputFile: {
      junit: "test-results/junit.xml",
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          ...nodeProjectConfig,
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          ...nodeProjectConfig,
          ...sequentialForkConfig,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.test.ts"],
          ...nodeProjectConfig,
          ...sequentialForkConfig,
        },
      },
      {
        test: {
          name: "perf",
          include: ["test/perf/**/*.test.ts"],
          testTimeout: 180_000,
          hookTimeout: 60_000,
          ...nodeProjectConfig,
          ...sequentialForkConfig,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/index.ts", "src/server-http.ts", "src/render-http.ts"],
      reporter: ["text", "lcov", "html", "cobertura"],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 90,
        statements: 90,
        "src/remote/**": {
          branches: 75,
          functions: 80,
          lines: 85,
          statements: 85,
        },
      },
    },
  },
});
