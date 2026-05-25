import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import vitestConfig from "../../vitest.config.js";

interface TestProject {
  test?: {
    name?: string;
    include?: string[];
    pool?: string;
    maxWorkers?: number;
    fileParallelism?: boolean;
    testTimeout?: number;
    hookTimeout?: number;
  };
}

function testConfig() {
  const config = vitestConfig as {
    test?: {
      include?: string[];
      pool?: string;
      poolOptions?: unknown;
      projects?: TestProject[];
    };
  };
  return config.test;
}

function project(name: string) {
  const found = testConfig()?.projects?.find((candidate) => candidate.test?.name === name);
  if (!found) {
    throw new Error(`Missing Vitest project: ${name}`);
  }
  return found.test;
}

describe("Vitest suite pool configuration", () => {
  test("splits test suites into named projects", () => {
    expect(testConfig()?.include).toBeUndefined();
    expect(testConfig()?.pool).toBeUndefined();
    expect(testConfig()?.poolOptions).toBeUndefined();
    expect(testConfig()?.projects?.map((candidate) => candidate.test?.name)).toEqual([
      "unit",
      "integration",
      "e2e",
      "perf",
    ]);
  });

  test("keeps unit tests on default parallel execution", () => {
    expect(project("unit")).toMatchObject({
      include: ["test/unit/**/*.test.ts"],
    });
    expect(project("unit")?.pool).toBeUndefined();
    expect(project("unit")?.maxWorkers).toBeUndefined();
    expect(project("unit")?.fileParallelism).toBeUndefined();
  });

  test("runs integration and e2e suites sequentially in fork workers", () => {
    expect(project("integration")).toMatchObject({
      include: ["test/integration/**/*.test.ts"],
      pool: "forks",
      maxWorkers: 1,
      fileParallelism: false,
    });
    expect(project("e2e")).toMatchObject({
      include: ["test/e2e/**/*.test.ts"],
      pool: "forks",
      maxWorkers: 1,
      fileParallelism: false,
    });
  });

  test("runs perf suites separately with extended timeouts", () => {
    expect(project("perf")).toMatchObject({
      include: ["test/perf/**/*.test.ts"],
      pool: "forks",
      maxWorkers: 1,
      fileParallelism: false,
    });
    expect(project("perf")?.testTimeout).toBe(180_000);
    expect(project("perf")?.hookTimeout).toBe(60_000);
  });

  test("routes package scripts to suite-specific projects", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.test).toContain("--project unit");
    expect(pkg.scripts?.["test:coverage"]).toBe(
      "vitest run --coverage --project unit --project integration --project e2e",
    );
    expect(pkg.scripts?.["test:integration"]).toContain("--project integration");
    expect(pkg.scripts?.["test:e2e"]).toContain("--project e2e");
    expect(pkg.scripts?.["test:perf"]).toContain("--project perf");
  });
});
