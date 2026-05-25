import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readText(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

interface PerfBaseline {
  readonly schemaVersion: 1;
  readonly thresholdMultiplier: number;
  readonly benchmarks: {
    readonly procExec: { readonly samples: number; readonly p99Ms: number };
    readonly sessionOpen: { readonly samples: number; readonly p99Ms: number };
    readonly streamingThroughput: { readonly bytes: number; readonly bytesPerSecond: number };
  };
}

describe("performance regression gate configuration", () => {
  test("declares perf scripts and autocannon dependency", () => {
    const packageJson = readJson<{
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    }>("package.json");

    expect(packageJson.devDependencies.autocannon).toMatch(/^\^7\./u);
    expect(packageJson.scripts["test:perf"]).toBe("vitest run --project perf");
    expect(packageJson.scripts["test:perf:baseline"]).toBe(
      "WRITE_BASELINE=true pnpm run test:perf",
    );
  });

  test("commits a baseline with SSH benchmark thresholds", () => {
    const baseline = readJson<PerfBaseline>("test/perf/baseline.json");

    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.thresholdMultiplier).toBe(1.2);
    expect(baseline.benchmarks.procExec).toEqual(
      expect.objectContaining({
        samples: 100,
        p99Ms: expect.any(Number),
      }),
    );
    expect(baseline.benchmarks.sessionOpen).toEqual(
      expect.objectContaining({
        samples: 50,
        p99Ms: expect.any(Number),
      }),
    );
    expect(baseline.benchmarks.streamingThroughput).toEqual(
      expect.objectContaining({
        bytes: 10 * 1024 * 1024,
        bytesPerSecond: expect.any(Number),
      }),
    );
  });

  test("adds a weekly schedule-only CI perf job", () => {
    const workflow = readText(".github/workflows/ci.yml");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("perf:");
    expect(workflow).toContain("github.event_name == 'schedule'");
    expect(workflow).toContain("pnpm run test:perf");
  });
});
