import { describe, expect, test } from "vitest";
import { AgentExecutor } from "../../src/remote/agent-executor.js";
import { ManagedProcessRegistry } from "../../src/remote/agent-managed-process.js";
import { generateEd25519PemKeyPair, verifyEnvelope } from "../../src/remote/crypto.js";
import { createAgentPolicy, mergeCustomPolicy } from "../../src/remote/policy.js";
import { listRemoteToolDescriptors } from "../../src/remote/mcp-tools.js";
import type { ActionRequestEnvelope, AgentPolicy, RemoteToolName } from "../../src/remote/types.js";

type ProcessData = {
  process_id: string;
  status: "running" | "exited" | "stopped" | "timed_out" | "failed";
  exit_code?: number | null;
  next_cursor?: number;
  dropped_before_cursor?: number;
  chunks?: Array<{ cursor: number; stream: "stdout" | "stderr"; text: string }>;
};

function request(
  tool: RemoteToolName,
  args: Record<string, unknown>,
  userId = "github:owner-one",
): ActionRequestEnvelope {
  return {
    type: "action.request",
    action_id: "act_" + tool + "_" + Math.random().toString(36).slice(2),
    agent_id: "agt_fixture",
    user_id: userId,
    tool,
    capability: "shell.exec",
    args,
    policy_version: 1,
    issued_at: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    nonce: "fixture-nonce",
    signature: "",
  };
}

function fixture(policy: AgentPolicy = createAgentPolicy("full-admin")) {
  const key = generateEd25519PemKeyPair();
  const executor = new AgentExecutor(policy, key.privateKeyPem);
  const invoke = async (tool: RemoteToolName, args: Record<string, unknown>, userId?: string) => {
    const result = await executor.execute(request(tool, args, userId));
    expect(verifyEnvelope(result as unknown as Record<string, unknown>, key.publicKeyPem)).toBe(
      true,
    );
    return result;
  };
  return { executor, invoke };
}

const interactiveCommand =
  "node -e \"console.log('READY');process.stdin.once('data',d=>{console.log('INPUT:'+d.toString());process.exit(0)})\"";

async function pollUntil(
  invoke: ReturnType<typeof fixture>["invoke"],
  processId: string,
  predicate: (value: ProcessData) => boolean,
  userId?: string,
): Promise<ProcessData> {
  for (let i = 0; i < 75; i++) {
    const result = await invoke("process_read", { process_id: processId, cursor: 0 }, userId);
    expect(result.status, result.message).toBe("ok");
    const data = JSON.parse(result.stdout ?? "{}") as ProcessData;
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("managed process did not reach expected state");
}

describe("managed remote interactive processes", () => {
  test("starts a command, shows its output, sends stdin and reads exit result", async () => {
    const env = fixture();
    try {
      const start = await env.invoke("process_start", {
        command: interactiveCommand,
        max_runtime_seconds: 20,
      });
      expect(start.status).toBe("ok");
      const { process_id: pid } = JSON.parse(start.stdout ?? "{}") as ProcessData;
      expect(pid).toMatch(/^proc_[a-z0-9_-]+$/u);
      const ready = await pollUntil(env.invoke, pid, (x) =>
        (x.chunks ?? []).some((c) => c.text.includes("READY")),
      );
      expect(ready.status).toBe("running");
      const sent = await env.invoke("process_input", { process_id: pid, input: "hello\n" });
      expect(sent.status).toBe("ok");
      const final = await pollUntil(
        env.invoke,
        pid,
        (x) =>
          x.status === "exited" && (x.chunks ?? []).some((c) => c.text.includes("INPUT:hello")),
      );
      expect(final.exit_code).toBe(0);
      expect(final.next_cursor).toBeGreaterThan(0);
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("owner of a process is enforced across read, input and stop", async () => {
    const env = fixture();
    try {
      const start = await env.invoke(
        "process_start",
        { command: interactiveCommand },
        "github:one",
      );
      const { process_id: pid } = JSON.parse(start.stdout ?? "{}") as ProcessData;
      for (const [tool, args] of [
        ["process_read", { process_id: pid }],
        ["process_input", { process_id: pid, input: "wrong\n" }],
        ["process_stop", { process_id: pid }],
      ] as const) {
        const result = await env.invoke(tool, args, "github:other");
        expect(result).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
      }
      const read = await env.invoke("process_read", { process_id: pid }, "github:one");
      expect(read.status).toBe("ok");
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("does not expose managed process tools without shell.exec", async () => {
    const names = listRemoteToolDescriptors(["agents.read"]).map((tool) => tool.name);
    expect(names).not.toContain("process_start");
    const enabled = listRemoteToolDescriptors(["shell.exec"]);
    for (const name of ["process_start", "process_read", "process_input", "process_stop"]) {
      expect(enabled.map((tool) => tool.name)).toContain(name);
    }
    const denied = fixture(createAgentPolicy("read-only"));
    try {
      const result = await denied.invoke("process_start", { command: interactiveCommand });
      expect(result).toMatchObject({ status: "error", error_code: "CAPABILITY_DENIED" });
    } finally {
      denied.executor.dispose();
    }
  });

  test("rejects oversized input and invalid runtime limits", async () => {
    const env = fixture();
    try {
      for (const max_runtime_seconds of [0, -1, 5000, "infinite"]) {
        const result = await env.invoke("process_start", {
          command: "echo READY",
          max_runtime_seconds,
        });
        expect(result).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
      }
      const start = await env.invoke("process_start", { command: interactiveCommand });
      const { process_id: pid } = JSON.parse(start.stdout ?? "{}") as ProcessData;
      const huge = await env.invoke("process_input", { process_id: pid, input: "x".repeat(5000) });
      expect(huge).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("limits concurrent commands per agent to prevent process floods", async () => {
    const env = fixture();
    try {
      for (let i = 0; i < 4; i++) {
        const started = await env.invoke("process_start", { command: interactiveCommand });
        expect(started.status).toBe("ok");
      }
      const overflow = await env.invoke("process_start", { command: interactiveCommand });
      expect(overflow).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("bounded cursor reads report dropped output without unbounded buffering", async () => {
    const env = fixture();
    try {
      const start = await env.invoke("process_start", {
        command: 'node -e "process.stdout.write(' + "'z'" + '.repeat(140000))"',
      });
      expect(start.status).toBe("ok");
      const pid = (JSON.parse(start.stdout ?? "{}") as ProcessData).process_id;
      const done = await pollUntil(env.invoke, pid, (x) => x.status !== "running");
      expect(done.status).toBe("exited");
      const result = await env.invoke("process_read", {
        process_id: pid,
        cursor: 0,
        max_bytes: 1024,
      });
      expect(result.status).toBe("ok");
      expect(Buffer.byteLength(result.stdout ?? "", "utf8")).toBeLessThanOrEqual(1024);
      const data = JSON.parse(result.stdout ?? "{}") as ProcessData;
      expect(data.dropped_before_cursor).toBeGreaterThan(0);
      expect(data.next_cursor).toBeGreaterThan(data.dropped_before_cursor);
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("refuses further input after stdin has closed", async () => {
    const env = fixture();
    try {
      const start = await env.invoke("process_start", {
        command: interactiveCommand,
        max_runtime_seconds: 1,
      });
      const pid = (JSON.parse(start.stdout ?? "{}") as ProcessData).process_id;
      await pollUntil(env.invoke, pid, (x) =>
        (x.chunks ?? []).some((c) => c.text.includes("READY")),
      );
      const close = await env.invoke("process_input", {
        process_id: pid,
        input: "",
        close_stdin: true,
      });
      expect(close.status).toBe("ok");
      const repeat = await env.invoke("process_input", { process_id: pid, input: "late" });
      expect(repeat).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("expires a managed command at its local runtime limit", async () => {
    const env = fixture();
    try {
      const start = await env.invoke("process_start", {
        command: 'node -e "setInterval(()=>{},200)"',
        max_runtime_seconds: 1,
      });
      expect(start.status).toBe("ok");
      const pid = (JSON.parse(start.stdout ?? "{}") as ProcessData).process_id;
      const timedOut = await pollUntil(env.invoke, pid, (x) => x.status === "timed_out");
      expect(timedOut.status).toBe("timed_out");
    } finally {
      env.executor.dispose();
    }
  }, 12000);

  test("does not start a process if shell permission is revoked during path resolution", async () => {
    const registry = new ManagedProcessRegistry();
    let stillAuthorized = true;
    try {
      const pending = registry.start(
        "owner",
        "agent",
        {
          command: interactiveCommand,
          cwd: process.cwd(),
        },
        () => stillAuthorized,
      );
      stillAuthorized = false;
      await expect(pending).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    } finally {
      registry.dispose();
    }
  });

  test("explicit stop and permission revocation cancel the running command", async () => {
    const env = fixture();
    try {
      const a = await env.invoke("process_start", { command: interactiveCommand });
      const pidA = (JSON.parse(a.stdout ?? "{}") as ProcessData).process_id;
      const stop = await env.invoke("process_stop", { process_id: pidA });
      expect(stop.status).toBe("ok");
      const stopped = await pollUntil(env.invoke, pidA, (x) => x.status !== "running");
      expect(stopped.status).toBe("stopped");
      const b = await env.invoke("process_start", { command: interactiveCommand });
      const pidB = (JSON.parse(b.stdout ?? "{}") as ProcessData).process_id;
      env.executor.updatePolicy(mergeCustomPolicy({ capabilities: { "shell.exec": false } }));
      const revoked = await env.invoke("process_read", { process_id: pidB });
      expect(revoked).toMatchObject({ status: "error", error_code: "CAPABILITY_DENIED" });
    } finally {
      env.executor.dispose();
    }
  }, 12000);
});
