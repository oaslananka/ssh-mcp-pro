import { createHash, createHmac, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Config } from "node-ssh";
import { createAuthError } from "./errors.js";
import type { Logger } from "./logging.js";

/**
 * SSH authentication configuration
 */
export interface SSHAuthConfig {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
}

export type SSHConnectConfig = Config & {
  knownHosts?: string;
  hostHash?: "md5" | "sha1" | "sha256";
};

export const KNOWN_HOST_KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-ed25519-cert-v01@openssh.com",
  "ssh-rsa",
  "ssh-rsa-cert-v01@openssh.com",
  "rsa-sha2-256",
  "rsa-sha2-256-cert-v01@openssh.com",
  "rsa-sha2-512",
  "rsa-sha2-512-cert-v01@openssh.com",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp256-cert-v01@openssh.com",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp384-cert-v01@openssh.com",
  "ecdsa-sha2-nistp521",
  "ecdsa-sha2-nistp521-cert-v01@openssh.com",
  "sk-ssh-ed25519@openssh.com",
  "sk-ssh-ed25519-cert-v01@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
  "sk-ecdsa-sha2-nistp256-cert-v01@openssh.com",
]);

/** Normalize a SHA256 fingerprint by stripping the SHA256: prefix. */
export function normalizeSha256Fingerprint(fingerprint: string): string {
  return fingerprint.replace(/^SHA256:/i, "").trim();
}

/** Compute SHA256 fingerprint(s) from a base64 key blob. */
export function knownHostKeyFingerprints(keyBlob: string): string[] {
  const key = Buffer.from(keyBlob, "base64");
  const base64 = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  const hex = createHash("sha256").update(key).digest("hex");
  return [base64, hex];
}

/** Generate a unique session ID. */
export function generateSessionId(): string {
  return `ssh-${randomUUID()}`;
}

/** Build SSH agent authentication config. */
export function buildAgentAuth(): SSHAuthConfig {
  const authSock = process.env.SSH_AUTH_SOCK;
  if (!authSock) {
    throw createAuthError(
      "SSH agent not available",
      "Set SSH_AUTH_SOCK environment variable or use a different auth method",
    );
  }

  return { agent: authSock };
}

/** Load a private key from a file path. */
export async function loadPrivateKeyFromPath(
  keyPath: string,
  passphrase?: string,
): Promise<SSHAuthConfig> {
  try {
    const privateKey = await fs.promises.readFile(keyPath, "utf8");
    return {
      privateKey,
      ...(passphrase !== undefined ? { passphrase } : {}),
    };
  } catch {
    throw createAuthError(
      `Failed to load private key from ${keyPath}`,
      "Check if the file exists and is readable",
    );
  }
}

/** Auto-discover private keys in standard SSH locations. */
export async function discoverPrivateKeys(
  passphrase: string | undefined,
  logger?: Logger,
): Promise<SSHAuthConfig> {
  const homeDir = os.homedir();
  const keyDir = process.env.SSH_DEFAULT_KEY_DIR ?? path.join(homeDir, ".ssh");

  const keyFiles = ["id_ed25519", "id_ecdsa", "id_ed25519_sk", "id_ecdsa_sk", "id_rsa"];

  for (const keyFile of keyFiles) {
    const keyPath = path.join(keyDir, keyFile);

    try {
      await fs.promises.access(keyPath, fs.constants.R_OK);
      logger?.debug?.("Found SSH key", { path: keyPath });
      return await loadPrivateKeyFromPath(keyPath, passphrase);
    } catch {
      logger?.debug?.("SSH key not found or not readable", { path: keyPath });
    }
  }

  throw createAuthError(
    "No SSH private keys found in standard locations",
    `Checked: ${keyFiles.map((f) => path.join(keyDir, f)).join(", ")}`,
  );
}

/** Parse a single known_hosts line into its components. */
export function parseKnownHostLine(
  line: string,
): { marker?: string; hosts: string; keyBlob: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const parts = trimmed.split(/\s+/);
  if (parts[0]?.startsWith("@")) {
    if (parts.length < 4) {
      return undefined;
    }
    if (!KNOWN_HOST_KEY_TYPES.has(parts[2] ?? "")) {
      return undefined;
    }
    return { marker: parts[0], hosts: parts[1] ?? "", keyBlob: parts[3] ?? "" };
  }

  if (parts.length < 3) {
    return undefined;
  }
  if (!KNOWN_HOST_KEY_TYPES.has(parts[1] ?? "")) {
    return undefined;
  }

  return { hosts: parts[0] ?? "", keyBlob: parts[2] ?? "" };
}

/** Check whether a known_hosts pattern matches the given host and port. */
export function knownHostPatternMatches(hosts: string, host: string, port: number): boolean {
  const candidates = new Set([host, `[${host}]:${port}`]);

  for (const pattern of hosts.split(",")) {
    if (pattern.startsWith("|")) {
      if (hashedKnownHostPatternMatches(pattern, candidates)) {
        return true;
      }
      continue;
    }

    if (candidates.has(pattern)) {
      return true;
    }

    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".")}$`,
    );
    if (regex.test(host)) {
      return true;
    }
  }

  return false;
}

/** Match a hashed known_hosts entry against a set of candidate host strings. */
export function hashedKnownHostPatternMatches(pattern: string, candidates: Set<string>): boolean {
  const match = /^\|1\|([^|]+)\|([^|]+)$/u.exec(pattern);
  if (!match) {
    return false;
  }

  try {
    const salt = Buffer.from(match[1] ?? "", "base64");
    const expected = match[2] ?? "";
    for (const candidate of candidates) {
      const digest = createHmac("sha1", salt).update(candidate).digest("base64");
      if (digest === expected) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
