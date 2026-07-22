import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentExecutor } from "../../src/remote/agent-executor.js";
import { generateEd25519PemKeyPair, verifyEnvelope } from "../../src/remote/crypto.js";
import { createAgentPolicy, mergeCustomPolicy } from "../../src/remote/policy.js";
import { REMOTE_TOOLS, TOOL_CAPABILITY_MAP } from "../../src/remote/types.js";
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

  const harmlessArgsByTool: Partial<Record<RemoteToolName, Record<string, unknown>>> = {
    get_system_status: { timeout_seconds: 1 },
    tail_logs: { unit_or_file: "", timeout_seconds: 1 },
    restart_service: { service: "invalid;service", timeout_seconds: 1 },
    docker_ps: { timeout_seconds: 1 },
    docker_logs: { container: "invalid;container", timeout_seconds: 1 },
    docker_restart: { container: "invalid;container", timeout_seconds: 1 },
    file_read: { path: "/etc/passwd" },
    file_write: { path: "/etc/ssh-mcp-pro-never-write", content: "unexpected" },
    run_shell: {
      command: "node -e \"process.stdout.write('unexpected')\"",
      timeout_seconds: 1,
    },
    run_shell_as_root: { command: "true", timeout_seconds: 1 },
  };
  const enabledAlternateCapabilities = [
    "hosts.read",
    "system.read",
    "logs.read",
    "audit.read",
  ] as const;
  const mismatchedToolCapabilities = REMOTE_TOOLS.map((tool) => {
    const capability = enabledAlternateCapabilities.find(
      (candidate) => candidate !== TOOL_CAPABILITY_MAP[tool],
    );
    if (!capability) {
      throw new Error(`No alternate capability configured for ${tool}`);
    }
    return [tool, capability, harmlessArgsByTool[tool] ?? {}] as const;
  });

  test.each(mismatchedToolCapabilities)(
    "rejects a mismatched declared capability for %s before dispatch",
    async (tool, capability, args) => {
      const keyPair = generateEd25519PemKeyPair();
      const executor = new AgentExecutor(createAgentPolicy("full-admin"), keyPair.privateKeyPem);

      const result = await executor.execute(action(tool, capability, args));

      expect(result).toMatchObject({
        status: "error",
        error_code: "CAPABILITY_DENIED",
        message: `Tool ${tool} requires ${TOOL_CAPABILITY_MAP[tool]}, received ${capability}`,
      });
      expect(
        verifyEnvelope(result as unknown as Record<string, unknown>, keyPair.publicKeyPem),
      ).toBe(true);
    },
  );

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

  test("policy updates take effect before executing commands in a requested cwd", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-"));
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("read-only"), keyPair.privateKeyPem);
    executor.updatePolicy(createAgentPolicy("full-admin"));

    const result = await executor.execute(
      action("run_shell", "shell.exec", {
        command: 'node -e "process.stdout.write(process.cwd())"',
        cwd: tempDir,
        timeout_seconds: 10,
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.stdout).toBe(tempDir);
  });

  test("reports basic system status and tails allowed log files", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-"));
    const target = path.join(tempDir, "service.log");
    writeFileSync(target, ["one", "two", "three"].join("\n"));
    const keyPair = generateEd25519PemKeyPair();
    const policy = mergeCustomPolicy({
      profile: "read-only",
      capabilities: createAgentPolicy("read-only").capabilities,
      allowPaths: [tempDir.replace(/\\/gu, "/")],
      denyPaths: ["/"],
    });
    const executor = new AgentExecutor(policy, keyPair.privateKeyPem);

    const status = await executor.execute(
      action("get_system_status", "system.read", { timeout_seconds: 10 }),
    );
    const logs = await executor.execute(
      action("tail_logs", "logs.read", { unit_or_file: target, timeout_seconds: 10 }),
    );

    expect(status.status).toBe("ok");
    if (process.platform === "win32") {
      expect(status.stdout).toContain("CsName");
    } else {
      expect(status.stdout).toContain("Linux");
    }
    expect(logs.status).toBe("ok");
    expect(logs.stdout).toContain("three");
  }, 15_000);

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

  test("marks output truncated when the local policy allows zero output bytes", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const policy = mergeCustomPolicy({
      profile: "full-admin",
      capabilities: createAgentPolicy("full-admin").capabilities,
      maxOutputBytes: 0,
    });
    const executor = new AgentExecutor(policy, keyPair.privateKeyPem);

    const result = await executor.execute(
      action("run_shell", "shell.exec", {
        command: "node -e \"process.stdout.write('hidden')\"",
        timeout_seconds: 10,
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe("");
  });

  test("returns exit code 124 when bounded command execution times out", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("full-admin"), keyPair.privateKeyPem);

    const result = await executor.execute(
      action("run_shell", "shell.exec", {
        command: 'node -e "setTimeout(() => undefined, 5000)"',
        timeout_seconds: 0,
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.exit_code).toBe(124);
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

  test("returns signed policy errors for denied paths and missing log targets", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("read-only"), keyPair.privateKeyPem);
    const fileExecutor = new AgentExecutor(createAgentPolicy("operations"), keyPair.privateKeyPem);
    const writeExecutor = new AgentExecutor(createAgentPolicy("full-admin"), keyPair.privateKeyPem);

    await expect(
      executor.execute(action("tail_logs", "logs.read", { unit_or_file: "", timeout_seconds: 10 })),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "unit_or_file is required",
    });

    await expect(
      fileExecutor.execute(action("file_read", "files.read", { path: "/etc/passwd" })),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "Path is not allowed by local policy",
    });
    await expect(
      fileExecutor.execute(
        action("tail_logs", "logs.read", { unit_or_file: "/etc/syslog", timeout_seconds: 10 }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "Log path is not allowed by local policy",
    });
    await expect(
      writeExecutor.execute(action("file_write", "files.write", { path: "/etc/ssh-mcp-pro" })),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "Path is not allowed by local policy",
    });
    await expect(
      fileExecutor.execute(
        action("restart_service", "service.manage", {
          service: "sshd",
          timeout_seconds: 10,
        }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "Service is not allowed by local policy",
    });
    await expect(
      fileExecutor.execute(
        action("docker_logs", "docker.manage", {
          container: "app",
          timeout_seconds: 10,
        }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "Container is not allowed by local policy",
    });
    await expect(
      fileExecutor.execute(
        action("docker_restart", "docker.manage", {
          container: "app",
          timeout_seconds: 10,
        }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      error_code: "POLICY_DENIED",
      message: "Container is not allowed by local policy",
    });
    const unsupported = {
      ...action("get_system_status", "system.read", { timeout_seconds: 10 }),
      tool: "unsupported_tool" as RemoteToolName,
    } satisfies ActionRequestEnvelope;
    await expect(fileExecutor.execute(unsupported)).resolves.toMatchObject({
      status: "error",
      error_code: "UNSUPPORTED_PLATFORM",
      message: "Unsupported action unsupported_tool",
    });
  });

  test("dispatches docker and privileged shell tools through bounded command execution", async () => {
    const keyPair = generateEd25519PemKeyPair();
    const executor = new AgentExecutor(createAgentPolicy("full-admin"), keyPair.privateKeyPem);

    await expect(
      executor.execute(action("docker_ps", "docker.manage", { timeout_seconds: 1 })),
    ).resolves.toMatchObject({
      status: "ok",
      truncated: false,
    });
    await expect(
      executor.execute(
        action("docker_logs", "docker.manage", {
          container: "missing-container",
          lines: 999,
          timeout_seconds: 1,
        }),
      ),
    ).resolves.toMatchObject({
      status: "ok",
      truncated: false,
    });
    await expect(
      executor.execute(
        action("docker_restart", "docker.manage", {
          container: "missing-container",
          timeout_seconds: 1,
        }),
      ),
    ).resolves.toMatchObject({
      status: "ok",
      truncated: false,
    });
    if (process.platform === "win32") {
      await expect(
        executor.execute(
          action("run_shell_as_root", "sudo.exec", {
            command: "true",
            timeout_seconds: 1,
          }),
        ),
      ).resolves.toMatchObject({
        status: "error",
        error_code: "UNSUPPORTED_PLATFORM_OR_PRIVILEGE",
      });
    } else {
      await expect(
        executor.execute(
          action("run_shell_as_root", "sudo.exec", {
            command: "true",
            timeout_seconds: 1,
          }),
        ),
      ).resolves.toMatchObject({
        status: "ok",
        truncated: false,
      });
    }
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
