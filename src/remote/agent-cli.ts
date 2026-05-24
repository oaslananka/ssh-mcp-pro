import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentExecutor, defaultHostMetadata } from "./agent-executor.js";
import {
  ensurePemKeyPair,
  nowIso,
  randomToken,
  signEnvelope,
  verifyEnvelope,
  type PemKeyPair,
} from "./crypto.js";
import { parseControlPlaneEnvelope, parseAgentPolicy } from "./schemas.js";
import type { AgentHelloEnvelope, AgentHostMetadata, AgentPolicy } from "./types.js";

interface AgentConfigFile {
  server: string;
  agentId: string;
  alias: string;
  publicKeyPem: string;
  privateKeyPem: string;
  controlPlanePublicKeyPem: string;
  policy: AgentPolicy;
  websocketUrl: string;
  enrolledAt: string;
}

interface RuntimeWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

type RuntimeWebSocketConstructor = new (url: string) => RuntimeWebSocket;

function output(line: string): void {
  process.stdout.write(`${line}\n`);
}

function configPath(): string {
  return (
    process.env.SSHAUTOMATOR_AGENT_CONFIG ?? path.join(os.homedir(), ".sshautomator", "agent.json")
  );
}

function keyPath(): string {
  return path.join(path.dirname(configPath()), "agent-ed25519.json");
}

function loadConfig(): AgentConfigFile {
  return JSON.parse(readFileSync(configPath(), "utf8")) as AgentConfigFile;
}

function requireConfig(): AgentConfigFile {
  if (!existsSync(configPath())) {
    throw new Error(
      [
        "Agent is not enrolled.",
        "Enroll this host first with:",
        "  npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll --server <url> --token <one-time-token> --alias <alias>",
      ].join("\n"),
    );
  }
  return loadConfig();
}

function saveConfig(config: AgentConfigFile): void {
  const target = configPath();
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function parseFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected JSON object response");
  }
  return data as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requirePolicy(value: unknown): AgentPolicy {
  try {
    return parseAgentPolicy(value);
  } catch {
    throw new Error("Agent policy is missing from enrollment response");
  }
}

function runtimeWebSocket(): RuntimeWebSocketConstructor {
  const candidate = (globalThis as unknown as { WebSocket?: RuntimeWebSocketConstructor })
    .WebSocket;
  if (!candidate) {
    throw new Error("This Node.js runtime does not expose WebSocket. Use Node 22.22+ or Node 24.");
  }
  return candidate;
}

async function enroll(argv: string[]): Promise<void> {
  const server = parseFlag(argv, "--server")?.replace(/\/+$/u, "");
  const token = parseFlag(argv, "--token");
  const alias = parseFlag(argv, "--alias") ?? os.hostname();
  if (!server || !token) {
    throw new Error(
      "Usage: ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>",
    );
  }
  const keyPair: PemKeyPair = ensurePemKeyPair(keyPath());
  const response = await postJson(`${server}/api/agents/enroll`, {
    token,
    public_key: keyPair.publicKeyPem,
    alias,
    agent_version: process.env.npm_package_version ?? "unknown",
    host: defaultHostMetadata() satisfies AgentHostMetadata,
  });
  const config: AgentConfigFile = {
    server,
    agentId: requireString(response.agent_id, "agent_id"),
    alias: requireString(response.alias, "alias"),
    publicKeyPem: keyPair.publicKeyPem,
    privateKeyPem: keyPair.privateKeyPem,
    controlPlanePublicKeyPem: requireString(
      response.control_plane_public_key,
      "control_plane_public_key",
    ),
    policy: requirePolicy(response.policy),
    websocketUrl: requireString(response.websocket_url, "websocket_url"),
    enrolledAt: nowIso(),
  };
  saveConfig(config);
  output(`Agent enrolled: ${config.agentId} (${config.alias})`);
  output(`Config: ${configPath()}`);
}

async function runAgent(): Promise<void> {
  const config = requireConfig();
  const WebSocketCtor = runtimeWebSocket();
  const executor = new AgentExecutor(config.policy, config.privateKeyPem);
  const seenActions = new Map<string, number>();

  function rememberAction(actionId: string, deadline: string): boolean {
    const now = Date.now();
    for (const [seenActionId, expiresAt] of seenActions.entries()) {
      if (expiresAt <= now) {
        seenActions.delete(seenActionId);
      }
    }
    if (seenActions.has(actionId)) {
      return false;
    }
    seenActions.set(actionId, new Date(deadline).getTime());
    while (seenActions.size > 10_000) {
      const oldest = seenActions.keys().next().value;
      if (!oldest) {
        break;
      }
      seenActions.delete(oldest);
    }
    return true;
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocketCtor(config.websocketUrl);
    ws.onopen = () => {
      const hello: AgentHelloEnvelope = {
        type: "agent.hello",
        agent_id: config.agentId,
        timestamp: nowIso(),
        nonce: randomToken(16),
        capabilities: Object.entries(config.policy.capabilities)
          .filter(([, enabled]) => enabled)
          .map(([capability]) => capability as AgentHelloEnvelope["capabilities"][number]),
        agent_version: process.env.npm_package_version ?? "unknown",
        host: defaultHostMetadata(),
        signature: "",
      };
      hello.signature = signEnvelope(
        hello as unknown as Record<string, unknown>,
        config.privateKeyPem,
      );
      ws.send(JSON.stringify(hello));
      output(`Agent connected: ${config.agentId}`);
    };
    ws.onmessage = (event) => {
      void (async () => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString("utf8");
        const payload = JSON.parse(raw) as unknown;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return;
        }
        let envelope: ReturnType<typeof parseControlPlaneEnvelope>;
        try {
          envelope = parseControlPlaneEnvelope(payload);
        } catch {
          return;
        }
        if (envelope.agent_id !== config.agentId) {
          return;
        }
        if (
          !verifyEnvelope(
            envelope as unknown as Record<string, unknown>,
            config.controlPlanePublicKeyPem,
          )
        ) {
          return;
        }
        if (envelope.type === "policy.update") {
          const update = envelope;
          config.policy = update.policy;
          executor.updatePolicy(update.policy);
          saveConfig(config);
          return;
        }
        const action = envelope;
        if (seenActions.has(action.action_id)) {
          return;
        }
        if (new Date(action.deadline).getTime() < Date.now()) {
          return;
        }
        if (
          action.policy_version !== config.policy.version &&
          action.policy_version !== config.policy.version + 1
        ) {
          return;
        }
        rememberAction(action.action_id, action.deadline);
        const result = await executor.execute(action);
        ws.send(JSON.stringify(result));
      })().catch((error) => {
        process.stderr.write(
          `Agent action failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    };
    ws.onerror = (event) => reject(new Error(`WebSocket error: ${String(event)}`));
    ws.onclose = () => resolve();
  });
}

function status(): void {
  if (!existsSync(configPath())) {
    output("Agent is not enrolled.");
    return;
  }
  const config = loadConfig();
  output(`Agent ID: ${config.agentId}`);
  output(`Alias: ${config.alias}`);
  output(`Server: ${config.server}`);
  output(`Profile: ${config.policy.profile}`);
  output(`Config: ${configPath()}`);
}

function installService(): void {
  const config = existsSync(configPath()) ? loadConfig() : undefined;
  const command = `ssh-mcp-pro-agent run`;
  if (process.platform === "win32") {
    output("Windows service installation requires an elevated PowerShell session.");
    output(`Use a service manager such as NSSM or PowerShell Scheduled Task to run: ${command}`);
    output(`Agent config: ${configPath()}`);
    return;
  }
  if (process.platform === "darwin") {
    output("Create a launchd plist that runs:");
    output(command);
    output(`Agent config: ${configPath()}`);
    return;
  }
  output("Create a systemd service with ExecStart:");
  output(command);
  output(`User=${process.env.USER ?? "sshautomator"}`);
  output(`Agent=${config?.agentId ?? "not-enrolled"}`);
}

function uninstallService(): void {
  if (process.platform === "win32") {
    output("Remove the Windows service or scheduled task that runs ssh-mcp-pro-agent run.");
    return;
  }
  if (process.platform === "darwin") {
    output("Unload and remove the launchd plist that runs ssh-mcp-pro-agent run.");
    return;
  }
  output("Disable and remove the systemd service that runs ssh-mcp-pro-agent run.");
}

export async function runAgentCli(argv: string[]): Promise<void> {
  const command = argv[0] ?? "help";
  switch (command) {
    case "enroll":
      await enroll(argv.slice(1));
      break;
    case "run":
      await runAgent();
      break;
    case "status":
      status();
      break;
    case "install-service":
      installService();
      break;
    case "uninstall-service":
      uninstallService();
      break;
    default:
      output("Usage:");
      output("  ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>");
      output("  ssh-mcp-pro-agent run");
      output("  ssh-mcp-pro-agent status");
      output("  ssh-mcp-pro-agent install-service");
      output("  ssh-mcp-pro-agent uninstall-service");
  }
}
