import { NodeSSH, type Config } from "node-ssh";
import type { SFTPWrapper } from "ssh2";
import { createHash, createHmac, randomUUID } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  ConnectionParams,
  SessionInfo,
  SessionResult,
  OSInfo,
  SSHMCPError,
  type HostKeyPolicy,
} from "./types.js";
import {
  createAuthError,
  createConnectionError,
  createHostKeyError,
  createPolicyError,
  createTimeoutError,
} from "./errors.js";
import { logger } from "./logging.js";
import { detectOS } from "./detect.js";
import type { ServerConfig } from "./config.js";
import type { PolicyEngine } from "./policy.js";

/**
 * SSH session with connection and optional SFTP client.
 * Some targets expose command execution but do not provide the SFTP subsystem.
 */
export interface SSHSession {
  ssh: NodeSSH;
  sftp?: SFTPWrapper;
  info: SessionInfo;
  connectionParams?: ConnectionParams; // For auto-reconnect
  osInfo?: OSInfo;
}

export type SessionCloseListener = (sessionId: string) => void | Promise<void>;

interface SSHAuthConfig {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
}

type SSHConnectConfig = Config & {
  knownHosts?: string;
  hostHash?: "md5" | "sha1" | "sha256";
};

const KNOWN_HOST_KEY_TYPES = new Set([
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

function normalizeSha256Fingerprint(fingerprint: string): string {
  return fingerprint.replace(/^SHA256:/i, "").trim();
}

function knownHostKeyFingerprints(keyBlob: string): string[] {
  const key = Buffer.from(keyBlob, "base64");
  const base64 = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  const hex = createHash("sha256").update(key).digest("hex");
  return [base64, hex];
}

/**
 * Session manager with LRU cache and TTL
 */
export class SessionManager {
  private readonly sessions = new Map<string, SSHSession>();
  private readonly maxSessions: number;
  private readonly defaultTtlMs: number;
  private cleanupInterval: NodeJS.Timeout | undefined;
  private readonly acceptedHostKeys = new Map<string, string>();
  private readonly closeListeners = new Set<SessionCloseListener>();

  constructor(
    maxSessions = 20,
    defaultTtlMs = 900_000,
    cleanupIntervalMs = 10_000,
    private readonly security: ServerConfig["security"] = {
      allowRootLogin: false,
      hostKeyPolicy: "strict",
      knownHostsPath: path.join(os.homedir(), ".ssh", "known_hosts"),
      allowedCiphers: [],
    },
    private readonly policy?: Pick<PolicyEngine, "assertAllowed">,
  ) {
    this.maxSessions = maxSessions;
    this.defaultTtlMs = defaultTtlMs;

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, cleanupIntervalMs);
    this.cleanupInterval.unref?.();
  }

  /**
   * Destroys the session manager, cleaning up all sessions and intervals
   */
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    await this.closeAllSessions();
  }

  onSessionClose(listener: SessionCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /**
   * Gets cached OS info for a session (detects and caches if needed)
   */
  async getOSInfo(sessionId: string): Promise<OSInfo> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    if (session.osInfo) {
      return session.osInfo;
    }

    const osInfo = await detectOS(session.ssh);
    session.osInfo = osInfo;
    return osInfo;
  }

  /**
   * Opens a new SSH session with authentication
   */
  async openSession(params: ConnectionParams): Promise<SessionResult> {
    logger.debug("Opening SSH session", {
      host: params.host,
      username: params.username,
    });

    const sessionId = this.generateSessionId();
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const policyMode = params.policyMode ?? "enforce";
    const hostKeyPolicy = this.resolveHostKeyPolicy(params);
    const policyHost = params.policyHost ?? params.host;

    const policyDecision = this.policy?.assertAllowed({
      action: "ssh.open",
      host: policyHost,
      username: params.username,
      mode: policyMode,
    });
    const rootDenied = params.username === "root" && !this.security.allowRootLogin;

    if (policyMode === "explain") {
      return {
        sessionId,
        host: params.host,
        username: params.username,
        sftpAvailable: false,
        expiresInMs: ttl,
        policyMode,
        hostKeyPolicy,
        wouldConnect: !rootDenied && (policyDecision?.allowed ?? true),
      };
    }

    try {
      if (rootDenied) {
        throw createPolicyError(
          "Root SSH login is disabled by policy",
          "Connect as an unprivileged user and use approved privilege escalation workflows.",
        );
      }

      // Clean up old sessions if we're at the limit
      if (this.sessions.size >= this.maxSessions) {
        this.evictOldestSession();
      }

      const ssh = new NodeSSH();
      const authConfig = await this.buildAuthConfig(params);

      const knownHostsPath = params.knownHostsPath ?? this.security.knownHostsPath;

      const connectConfig: SSHConnectConfig = {
        host: params.host,
        username: params.username,
        port: params.port ?? 22,
        readyTimeout: params.readyTimeoutMs ?? 20000,
        ...authConfig,
      };
      if (this.security.allowedCiphers.length > 0) {
        connectConfig.algorithms = {
          ...connectConfig.algorithms,
          cipher: this.security.allowedCiphers as never,
        };
      }

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

      logger.debug("Connecting to SSH server");
      await ssh.connect(connectConfig);

      let sftp: SFTPWrapper | undefined;
      let sftpAvailable = false;
      try {
        sftp = await ssh.requestSFTP();
        sftpAvailable = true;
      } catch (sftpError) {
        logger.warn("SFTP unavailable, continuing with SSH-only session", {
          host: params.host,
          username: params.username,
          error: sftpError instanceof Error ? sftpError.message : String(sftpError),
        });
      }

      if (hostKeyPolicy !== "strict") {
        logger.warn("Strict host key verification is not active for this session.", {
          sessionId,
          hostKeyPolicy,
        });
      }

      const sessionInfo: SessionInfo = {
        sessionId,
        host: params.host,
        username: params.username,
        port: params.port ?? 22,
        createdAt: now,
        expiresAt: now + ttl,
        lastUsed: now,
        policyMode,
        hostKeyPolicy,
      };

      const session: SSHSession = {
        ssh,
        info: sessionInfo,
        connectionParams: params,
        ...(sftp ? { sftp } : {}),
      };

      this.sessions.set(sessionId, session);

      logger.info("SSH session opened successfully", {
        sessionId,
        host: params.host,
        username: params.username,
        sftpAvailable,
        expiresInMs: ttl,
      });

      return {
        sessionId,
        host: params.host,
        username: params.username,
        sftpAvailable,
        expiresInMs: ttl,
        policyMode,
        hostKeyPolicy,
      };
    } catch (error) {
      logger.error("Failed to open SSH session", { error, host: params.host });

      if (error instanceof SSHMCPError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.message.includes("authentication")) {
          throw createAuthError(
            "SSH authentication failed",
            "Check your username, password, or SSH key configuration",
          );
        }
        if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
          throw createTimeoutError(
            "SSH connection timeout",
            "Check if the host is reachable and the SSH service is running",
          );
        }
        if (error.message.includes("ECONNREFUSED")) {
          throw createConnectionError(
            "SSH connection refused",
            "Check if the SSH service is running on the target port",
          );
        }
        if (error.message.toLowerCase().includes("host key")) {
          throw createHostKeyError(
            "SSH host key verification failed",
            "Check known_hosts, hostKeyPolicy, or expectedHostKeySha256",
          );
        }
        if (error.message.toLowerCase().includes("host denied")) {
          throw createHostKeyError(
            "SSH host key verification failed",
            "Check known_hosts, hostKeyPolicy, or expectedHostKeySha256",
          );
        }
      }

      throw createConnectionError(
        `Failed to establish SSH connection: ${error instanceof Error ? error.message : String(error)}`,
        "Verify the host, port, and network connectivity",
      );
    }
  }

  /**
   * Closes an SSH session
   */
  async closeSession(sessionId: string): Promise<boolean> {
    logger.debug("Closing SSH session", { sessionId });

    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn("Session not found for closing", { sessionId });
      return false;
    }

    try {
      await this.notifySessionClose(sessionId);
      if (session.sftp) {
        session.sftp.end();
      }
      session.ssh.dispose();
    } catch (error) {
      logger.warn("Error closing session", { sessionId, error });
    }

    this.sessions.delete(sessionId);
    logger.info("SSH session closed", { sessionId });
    return true;
  }

  /**
   * Gets an active session by ID
   */
  getSession(sessionId: string): SSHSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    if (Date.now() > session.info.expiresAt) {
      void this.closeSession(sessionId);
      return undefined;
    }

    session.info.lastUsed = Date.now();
    return session;
  }

  /**
   * Builds authentication configuration based on the auth strategy
   */
  private async buildAuthConfig(params: ConnectionParams): Promise<SSHAuthConfig> {
    const authStrategy = params.auth ?? "auto";

    logger.debug("Building auth config", { strategy: authStrategy });

    switch (authStrategy) {
      case "password":
        if (!params.password) {
          throw createAuthError("Password required for password authentication");
        }
        return { password: params.password };
      case "key":
        return await this.buildKeyAuth(params);
      case "agent":
        return await this.buildAgentAuth();
      case "auto":
      default:
        return await this.buildAutoAuth(params);
    }
  }

  /**
   * Builds key-based authentication
   */
  private async buildKeyAuth(params: ConnectionParams): Promise<SSHAuthConfig> {
    if (params.privateKey) {
      logger.debug("Using inline private key");
      return {
        privateKey: params.privateKey,
        ...(params.passphrase !== undefined ? { passphrase: params.passphrase } : {}),
      };
    }

    if (params.privateKeyPath) {
      logger.debug("Using private key from path", {
        path: params.privateKeyPath,
      });
      return await this.loadPrivateKeyFromPath(params.privateKeyPath, params.passphrase);
    }

    return await this.discoverPrivateKeys(params.passphrase);
  }

  /**
   * Builds SSH agent authentication
   */
  private async buildAgentAuth(): Promise<SSHAuthConfig> {
    const authSock = process.env.SSH_AUTH_SOCK;
    if (!authSock) {
      throw createAuthError(
        "SSH agent not available",
        "Set SSH_AUTH_SOCK environment variable or use a different auth method",
      );
    }

    logger.debug("Using SSH agent authentication");
    return { agent: authSock };
  }

  /**
   * Builds automatic authentication (tries password, then key, then agent)
   */
  private async buildAutoAuth(params: ConnectionParams): Promise<SSHAuthConfig> {
    if (params.password) {
      logger.debug("Auto auth: trying password");
      return { password: params.password };
    }

    try {
      logger.debug("Auto auth: trying key authentication");
      return await this.buildKeyAuth(params);
    } catch {
      logger.debug("Auto auth: key authentication failed, trying agent");
    }

    try {
      return await this.buildAgentAuth();
    } catch {
      throw createAuthError(
        "No suitable authentication method found",
        "Provide a password, private key, or ensure SSH agent is running",
      );
    }
  }

  /**
   * Loads private key from file path
   */
  private async loadPrivateKeyFromPath(
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

  /**
   * Auto-discovers private keys in standard locations
   */
  private async discoverPrivateKeys(passphrase?: string): Promise<SSHAuthConfig> {
    const homeDir = os.homedir();
    const keyDir = process.env.SSH_DEFAULT_KEY_DIR ?? path.join(homeDir, ".ssh");

    const keyFiles = ["id_ed25519", "id_ecdsa", "id_ed25519_sk", "id_ecdsa_sk", "id_rsa"];

    for (const keyFile of keyFiles) {
      const keyPath = path.join(keyDir, keyFile);

      try {
        await fs.promises.access(keyPath, fs.constants.R_OK);
        logger.debug("Found SSH key", { path: keyPath });
        return await this.loadPrivateKeyFromPath(keyPath, passphrase);
      } catch {
        logger.debug("SSH key not found or not readable", { path: keyPath });
      }
    }

    throw createAuthError(
      "No SSH private keys found in standard locations",
      `Checked: ${keyFiles.map((f) => path.join(keyDir, f)).join(", ")}`,
    );
  }

  /**
   * Generates a unique session ID
   */
  private generateSessionId(): string {
    return `ssh-${randomUUID()}`;
  }

  private async notifySessionClose(sessionId: string): Promise<void> {
    const listenerTimeoutMs = 5_000;
    const runListener = async (listener: SessionCloseListener): Promise<void> => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => listener(sessionId)),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Session close listener timed out")),
              listenerTimeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    };

    const results = await Promise.allSettled(
      Array.from(this.closeListeners).map((listener) => runListener(listener)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn("Session close listener failed", { sessionId, error: result.reason });
      }
    }
  }

  private resolveHostKeyPolicy(params: ConnectionParams): HostKeyPolicy {
    if (params.hostKeyPolicy) {
      return params.hostKeyPolicy;
    }
    if (params.strictHostKeyChecking !== undefined) {
      return params.strictHostKeyChecking ? "strict" : "insecure";
    }
    return this.security.hostKeyPolicy;
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
      const parsed = this.parseKnownHostLine(line);
      if (!parsed || !this.knownHostPatternMatches(parsed.hosts, host, port)) {
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

  private parseKnownHostLine(
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

  private knownHostPatternMatches(hosts: string, host: string, port: number): boolean {
    const candidates = new Set([host, `[${host}]:${port}`]);

    for (const pattern of hosts.split(",")) {
      if (pattern.startsWith("|")) {
        if (this.hashedKnownHostPatternMatches(pattern, candidates)) {
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
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
      );
      if (regex.test(host)) {
        return true;
      }
    }

    return false;
  }

  private hashedKnownHostPatternMatches(pattern: string, candidates: Set<string>): boolean {
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

  /**
   * Evicts the oldest (least recently used) session
   */
  private evictOldestSession(): void {
    let oldestSession: string | undefined;
    let oldestTime = Date.now();

    for (const [sessionId, session] of this.sessions) {
      if (session.info.lastUsed < oldestTime) {
        oldestTime = session.info.lastUsed;
        oldestSession = sessionId;
      }
    }

    if (oldestSession) {
      logger.info("Evicting oldest session", { sessionId: oldestSession });
      void this.closeSession(oldestSession);
    }
  }

  /**
   * Cleans up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now > session.info.expiresAt) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      logger.info("Cleaning up expired session", { sessionId });
      void this.closeSession(sessionId);
    }
  }

  /**
   * Gets information about all active sessions
   */
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      ...session.info,
    }));
  }

  /**
   * Closes all active sessions
   */
  async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));
  }

  /**
   * Attempts to reconnect a session
   */
  async reconnectSession(sessionId: string): Promise<SessionResult | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn("Session not found for reconnect", { sessionId });
      return null;
    }

    if (!session.connectionParams) {
      logger.warn("Session has no stored connection params", { sessionId });
      return null;
    }

    logger.info("Attempting to reconnect session", {
      sessionId,
      host: session.info.host,
    });

    await this.closeSession(sessionId);

    try {
      const result = await this.openSession(session.connectionParams);
      logger.info("Session reconnected successfully", {
        oldSessionId: sessionId,
        newSessionId: result.sessionId,
      });
      return result;
    } catch (error) {
      logger.error("Failed to reconnect session", { sessionId, error });
      throw error;
    }
  }

  /**
   * Checks if a session is alive by executing a simple command
   */
  async isSessionAlive(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      const result = await session.ssh.execCommand("echo 1");
      return result.code === 0;
    } catch (error) {
      logger.debug("Session health check failed", { sessionId, error });
      return false;
    }
  }

  /**
   * Gets session with auto-reconnect if disconnected
   */
  async getSessionWithReconnect(sessionId: string): Promise<SSHSession | undefined> {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    if (!(await this.isSessionAlive(sessionId))) {
      logger.info("Session disconnected, attempting reconnect", { sessionId });

      if (session.connectionParams) {
        try {
          await this.reconnectSession(sessionId);
          return undefined;
        } catch (error) {
          logger.error("Auto-reconnect failed", { sessionId, error });
          return undefined;
        }
      }
    }

    return session;
  }
}
