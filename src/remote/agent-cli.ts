import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentExecutor, defaultHostMetadata } from "./agent-executor.js";
import {
  AgentActivityLog,
  agentActivityLogPath,
  showAgentActivityLogs,
} from "./agent-activity-log.js";
import {
  ensurePemKeyPair,
  nowIso,
  randomToken,
  signEnvelope,
  verifyEnvelope,
  type PemKeyPair,
} from "./crypto.js";
import {
  rememberAcceptedPolicyUpdate,
  validatePolicyUpdate,
  type PolicyUpdateRejectionReason,
} from "./policy-update-guard.js";
import { parseControlPlaneEnvelope, parseAgentPolicy } from "./schemas.js";
import type {
  ActionRequestEnvelope,
  AgentHelloEnvelope,
  AgentHostMetadata,
  AgentPolicy,
  PolicyUpdateEnvelope,
} from "./types.js";

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

const POLICY_UPDATE_REJECTION_EVENTS: Record<PolicyUpdateRejectionReason, string> = {
  replay: "policy_update_replay",
  stale: "policy_update_stale",
  future: "policy_update_future",
  version_mismatch: "policy_version_mismatch",
  not_newer: "policy_version_not_newer",
};

function recordPolicyUpdateRejection(reason: PolicyUpdateRejectionReason): void {
  process.stderr.write(`Agent policy update rejected: ${POLICY_UPDATE_REJECTION_EVENTS[reason]}\n`);
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

/**
 * An enrollment response cannot redirect the signed agent hello or action
 * results to a different origin or downgrade a secure transport. The
 * connection path remains configurable on the server.
 */
function validateAgentWebSocketDestination(serverAddress: string, destination: string): string {
  let server: URL;
  let websocket: URL;
  try {
    server = new URL(serverAddress);
    websocket = new URL(destination);
  } catch {
    throw new Error("Agent WebSocket destination does not match enrolled server");
  }
  const requiredProtocol = server.protocol === "https:" ? "wss:" : "ws:";
  if (
    (server.protocol !== "https:" && server.protocol !== "http:") ||
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    websocket.protocol !== requiredProtocol ||
    websocket.host !== server.host ||
    websocket.username ||
    websocket.password ||
    websocket.search ||
    websocket.hash
  ) {
    throw new Error("Agent WebSocket destination does not match enrolled server");
  }
  return websocket.href;
}

function removeTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end--;
  }
  return value.slice(0, end);
}

async function enroll(argv: string[]): Promise<void> {
  const server = removeTrailingSlashes(parseFlag(argv, "--server") ?? "");
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
    websocketUrl: validateAgentWebSocketDestination(
      server,
      requireString(response.websocket_url, "websocket_url"),
    ),
    enrolledAt: nowIso(),
  };
  saveConfig(config);
  output(`Agent enrolled: ${config.agentId} (${config.alias})`);
  output(`Config: ${configPath()}`);
}

/** A server-side ready acknowledgement is distinct from an open WebSocket. */
function handleAgentControlMessage(
  payload: Record<string, unknown>,
  config: AgentConfigFile,
  activity: AgentActivityLog,
): boolean {
  if (payload.type === "agent.ready") {
    if (payload.agent_id === config.agentId) {
      activity.event("ok", "agent_ready", "Identity confirmed. Agent ready for requests.");
      output(`Agent connected: ${config.agentId}`);
    }
    return true;
  }
  if (payload.type === "error") {
    activity.event("error", "control_plane_error", "Server rejected an agent message.");
    return true;
  }
  return false;
}

function applyAgentPolicyUpdate(
  update: PolicyUpdateEnvelope,
  config: AgentConfigFile,
  executor: AgentExecutor,
  activity: AgentActivityLog,
  seenPolicyUpdateNonces: Map<string, number>,
): void {
  const validation = validatePolicyUpdate(update, config.policy.version, seenPolicyUpdateNonces);
  if (!validation.accepted) {
    recordPolicyUpdateRejection(validation.reason);
    activity.event("warn", "policy_rejected", "Policy update rejected: " + validation.reason);
    return;
  }
  saveConfig({ ...config, policy: update.policy });
  rememberAcceptedPolicyUpdate(seenPolicyUpdateNonces, update.nonce);
  config.policy = update.policy;
  executor.updatePolicy(update.policy);
  activity.event(
    "ok",
    "policy_updated",
    "Policy updated: " + update.policy.profile + " v" + update.policy.version,
  );
}

function acceptAgentAction(
  action: ActionRequestEnvelope,
  config: AgentConfigFile,
  activity: AgentActivityLog,
  seenActions: Map<string, number>,
): boolean {
  if (seenActions.has(action.action_id)) {
    activity.event("warn", "action_replay", "Duplicate action ignored.");
    return false;
  }
  if (new Date(action.deadline).getTime() < Date.now()) {
    activity.event("warn", "action_expired", "Expired action ignored.");
    return false;
  }
  if (
    action.policy_version !== config.policy.version &&
    action.policy_version !== config.policy.version + 1
  ) {
    activity.event("warn", "policy_mismatch", "Action policy version mismatch.");
    return false;
  }
  return true;
}

async function runAgent(): Promise<void> {
  const config = requireConfig();
  const WebSocketCtor = runtimeWebSocket();
  const executor = new AgentExecutor(config.policy, config.privateKeyPem);
  const activity = new AgentActivityLog(configPath());
  activity.banner(config.alias, config.policy.profile, config.policy.version);
  activity.event("info", "agent_starting", "Agent starting. Preparing outbound connection.");
  const seenActions = new Map<string, number>();
  const seenPolicyUpdateNonces = new Map<string, number>();

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
    const ws = new WebSocketCtor(
      validateAgentWebSocketDestination(config.server, config.websocketUrl),
    );
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
      activity.event("info", "transport_open", "Transport open. Validating agent identity.");
      // An open socket is not an authenticated agent; wait for agent.ready.
    };
    ws.onmessage = (event) => {
      void (async () => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString("utf8");
        const payload = JSON.parse(raw) as unknown;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          activity.event("warn", "message_rejected", "Malformed control-plane message ignored.");
          return;
        }
        if (handleAgentControlMessage(payload as Record<string, unknown>, config, activity)) {
          return;
        }
        let envelope: ReturnType<typeof parseControlPlaneEnvelope>;
        try {
          envelope = parseControlPlaneEnvelope(payload);
        } catch {
          activity.event("warn", "message_rejected", "Invalid control-plane envelope ignored.");
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
          activity.event("warn", "signature_rejected", "Unverified control-plane message ignored.");
          return;
        }
        if (envelope.type === "policy.update") {
          applyAgentPolicyUpdate(envelope, config, executor, activity, seenPolicyUpdateNonces);
          return;
        }
        const action = envelope;
        if (!acceptAgentAction(action, config, activity, seenActions)) {
          return;
        }
        rememberAction(action.action_id, action.deadline);
        const startedAt = Date.now();
        activity.event("info", "action_started", "Request received: " + action.tool);
        const result = await executor.execute(action);
        ws.send(JSON.stringify(result));
        activity.event(
          result.status === "ok" ? "ok" : "warn",
          "action_finished",
          "Request " +
            action.tool +
            " completed: " +
            result.status +
            " (" +
            (Date.now() - startedAt) +
            " ms)",
        );
      })().catch(() => {
        // Never print command/output/provider error text: it can contain credentials.
        activity.event("error", "action_failed", "Action processing failed; details withheld.");
      });
    };
    ws.onerror = () => {
      activity.event("error", "socket_error", "Connection error. Service restart may be required.");
      reject(new Error("WebSocket transport error"));
    };
    // A disconnected agent must exit nonzero so its service supervisor can restart it.
    ws.onclose = () => {
      activity.event("warn", "disconnected", "Connection closed. Awaiting service restart.");
      reject(new Error("Agent WebSocket connection closed"));
    };
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
  output(`Activity log: ${agentActivityLogPath(configPath())}`);
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

function printAgentUsage(): void {
  output("Usage:");
  output("  ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>");
  output("  ssh-mcp-pro-agent run");
  output("  ssh-mcp-pro-agent status");
  output("  ssh-mcp-pro-agent logs [--tail 60] [--follow]");
  output("  ssh-mcp-pro-agent install-service");
  output("  ssh-mcp-pro-agent uninstall-service");
  output("  ssh-mcp-pro-agent --version");
}

function printAgentVersion(): void {
  const packagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  if (!pkg.version) {
    throw new Error("Agent package version is unavailable");
  }
  output(pkg.version);
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
    case "logs":
      await showAgentActivityLogs(configPath(), argv.slice(1));
      break;
    case "install-service":
      installService();
      break;
    case "uninstall-service":
      uninstallService();
      break;
    case "help":
    case "--help":
    case "-h":
      printAgentUsage();
      break;
    case "--version":
    case "-v":
      printAgentVersion();
      break;
    default:
      throw new Error("Unknown agent command. Run ssh-mcp-pro-agent --help for usage.");
  }
}
