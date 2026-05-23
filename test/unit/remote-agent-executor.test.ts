import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";
import { AgentExecutor } from "../../src/remote/agent-executor.js";
import { generateEd25519PemKeyPair, verifyEnvelope } from "../../src/remote/crypto.js";
import { createAgentPolicy, mergeCustomPolicy } from "../../src/remote/policy.js";
import type { ActionRequestEnvelope, RemoteToolName } from "../../src/remote/types.js";

function action(
  tool: RemoteToolName,
  capability: ActionRequestEnvelope["capability"],
  args: Record<string, unknown>,
): ActionRequestEnvelope {
  return {
    type: "action.request",
    action_id: `act_${tool}`,
    agent_id: "agt_test",
    user_id: "github:169144131",
    tool,
    capability,
    args,
    policy_version: 1,
    issued_at: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    nonce: "nonce",
    signature: "",
  };
}

describe("remote agent executor", () => {
  test("agent-side policy denies shell execution in read-only profile", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("read-only"), keyPair.privateKeyPem);

    const result = await executor.execute(
      action("run_shell", "shell.exec", { command: "node -e \"process.stdout.write('denied')\"" }),
    );

    expect(result.status).toBe("error");
    expect(result.error_code).toBe("CAPABILITY_DENIED");
    expect(verifyEnvelope(result as unknown as Record<string, unknown>, keyPair.publicKeyPem)).toBe(
      true,
    );
  });

  test("full-admin policy allows bounded shell execution", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("full-admin"), keyPair.privateKeyPem);

    const result = await executor.execute(
      action("run_shell", "shell.exec", {
        command: "node -e \"process.stdout.write('ok')\"",
        timeout_seconds: 10,
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  test("file writes are path scoped and use local policy", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-"));
    const target = path.join(tempDir, "state.txt");
    const keyPair = generateEd25519PemKeyPair();
    const policy = mergeCustomPolicy({
      capabilities: { "files.read": true, "files.write": true },
      allowPaths: [tempDir.replace(/\\/gu, "/")],
      denyPaths: ["/"],
    });
    const executor = new AgentExecutor(policy, keyPair.privateKeyPem);

    const result = await executor.execute(
      action("file_write", "files.write", { path: target, content: "agent-local" }),
    );

    expect(result.status).toBe("ok");
    expect(readFileSync(target, "utf8")).toBe("agent-local");
  });

  test("truncates large command output with metadata", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const policy = mergeCustomPolicy({
      profile: "full-admin",
      capabilities: createAgentPolicy("full-admin").capabilities,
      maxOutputBytes: 64,
    });
    const executor = new AgentExecutor(policy, keyPair.privateKeyPem);

    const result = await executor.execute(
      action("run_shell", "shell.exec", {
        command: "node -e \"process.stdout.write('x'.repeat(200))\"",
        timeout_seconds: 10,
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout ?? "", "utf8")).toBeLessThanOrEqual(64);
    expect((result.stdout ?? "").startsWith("x".repeat(20))).toBe(true);
    expect(result.stdout).toContain("truncated");
  });

  test("streams file reads up to the configured output limit", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-"));
    const target = path.join(tempDir, "large.txt");
    writeFileSync(target, "x".repeat(512));
    const keyPair = generateEd25519PemKeyPair();
    const policy = mergeCustomPolicy({
      capabilities: { "files.read": true },
      allowPaths: [tempDir.replace(/\\/gu, "/")],
      denyPaths: ["/"],
      maxOutputBytes: 48,
    });
    const executor = new AgentExecutor(policy, keyPair.privateKeyPem);

    const result = await executor.execute(action("file_read", "files.read", { path: target }));

    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout ?? "", "utf8")).toBeLessThanOrEqual(48);
    expect((result.stdout ?? "").startsWith("x".repeat(16))).toBe(true);
    expect(result.stdout).toContain("truncated");
  });

  test("rejects unsafe service, container, and log identifiers before spawning commands", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("full-admin"), keyPair.privateKeyPem);

    await expect(
      executor.execute(
        action("restart_service", "service.manage", {
          service: "sshd;id",
          timeout_seconds: 10,
        }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: expect.stringContaining("Service name contains unsupported characters"),
    });

    await expect(
      executor.execute(
        action("docker_logs", "docker.manage", {
          container: "app$(id)",
          lines: 10,
          timeout_seconds: 10,
        }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: expect.stringContaining("Container name contains unsupported characters"),
    });

    await expect(
      executor.execute(
        action("tail_logs", "logs.read", {
          unit_or_file: "sshd;id",
          timeout_seconds: 10,
        }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: expect.stringContaining("unsupported characters"),
    });
  });
});
