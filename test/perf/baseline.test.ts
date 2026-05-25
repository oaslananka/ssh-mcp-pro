import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { createContainer, type AppContainer } from "../../src/container.js";
import { createProcessService } from "../../src/process.js";
import { createStreamingService } from "../../src/streaming.js";

const require = createRequire(import.meta.url);
const autocannon = require("autocannon") as unknown;

const TEST_SSH_HOST = process.env.TEST_SSH_HOST || "localhost";
const TEST_SSH_PORT = Number.parseInt(process.env.TEST_SSH_PORT || "2222", 10);
const TEST_SSH_USER = process.env.TEST_SSH_USER || "testuser";
const TEST_SSH_PASS = process.env.TEST_SSH_PASS || "testpass";
const WRITE_BASELINE = process.env.WRITE_BASELINE === "true";
const BASELINE_PATH = path.resolve(import.meta.dirname, "baseline.json");
const THRESHOLD_MULTIPLIER = 1.2;
const PROC_EXEC_SAMPLES = 100;
const SESSION_OPEN_SAMPLES = 50;
const STREAMING_BYTES = 10 * 1024 * 1024;
const PROC_EXEC_P99_BASELINE_FLOOR_MS = 300;
const SESSION_OPEN_P99_BASELINE_FLOOR_MS = 1_500;
const STREAMING_BASELINE_BYTES_PER_SECOND_CEILING = 2 * 1024 * 1024;

interface LatencyStats {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface StreamingStats {
  bytes: number;
  durationMs: number;
  bytesPerSecond: number;
}

interface PerfBaseline {
  schemaVersion: 1;
  thresholdMultiplier: number;
  generatedAt: string;
  benchmarks: {
    procExec: LatencyStats;
    sessionOpen: LatencyStats;
    streamingThroughput: StreamingStats;
  };
}

function createPerfContainer(): AppContainer {
  return createContainer({
    maxCommandOutputBytes: STREAMING_BYTES + 1024,
    maxStreamChunks: 65_536,
    commandTimeoutMs: 120_000,
    security: {
      allowRootLogin: true,
      hostKeyPolicy: "insecure",
      knownHostsPath: "",
      allowedCiphers: [],
    },
    policy: {
      mode: "enforce",
      allowRawSudo: true,
      allowDestructiveCommands: true,
      allowDestructiveFs: true,
      allowRootLogin: true,
      allowedHosts: [],
      commandAllow: [],
      commandDeny: [],
      pathAllowPrefixes: ["/tmp"],
      pathDenyPrefixes: [],
      localPathAllowPrefixes: [],
      localPathDenyPrefixes: [],
      tunnelAllowBindHosts: ["127.0.0.1", "localhost", "::1"],
      tunnelDenyBindHosts: ["0.0.0.0", "::"],
      tunnelAllowRemoteHosts: [],
      tunnelDenyRemoteHosts: [],
      tunnelAllowPorts: [],
      tunnelDenyPorts: [],
    },
  });
}

async function destroyContainer(container: AppContainer): Promise<void> {
  container.rateLimiter.destroy();
  await container.sessionManager.destroy();
}

async function openFixtureSession(container: AppContainer): Promise<string> {
  const session = await container.sessionManager.openSession({
    host: TEST_SSH_HOST,
    port: TEST_SSH_PORT,
    username: TEST_SSH_USER,
    password: TEST_SSH_PASS,
    auth: "password",
    hostKeyPolicy: "insecure",
  });
  return session.sessionId;
}

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return Number(sorted[index]?.toFixed(2) ?? 0);
}

function latencyStats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

async function measureLatency(samples: number, run: () => Promise<void>): Promise<LatencyStats> {
  const durations: number[] = [];
  for (let index = 0; index < samples; index++) {
    const startedAt = performance.now();
    await run();
    durations.push(performance.now() - startedAt);
  }
  return latencyStats(durations);
}

async function measureProcExec(): Promise<LatencyStats> {
  const container = createPerfContainer();
  const processService = createProcessService({
    sessionManager: container.sessionManager,
    config: container.config.getAll(),
    policy: container.policy,
  });
  const sessionId = await openFixtureSession(container);

  try {
    return await measureLatency(PROC_EXEC_SAMPLES, async () => {
      const result = await processService.execCommand(sessionId, "printf perf-ok");
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("perf-ok");
    });
  } finally {
    await destroyContainer(container);
  }
}

async function measureSessionOpen(): Promise<LatencyStats> {
  const container = createPerfContainer();

  try {
    return await measureLatency(SESSION_OPEN_SAMPLES, async () => {
      const sessionId = await openFixtureSession(container);
      await container.sessionManager.closeSession(sessionId);
    });
  } finally {
    await destroyContainer(container);
  }
}

async function measureStreamingThroughput(): Promise<StreamingStats> {
  const container = createPerfContainer();
  const streamingService = createStreamingService({
    sessionManager: container.sessionManager,
    config: container.config.getAll(),
    policy: container.policy,
  });
  const sessionId = await openFixtureSession(container);
  const command = `head -c ${STREAMING_BYTES} /dev/zero | tr '\\0' 'x'`;
  const startedAt = performance.now();

  try {
    const result = await streamingService.execWithStreaming({
      sessionId,
      command,
      timeoutMs: 120_000,
    });
    const durationMs = performance.now() - startedAt;
    const bytes = Buffer.byteLength(result.stdout, "utf8");

    expect(result.code).toBe(0);
    expect(result.truncated).toBe(false);
    expect(bytes).toBe(STREAMING_BYTES);

    return {
      bytes,
      durationMs: Number(durationMs.toFixed(2)),
      bytesPerSecond: Math.round(bytes / (durationMs / 1000)),
    };
  } finally {
    await destroyContainer(container);
  }
}

function readBaseline(): PerfBaseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as PerfBaseline;
}

function writeBaseline(baseline: PerfBaseline): void {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function withLatencyP99Floor(stats: LatencyStats, p99FloorMs: number): LatencyStats {
  return {
    ...stats,
    p99Ms: Math.max(stats.p99Ms, p99FloorMs),
  };
}

function withThroughputCeiling(stats: StreamingStats): StreamingStats {
  const bytesPerSecond = Math.max(
    1,
    Math.min(stats.bytesPerSecond, STREAMING_BASELINE_BYTES_PER_SECOND_CEILING),
  );
  return {
    ...stats,
    durationMs: Number(((stats.bytes / bytesPerSecond) * 1000).toFixed(2)),
    bytesPerSecond,
  };
}

function stabilizeBaseline(current: PerfBaseline): PerfBaseline {
  return {
    ...current,
    benchmarks: {
      procExec: withLatencyP99Floor(current.benchmarks.procExec, PROC_EXEC_P99_BASELINE_FLOOR_MS),
      sessionOpen: withLatencyP99Floor(
        current.benchmarks.sessionOpen,
        SESSION_OPEN_P99_BASELINE_FLOOR_MS,
      ),
      streamingThroughput: withThroughputCeiling(current.benchmarks.streamingThroughput),
    },
  };
}

function assertLatencyWithinBaseline(
  name: string,
  current: LatencyStats,
  baseline: LatencyStats,
  thresholdMultiplier: number,
) {
  const threshold = baseline.p99Ms * thresholdMultiplier;
  expect(
    current.p99Ms,
    `${name} p99 ${current.p99Ms}ms exceeded baseline ${baseline.p99Ms}ms by more than ${Math.round(
      (thresholdMultiplier - 1) * 100,
    )}%`,
  ).toBeLessThanOrEqual(threshold);
}

function assertThroughputWithinBaseline(
  current: StreamingStats,
  baseline: StreamingStats,
  thresholdMultiplier: number,
) {
  const threshold = baseline.bytesPerSecond / thresholdMultiplier;
  expect(
    current.bytesPerSecond,
    `streaming throughput ${current.bytesPerSecond} B/s fell below baseline ${baseline.bytesPerSecond} B/s by more than ${Math.round(
      (thresholdMultiplier - 1) * 100,
    )}%`,
  ).toBeGreaterThanOrEqual(threshold);
}

describe("SSH performance baseline", () => {
  test("autocannon benchmark dependency is available", () => {
    expect(typeof autocannon).toBe("function");
  });

  test("measures SSH fixture latency and checks the committed baseline", async () => {
    const current: PerfBaseline = {
      schemaVersion: 1,
      thresholdMultiplier: THRESHOLD_MULTIPLIER,
      generatedAt: new Date().toISOString(),
      benchmarks: {
        procExec: await measureProcExec(),
        sessionOpen: await measureSessionOpen(),
        streamingThroughput: await measureStreamingThroughput(),
      },
    };

    if (WRITE_BASELINE) {
      writeBaseline(stabilizeBaseline(current));
      return;
    }

    const baseline = readBaseline();
    expect(current.benchmarks.procExec.samples).toBe(baseline.benchmarks.procExec.samples);
    expect(current.benchmarks.sessionOpen.samples).toBe(baseline.benchmarks.sessionOpen.samples);
    expect(current.benchmarks.streamingThroughput.bytes).toBe(
      baseline.benchmarks.streamingThroughput.bytes,
    );
    assertLatencyWithinBaseline(
      "proc_exec",
      current.benchmarks.procExec,
      baseline.benchmarks.procExec,
      baseline.thresholdMultiplier,
    );
    assertLatencyWithinBaseline(
      "ssh_open_session",
      current.benchmarks.sessionOpen,
      baseline.benchmarks.sessionOpen,
      baseline.thresholdMultiplier,
    );
    assertThroughputWithinBaseline(
      current.benchmarks.streamingThroughput,
      baseline.benchmarks.streamingThroughput,
      baseline.thresholdMultiplier,
    );
  });
});
