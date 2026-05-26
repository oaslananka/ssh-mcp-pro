import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, vi, test } from "vitest";
import { runAgentCli } from "../../src/remote/agent-cli.js";
import {
  generateEd25519PemKeyPair,
  nowIso,
  signEnvelope,
  verifyEnvelope,
} from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import type {
  ActionRequestEnvelope,
  AgentPolicy,
  PolicyUpdateEnvelope,
} from "../../src/remote/types.js";
import { AGENT_ENROLL_COMMAND, LEGACY_AGENT_COMMAND_PATTERN } from "./helpers.js";

const originalAgentConfig = process.env.SSHAUTOMATOR_AGENT_CONFIG;
const originalFetch = globalThis.fetch;
const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

afterEach(() => {
  if (originalAgentConfig === undefined) {
    delete process.env.SSHAUTOMATOR_AGENT_CONFIG;
  } else {
    process.env.SSHAUTOMATOR_AGENT_CONFIG = originalAgentConfig;
  }
  globalThis.fetch = originalFetch;
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
});

function captureStdout(): { read(): string; restore(): void } {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as never);
  return {
    read: () => output,
    restore: () => spy.mockRestore(),
  };
}

function agentConfigPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-cli-"));
  const configPath = path.join(dir, "agent.json");
  process.env.SSHAUTOMATOR_AGENT_CONFIG = configPath;
  return configPath;
}

function writeAgentConfig(
  configPath: string,
  options: {
    agentId?: string | undefined;
    alias?: string | undefined;
    policy?: AgentPolicy | undefined;
    controlPlanePublicKeyPem?: string | undefined;
    privateKeyPem?: string | undefined;
    publicKeyPem?: string | undefined;
  },
): void {
  const agentKeys = options.privateKeyPem
    ? { privateKeyPem: options.privateKeyPem, publicKeyPem: options.publicKeyPem ?? "" }
    : generateEd25519PemKeyPair();
  const policy = options.policy ?? createAgentPolicy("operations");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        server: "https://sshautomator.example",
        agentId: options.agentId ?? "agt_test",
        alias: options.alias ?? "test-agent",
        publicKeyPem: agentKeys.publicKeyPem,
        privateKeyPem: agentKeys.privateKeyPem,
        controlPlanePublicKeyPem:
          options.controlPlanePublicKeyPem ?? generateEd25519PemKeyPair().publicKeyPem,
        policy,
        websocketUrl: "wss://sshautomator.example/api/agents/connect",
        enrolledAt: nowIso(),
      },
      null,
      2,
    ),
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("remote agent CLI", () => {
  test("enroll persists agent config without leaking the one-time token", async () => {
    const configPath = agentConfigPath();
    const controlPlaneKeys = generateEd25519PemKeyPair();
    const oneTimeToken = "enr_secret_token_that_must_not_be_persisted";
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          agent_id: "agt_enrolled",
          alias: "my server",
          control_plane_public_key: controlPlaneKeys.publicKeyPem,
          policy: createAgentPolicy("operations"),
          websocket_url: "wss://sshautomator.example/api/agents/connect",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const stdout = captureStdout();
    try {
      await runAgentCli([
        "enroll",
        "--server",
        "https://sshautomator.example/",
        "--token",
        oneTimeToken,
        "--alias",
        "my server",
      ]);
    } finally {
      stdout.restore();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://sshautomator.example/api/agents/enroll");
    const requestBody = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      token: oneTimeToken,
      alias: "my server",
      agent_version: expect.any(String),
    });
    expect(requestBody.public_key).toEqual(expect.stringContaining("BEGIN PUBLIC KEY"));
    expect(requestBody.host).toEqual(
      expect.objectContaining({
        hostname: expect.any(String),
        os: expect.any(String),
        arch: expect.any(String),
        platform: expect.any(String),
      }),
    );

    const persisted = readFileSync(configPath, "utf8");
    const persistedConfig = JSON.parse(persisted) as Record<string, unknown>;
    expect(persistedConfig.agentId).toBe("agt_enrolled");
    expect(persistedConfig.controlPlanePublicKeyPem).toBe(controlPlaneKeys.publicKeyPem);
    expect(persisted).not.toContain(oneTimeToken);
    expect(stdout.read()).not.toContain(oneTimeToken);
  });

  test("status reports enrollment metadata without exposing private material", async () => {
    const configPath = agentConfigPath();
    const keys = generateEd25519PemKeyPair();
    writeAgentConfig(configPath, {
      agentId: "agt_status",
      alias: "prod-vps-01",
      policy: createAgentPolicy("operations"),
      privateKeyPem: keys.privateKeyPem,
      publicKeyPem: keys.publicKeyPem,
    });
    const stdout = captureStdout();
    try {
      await runAgentCli(["status"]);
    } finally {
      stdout.restore();
    }

    const output = stdout.read();
    expect(output).toContain("Agent ID: agt_status");
    expect(output).toContain("Alias: prod-vps-01");
    expect(output).toContain("Profile: operations");
    expect(output).not.toContain(keys.privateKeyPem);
    expect(output).not.toContain("BEGIN PRIVATE KEY");
  });

  test("fails clearly when run is called before enrollment", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-cli-"));
    process.env.SSHAUTOMATOR_AGENT_CONFIG = path.join(dir, "missing-agent.json");

    await expect(runAgentCli(["run"])).rejects.toThrow(
      new RegExp(
        [
          "Agent is not enrolled\\.",
          "Enroll this host first with:",
          `  ${AGENT_ENROLL_COMMAND} --server <url> --token <one-time-token> --alias <alias>`,
        ].join("\\n"),
        "u",
      ),
    );
  });

  test("prints canonical remote-agent command names in help output", async () => {
    const stdout = captureStdout();
    try {
      await runAgentCli(["help"]);
    } finally {
      stdout.restore();
    }

    const output = stdout.read();
    expect(output).toContain(
      "ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>",
    );
    expect(output).toContain("ssh-mcp-pro-agent run");
    expect(output).toContain("ssh-mcp-pro-agent status");
    expect(output).toContain("ssh-mcp-pro-agent install-service");
    expect(output).toContain("ssh-mcp-pro-agent uninstall-service");
    expect(output).not.toMatch(LEGACY_AGENT_COMMAND_PATTERN);
  });

  test("reports canonical enrollment usage when required flags are missing", async () => {
    await expect(
      runAgentCli(["enroll", "--server", "https://sshautomator.example"]),
    ).rejects.toThrow(
      "Usage: ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>",
    );
  });

  test("surfaces enrollment HTTP errors and malformed enrollment responses", async () => {
    process.env.SSHAUTOMATOR_AGENT_CONFIG = path.join(
      mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-cli-")),
      "agent.json",
    );
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "token expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(
      runAgentCli(["enroll", "--server", "https://sshautomator.example", "--token", "expired"]),
    ).rejects.toThrow('HTTP 401: {"error":"token expired"}');

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          alias: "missing-agent-id",
          control_plane_public_key: generateEd25519PemKeyPair().publicKeyPem,
          policy: createAgentPolicy("operations"),
          websocket_url: "wss://sshautomator.example/api/agents/connect",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await expect(
      runAgentCli(["enroll", "--server", "https://sshautomator.example", "--token", "valid"]),
    ).rejects.toThrow("agent_id is required");
  });

  test("reports service guidance and missing enrollment status", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-agent-cli-"));
    process.env.SSHAUTOMATOR_AGENT_CONFIG = path.join(dir, "missing-agent.json");
    const stdout = captureStdout();
    try {
      await runAgentCli(["status"]);
      await runAgentCli(["install-service"]);
      await runAgentCli(["uninstall-service"]);
    } finally {
      stdout.restore();
    }

    const output = stdout.read();
    expect(output).toContain("Agent is not enrolled.");
    expect(output).toContain("ssh-mcp-pro-agent run");

    if (process.platform === "win32") {
      expect(output).toContain("Windows service installation requires");
      expect(output).toContain("PowerShell");
      expect(output).toContain("Remove the Windows service or scheduled task");
    } else if (process.platform === "darwin") {
      expect(output).toContain("launchd");
      expect(output).toContain("Unload and remove the launchd plist");
    } else {
      expect(output).toContain("Create a systemd service with ExecStart:");
      expect(output).toContain("Agent=not-enrolled");
      expect(output).toContain("Disable and remove the systemd service");
    }
  });

  test("fails clearly when the runtime WebSocket implementation is unavailable", async () => {
    const configPath = agentConfigPath();
    writeAgentConfig(configPath, {});
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;

    await expect(runAgentCli(["run"])).rejects.toThrow(
      "This Node.js runtime does not expose WebSocket. Use Node 22.22+ or Node 24.",
    );
  });

  test("run connects outbound, sends a signed hello, and signs action results", async () => {
    const configPath = agentConfigPath();
    const agentKeys = generateEd25519PemKeyPair();
    const controlPlaneKeys = generateEd25519PemKeyPair();
    const policy = createAgentPolicy("full-admin");
    writeAgentConfig(configPath, {
      agentId: "agt_online",
      alias: "online",
      policy,
      controlPlanePublicKeyPem: controlPlaneKeys.publicKeyPem,
      privateKeyPem: agentKeys.privateKeyPem,
      publicKeyPem: agentKeys.publicKeyPem,
    });

    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      readonly sent: string[] = [];

      constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
      }

      send(data: string): void {
        this.sent.push(data);
      }

      close(): void {
        this.onclose?.();
      }
    }
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
    const stdout = captureStdout();
    let runPromise: Promise<void> | undefined;
    let socket: FakeWebSocket | undefined;
    try {
      runPromise = runAgentCli(["run"]);
      await waitFor(() => FakeWebSocket.instances.length > 0);
      socket = FakeWebSocket.instances[0];
      expect(socket).toBeDefined();
      expect(socket?.url).toBe("wss://sshautomator.example/api/agents/connect");

      socket?.onopen?.();
      await waitFor(() => (socket?.sent.length ?? 0) >= 1);
      const hello = JSON.parse(socket?.sent[0] ?? "{}") as Record<string, unknown>;
      expect(hello).toMatchObject({
        type: "agent.hello",
        agent_id: "agt_online",
        capabilities: expect.arrayContaining(["shell.exec", "system.read"]),
      });
      expect(verifyEnvelope(hello, agentKeys.publicKeyPem)).toBe(true);

      const action: ActionRequestEnvelope = {
        type: "action.request",
        action_id: "act_cli_run",
        agent_id: "agt_online",
        user_id: "github:169144131",
        tool: "run_shell",
        capability: "shell.exec",
        args: {
          command: "node -e \"process.stdout.write('agent-ok')\"",
          timeout_seconds: 10,
        },
        policy_version: policy.version,
        issued_at: nowIso(),
        deadline: new Date(Date.now() + 30_000).toISOString(),
        nonce: "nonce-action-cli-run",
        signature: "",
      };
      action.signature = signEnvelope(
        action as unknown as Record<string, unknown>,
        controlPlaneKeys.privateKeyPem,
      );
      socket?.onmessage?.({ data: JSON.stringify(action) });
      await waitFor(() => (socket?.sent.length ?? 0) >= 2, 20_000);

      const result = JSON.parse(socket?.sent[1] ?? "{}") as Record<string, unknown>;
      expect(result).toMatchObject({
        type: "action.result",
        action_id: "act_cli_run",
        agent_id: "agt_online",
        status: "ok",
        exit_code: 0,
        stdout: "agent-ok",
        truncated: false,
      });
      expect(verifyEnvelope(result, agentKeys.publicKeyPem)).toBe(true);
    } finally {
      socket?.close();
      if (runPromise) {
        await runPromise;
      }
      stdout.restore();
    }
    expect(stdout.read()).toContain("Agent connected: agt_online");
  }, 30_000);

  test("run ignores invalid control-plane messages and applies signed policy updates", async () => {
    const configPath = agentConfigPath();
    const agentKeys = generateEd25519PemKeyPair();
    const controlPlaneKeys = generateEd25519PemKeyPair();
    const initialPolicy = createAgentPolicy("read-only");
    const updatedPolicy: AgentPolicy = { ...createAgentPolicy("full-admin"), version: 2 };
    writeAgentConfig(configPath, {
      agentId: "agt_policy_update",
      alias: "policy",
      policy: initialPolicy,
      controlPlanePublicKeyPem: controlPlaneKeys.publicKeyPem,
      privateKeyPem: agentKeys.privateKeyPem,
      publicKeyPem: agentKeys.publicKeyPem,
    });

    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      readonly sent: string[] = [];

      constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
      }

      send(data: string): void {
        this.sent.push(data);
      }

      close(): void {
        this.onclose?.();
      }
    }
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
    const stdout = captureStdout();
    let runPromise: Promise<void> | undefined;
    let socket: FakeWebSocket | undefined;
    try {
      runPromise = runAgentCli(["run"]);
      await waitFor(() => FakeWebSocket.instances.length > 0);
      socket = FakeWebSocket.instances[0];
      expect(socket).toBeDefined();
      socket?.onopen?.();
      await waitFor(() => (socket?.sent.length ?? 0) >= 1);

      socket?.onmessage?.({ data: JSON.stringify(null) });
      socket?.onmessage?.({ data: JSON.stringify({ type: "policy.update" }) });

      const unsignedAction: ActionRequestEnvelope = {
        type: "action.request",
        action_id: "act_unsigned",
        agent_id: "agt_policy_update",
        user_id: "github:169144131",
        tool: "run_shell",
        capability: "shell.exec",
        args: { command: "node -e \"process.stdout.write('ignored')\"" },
        policy_version: 1,
        issued_at: nowIso(),
        deadline: new Date(Date.now() + 30_000).toISOString(),
        nonce: "nonce-unsigned-action",
        signature: "not-a-valid-signature",
      };
      socket?.onmessage?.({ data: JSON.stringify(unsignedAction) });

      const update: PolicyUpdateEnvelope = {
        type: "policy.update",
        agent_id: "agt_policy_update",
        policy: updatedPolicy,
        policy_version: updatedPolicy.version,
        issued_at: nowIso(),
        nonce: "nonce-policy-update",
        signature: "",
      };
      update.signature = signEnvelope(
        update as unknown as Record<string, unknown>,
        controlPlaneKeys.privateKeyPem,
      );
      socket?.onmessage?.({ data: JSON.stringify(update) });
      await waitFor(() => {
        const persisted = JSON.parse(readFileSync(configPath, "utf8")) as { policy: AgentPolicy };
        return persisted.policy.profile === "full-admin";
      });

      const wrongAgentUpdate: PolicyUpdateEnvelope = {
        ...update,
        agent_id: "agt_other",
        nonce: "nonce-policy-other",
        signature: "",
      };
      wrongAgentUpdate.signature = signEnvelope(
        wrongAgentUpdate as unknown as Record<string, unknown>,
        controlPlaneKeys.privateKeyPem,
      );
      socket?.onmessage?.({ data: JSON.stringify(wrongAgentUpdate) });

      const action: ActionRequestEnvelope = {
        type: "action.request",
        action_id: "act_after_policy_update",
        agent_id: "agt_policy_update",
        user_id: "github:169144131",
        tool: "run_shell",
        capability: "shell.exec",
        args: {
          command: "node -e \"process.stdout.write('updated-policy')\"",
          timeout_seconds: 10,
        },
        policy_version: updatedPolicy.version,
        issued_at: nowIso(),
        deadline: new Date(Date.now() + 30_000).toISOString(),
        nonce: "nonce-action-updated-policy",
        signature: "",
      };
      action.signature = signEnvelope(
        action as unknown as Record<string, unknown>,
        controlPlaneKeys.privateKeyPem,
      );
      const expiredAction: ActionRequestEnvelope = {
        ...action,
        action_id: "act_expired",
        deadline: new Date(Date.now() - 30_000).toISOString(),
        nonce: "nonce-action-expired",
        signature: "",
      };
      expiredAction.signature = signEnvelope(
        expiredAction as unknown as Record<string, unknown>,
        controlPlaneKeys.privateKeyPem,
      );
      const wrongVersionAction: ActionRequestEnvelope = {
        ...action,
        action_id: "act_wrong_version",
        policy_version: 999,
        nonce: "nonce-action-wrongver",
        signature: "",
      };
      wrongVersionAction.signature = signEnvelope(
        wrongVersionAction as unknown as Record<string, unknown>,
        controlPlaneKeys.privateKeyPem,
      );

      socket?.onmessage?.({ data: JSON.stringify(expiredAction) });
      socket?.onmessage?.({ data: JSON.stringify(wrongVersionAction) });
      socket?.onmessage?.({ data: JSON.stringify(action) });
      await waitFor(() => (socket?.sent.length ?? 0) >= 2);
      socket?.onmessage?.({ data: JSON.stringify(action) });

      const result = JSON.parse(socket?.sent[1] ?? "{}") as Record<string, unknown>;
      expect(result).toMatchObject({
        type: "action.result",
        action_id: "act_after_policy_update",
        status: "ok",
        stdout: "updated-policy",
      });
      expect(socket?.sent).toHaveLength(2);
    } finally {
      socket?.close();
      if (runPromise) {
        await runPromise;
      }
      stdout.restore();
    }
  });
});
