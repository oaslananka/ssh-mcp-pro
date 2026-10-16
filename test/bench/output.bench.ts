import { bench, describe } from "vitest";
import { MetricsCollector } from "../../src/metrics.js";
import { formatStreamOutput, type StreamChunk } from "../../src/streaming.js";

const chunks: StreamChunk[] = Array.from({ length: 1_000 }, (_, index) => ({
  type: index % 5 === 0 ? "stderr" : "stdout",
  data: `line ${index}: ${"x".repeat(64)}\n`,
  timestamp: index,
}));
chunks.push({ type: "exit", code: 0, timestamp: 1_000 });

const metrics = new MetricsCollector();
for (let index = 0; index < 100; index++) {
  metrics.recordSessionCreated();
  metrics.recordCommand(index * 3, index % 7 !== 0);
  metrics.recordFileRead(index * 128);
  metrics.recordTransfer(index % 2 === 0 ? "upload" : "download", index * 1024);
  metrics.recordPolicyDecision(index % 3 !== 0, index % 4 === 0 ? "explain" : "enforce");
}

describe("output formatting", () => {
  bench("formatStreamOutput 1000 chunks", () => {
    formatStreamOutput(chunks);
  });

  bench("MetricsCollector.exportPrometheus", () => {
    metrics.exportPrometheus();
  });

  bench("MetricsCollector record events", () => {
    const collector = new MetricsCollector();
    for (let index = 0; index < 100; index++) {
      collector.recordCommand(index, index % 2 === 0);
      collector.recordFileWrite(index * 64);
    }
  });
});
