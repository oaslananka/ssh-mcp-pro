import * as fs from "node:fs";
import { buildSessionAuthConfig } from "./session-auth-config.js";
import {
  normalizeSha256Fingerprint,
  knownHostKeyFingerprints,
  parseKnownHostLine,
  knownHostPatternMatches,
  type SSHConnectConfig,
} from "./session-auth.js";
import {
  createAuthError,
  createConnectionError,
  createHostKeyError,
  createTimeoutError,
} from "./errors.js";
import { logger } from "./logging.js";
import type { ServerConfig } from "./config.js";
import { SSHMCPError, type ConnectionParams, type HostKeyPolicy } from "./types.js";

export function translateSshConnectionError(error: unknown): SSHMCPError {
  if (error instanceof SSHMCPError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.message.includes("authentication")) {
      return createAuthError(
        "SSH authentication failed",
        "Check your username, password, or SSH key configuration",
      );
    }
    if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
      return createTimeoutError(
        "SSH connection timeout",
        "Check if the host is reachable and the SSH service is running",
      );
    }
    if (error.message.includes("ECONNREFUSED")) {
      return createConnectionError(
        "SSH connection refused",
        "Check if the SSH service is running on the target port",
      );
    }
    if (
      error.message.toLowerCase().includes("host key") ||
      error.message.toLowerCase().includes("host denied")
    ) {
      return createHostKeyError(
        "SSH host key verification failed",
        "Check known_hosts, hostKeyPolicy, or expectedHostKeySha256",
      );
    }
  }

  return createConnectionError(
    `Failed to establish SSH connection: ${error instanceof Error ? error.message : String(error)}`,
    "Verify the host, port, and network connectivity",
  );
}

export class SessionConnectionConfig {
  private readonly acceptedHostKeys = new Map<string, string>();

  async build(
    params: ConnectionParams,
    security: ServerConfig["security"],
    hostKeyPolicy: HostKeyPolicy,
  ): Promise<SSHConnectConfig> {
    const authConfig = await buildSessionAuthConfig(params);

    const knownHostsPath = params.knownHostsPath ?? security.knownHostsPath;

    const connectConfig: SSHConnectConfig = {
      host: params.host,
      username: params.username,
      port: params.port ?? 22,
      readyTimeout: params.readyTimeoutMs ?? 20000,
      ...authConfig,
    };
    if (security.allowedCiphers.length > 0) {
      connectConfig.algorithms = {
        ...connectConfig.algorithms,
        cipher: security.allowedCiphers as never,
      };
    }

    this.configureHostKeyVerification(connectConfig, params, hostKeyPolicy, knownHostsPath);

    return connectConfig;
  }

  private configureHostKeyVerification(
    connectConfig: SSHConnectConfig,
    params: ConnectionParams,
    hostKeyPolicy: HostKeyPolicy,
    knownHostsPath: string,
  ): void {
    if (params.expectedHostKeySha256) {
      connectConfig.hostHash = "sha256";
      connectConfig.hostVerifier = (hashedKey: string) =>
        normalizeSha256Fingerprint(hashedKey) ===
        normalizeSha256Fingerprint(params.expectedHostKeySha256 ?? "");
    } else if (hostKeyPolicy === "insecure") {
      connectConfig.hostVerifier = () => true;
    } else if (hostKeyPolicy === "accept-new") {
      connectConfig.hostHash = "sha256";
      connectConfig.hostVerifier = (hashedKey: string) =>
        this.verifyAcceptNewHostKey(params.host, params.port ?? 22, hashedKey);
    } else {
      connectConfig.hostHash = "sha256";
      connectConfig.hostVerifier = (hashedKey: string) =>
        this.verifyKnownHostKey(params.host, params.port ?? 22, knownHostsPath, hashedKey);
    }
  }

  resolveHostKeyPolicy(params: ConnectionParams, defaultPolicy: HostKeyPolicy): HostKeyPolicy {
    if (params.hostKeyPolicy) {
      return params.hostKeyPolicy;
    }
    if (params.strictHostKeyChecking !== undefined) {
      return params.strictHostKeyChecking ? "strict" : "insecure";
    }
    return defaultPolicy;
  }

  private verifyAcceptNewHostKey(host: string, port: number, hashedKey: string): boolean {
    const key = `${host}:${port}`;
    const normalized = normalizeSha256Fingerprint(hashedKey);
    const accepted = this.acceptedHostKeys.get(key);

    if (!accepted) {
      this.acceptedHostKeys.set(key, normalized);
      logger.warn("Accepted first-seen SSH host key for this process only", { host, port });
      return true;
    }

    return accepted === normalized;
  }

  private verifyKnownHostKey(
    host: string,
    port: number,
    knownHostsPath: string,
    hashedKey: string,
  ): boolean {
    if (!knownHostsPath) {
      return false;
    }

    let contents: string;
    try {
      contents = fs.readFileSync(knownHostsPath, "utf8");
    } catch {
      return false;
    }

    const expected = normalizeSha256Fingerprint(hashedKey);
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseKnownHostLine(line);
      if (!parsed || !knownHostPatternMatches(parsed.hosts, host, port)) {
        continue;
      }

      if (parsed.marker === "@revoked") {
        return false;
      }

      try {
        const fingerprints = knownHostKeyFingerprints(parsed.keyBlob);
        if (
          fingerprints.some((fingerprint) => normalizeSha256Fingerprint(fingerprint) === expected)
        ) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }
}
