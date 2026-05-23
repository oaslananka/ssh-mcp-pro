import { spawn } from "node:child_process";
import { z } from "zod";
import type { ServerConfig } from "./config.js";
import { resolveSSHHost } from "./ssh-config.js";
import type { ConnectionParams } from "./types.js";

const CommandCredentialResponseSchema = z
  .object({
    host: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: z.enum(["agent", "key"]).optional().default("agent"),
    privateKeyPath: z.string().min(1).optional(),
    knownHostsPath: z.string().min(1).optional(),
    expectedHostKeySha256: z.string().min(1).optional(),
    hostKeyPolicy: z.enum(["strict", "accept-new"]).optional().default("strict"),
    readyTimeoutMs: z.number().int().min(1000).max(60000).optional(),
    ttlMs: z.number().int().min(10000).max(900000).optional(),
  })
  .strict();

export interface ConnectorCredentialRequest {
  hostAlias: string;
  purpose: "inspect";
}

export async function resolveConnectorCredentials(
  request: ConnectorCredentialRequest,
  config: ServerConfig,
): Promise<ConnectionParams> {
  switch (config.connector.credentialProvider) {
    case "agent":
      return resolveAgentCredentials(request, config);
    case "command":
      return resolveCommandCredentials(request, config);
    case "none":
    default:
      throw new Error(
        "Remote connector credential provider is not configured. Set SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER=agent or command.",
      );
  }
}

async function resolveAgentCredentials(
  request: ConnectorCredentialRequest,
  config: ServerConfig,
): Promise<ConnectionParams> {
  const resolved = await resolveSSHHost(request.hostAlias);
  const username = resolved.username ?? config.connector.defaultUsername;
  if (!username) {
    throw new Error(
      "Remote connector agent provider requires User in SSH config or SSH_MCP_CONNECTOR_DEFAULT_USERNAME.",
    );
  }

  return {
    host: resolved.host,
    policyHost: request.hostAlias,
    username,
    ...(resolved.port !== undefined ? { port: resolved.port } : {}),
    auth: "agent",
    useAgent: true,
    hostKeyPolicy: "strict",
    policyMode: "enforce",
  };
}

async function resolveCommandCredentials(
  request: ConnectorCredentialRequest,
  config: ServerConfig,
): Promise<ConnectionParams> {
  if (!config.connector.credentialCommand) {
    throw new Error(
      "Remote connector command provider requires SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND.",
    );
  }

  const resolved = await resolveSSHHost(request.hostAlias);
  const commandResult = await runCredentialCommand(request, config.connector);
  const username = commandResult.username ?? resolved.username ?? config.connector.defaultUsername;
  if (!username) {
    throw new Error("Credential command did not return a username and no default is configured.");
  }

  if (commandResult.auth === "key" && !commandResult.privateKeyPath) {
    throw new Error("Credential command auth=key requires privateKeyPath.");
  }

  return {
    host: commandResult.host ?? resolved.host,
    policyHost: request.hostAlias,
    username,
    ...((commandResult.port ?? resolved.port) ? { port: commandResult.port ?? resolved.port } : {}),
    auth: commandResult.auth,
    useAgent: commandResult.auth === "agent",
    hostKeyPolicy: commandResult.hostKeyPolicy,
    policyMode: "enforce",
    readyTimeoutMs: commandResult.readyTimeoutMs ?? 20000,
    ttlMs: commandResult.ttlMs ?? 120000,
    ...(commandResult.privateKeyPath ? { privateKeyPath: commandResult.privateKeyPath } : {}),
    ...(commandResult.knownHostsPath ? { knownHostsPath: commandResult.knownHostsPath } : {}),
    ...(commandResult.expectedHostKeySha256
      ? { expectedHostKeySha256: commandResult.expectedHostKeySha256 }
      : {}),
  };
}

async function runCredentialCommand(
  request: ConnectorCredentialRequest,
  config: ServerConfig["connector"],
): Promise<z.infer<typeof CommandCredentialResponseSchema>> {
  const command = config.credentialCommand;
  if (!command) {
    throw new Error("Credential command is not configured.");
  }

  const input = JSON.stringify(request);
  const timeoutMs = config.credentialCommandTimeoutMs;

  return new Promise((resolve, reject) => {
    const child = spawn(command, config.credentialCommandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        SSH_MCP_CONNECTOR_HOST_ALIAS: request.hostAlias,
        SSH_MCP_CONNECTOR_PURPOSE: request.purpose,
      },
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Credential command timed out."));
    }, timeoutMs);

    let stdout = "";
    let stdoutBytes = 0;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > 32 * 1024) {
        child.kill();
        reject(new Error("Credential command output exceeded 32 KiB."));
        return;
      }
      stdout += chunk;
    });
    child.stderr.resume();

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error("Credential command failed."));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as unknown;
        resolve(CommandCredentialResponseSchema.parse(parsed));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(input);
  });
}
