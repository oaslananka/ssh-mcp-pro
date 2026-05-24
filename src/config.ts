import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "./logging.js";
import { parseToolProfile, type ToolProfile } from "./connector-profile.js";
import type { PolicyConfig } from "./policy.js";
import type { HostKeyPolicy } from "./types.js";

export const CONNECTOR_CREDENTIAL_PROVIDERS = ["none", "agent", "command"] as const;
export type ConnectorCredentialProvider = (typeof CONNECTOR_CREDENTIAL_PROVIDERS)[number];

/**
 * Server configuration options
 */
export interface ServerConfig {
  /** Maximum concurrent sessions */
  maxSessions: number;
  /** Default session TTL in milliseconds */
  sessionTtlMs: number;
  /** Session cleanup interval in milliseconds */
  cleanupIntervalMs: number;
  /** Default command timeout in milliseconds */
  commandTimeoutMs: number;
  /** Maximum buffered stdout/stderr per command result (bytes) */
  maxCommandOutputBytes: number;
  /** Maximum streaming chunks retained in memory */
  maxStreamChunks: number;
  /** Maximum file size for read operations (bytes) */
  maxFileSize: number;
  /** Maximum file write payload size accepted before buffering (bytes) */
  maxFileWriteBytes: number;
  /** Maximum file transfer size (bytes) */
  maxTransferBytes: number;
  /** Enable debug logging */
  debug: boolean;
  /** Rate limiting configuration */
  rateLimit: {
    enabled: boolean;
    maxRequests: number;
    windowMs: number;
    perSession: {
      enabled: boolean;
      maxRequests: number;
      windowMs: number;
    };
  };
  /** Security settings */
  security: {
    allowRootLogin: boolean;
    hostKeyPolicy: HostKeyPolicy;
    knownHostsPath: string;
    allowedCiphers: string[];
  };
  /** Policy settings enforced before risky operations */
  policy: PolicyConfig;
  /** Remote HTTP transport settings */
  http: {
    host: string;
    port: number;
    allowedOrigins: string[];
    bearerTokenFile?: string;
    enableLegacySse: boolean;
    maxRequestBodyBytes: number;
    maxSessions: number;
    sessionIdleTtlMs: number;
    publicUrl?: string;
    trustProxy: boolean;
  };
  /** Remote ChatGPT/Claude connector settings */
  connector: {
    toolProfile: ToolProfile;
    credentialProvider: ConnectorCredentialProvider;
    credentialCommand?: string;
    credentialCommandArgs: string[];
    credentialCommandTimeoutMs: number;
    defaultUsername?: string;
  };
  /** HTTP authorization settings for remote MCP clients */
  auth: {
    mode: "bearer" | "oauth";
    oauthIssuer?: string;
    oauthAudience?: string;
    oauthJwksUrl?: string;
    oauthResource?: string;
    oauthRequiredScopes: string[];
  };
}

export const DEFAULT_CONFIG: ServerConfig = {
  maxSessions: 20,
  sessionTtlMs: 900000, // 15 minutes
  cleanupIntervalMs: 10000, // 10 seconds
  commandTimeoutMs: 30000, // 30 seconds
  maxCommandOutputBytes: 1024 * 1024, // 1MB
  maxStreamChunks: 4096,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFileWriteBytes: 10 * 1024 * 1024, // 10MB
  maxTransferBytes: 50 * 1024 * 1024, // 50MB
  debug: false,
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60000,
    perSession: {
      enabled: true,
      maxRequests: 50,
      windowMs: 60000,
    },
  },
  security: {
    allowRootLogin: false,
    hostKeyPolicy: "strict",
    knownHostsPath: path.join(os.homedir(), ".ssh", "known_hosts"),
    allowedCiphers: [],
  },
  policy: {
    mode: "enforce",
    allowRootLogin: false,
    allowRawSudo: false,
    allowDestructiveCommands: false,
    allowDestructiveFs: false,
    allowedHosts: [],
    commandAllow: [],
    commandDeny: [],
    pathAllowPrefixes: ["/tmp", "/var/tmp", "/home", "/Users"],
    pathDenyPrefixes: ["/etc/sudoers", "/etc/shadow", "/etc/passwd", "/boot", "/dev", "/proc"],
    localPathAllowPrefixes: [os.tmpdir()],
    localPathDenyPrefixes: [],
    tunnelAllowBindHosts: ["127.0.0.1", "localhost", "::1"],
    tunnelDenyBindHosts: ["0.0.0.0", "::"],
    tunnelAllowRemoteHosts: [],
    tunnelDenyRemoteHosts: [],
    tunnelAllowPorts: [],
    tunnelDenyPorts: [],
  },
  http: {
    host: "127.0.0.1",
    port: 3000,
    allowedOrigins: ["http://127.0.0.1", "http://localhost"],
    enableLegacySse: false,
    maxRequestBodyBytes: 1024 * 1024,
    maxSessions: 20,
    sessionIdleTtlMs: 900_000,
    trustProxy: false,
  },
  connector: {
    toolProfile: "full",
    credentialProvider: "none",
    credentialCommandArgs: [],
    credentialCommandTimeoutMs: 5000,
  },
  auth: {
    mode: "bearer",
    oauthRequiredScopes: ["ssh-mcp-pro.read"],
  },
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHostKeyPolicy(value: string | undefined, fallback: HostKeyPolicy): HostKeyPolicy {
  if (value === "strict" || value === "accept-new" || value === "insecure") {
    return value;
  }
  return fallback;
}

function parseCredentialProvider(
  value: string | undefined,
  fallback: ConnectorCredentialProvider,
): ConnectorCredentialProvider {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (CONNECTOR_CREDENTIAL_PROVIDERS.includes(value as ConnectorCredentialProvider)) {
    return value as ConnectorCredentialProvider;
  }
  return fallback;
}

function parseAuthMode(
  value: string | undefined,
  fallback: "bearer" | "oauth",
): "bearer" | "oauth" {
  return value === "oauth" || value === "bearer" ? value : fallback;
}

function loadPolicyFile(filePath: string | undefined): Partial<PolicyConfig> {
  if (!filePath) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Partial<PolicyConfig>;
  } catch (error) {
    logger.error("Failed to load explicitly configured policy file", {
      filePath,
      error,
    });
    throw new Error(
      `Invalid SSH_MCP_POLICY_FILE ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Configuration manager with environment variable overrides
 */
export class ConfigManager {
  private config: ServerConfig;

  constructor(overrides: Partial<ServerConfig> = {}) {
    this.config = this.loadConfig(overrides);
    logger.debug("Configuration loaded", { config: this.config });
  }

  private loadConfig(overrides: Partial<ServerConfig>): ServerConfig {
    // Start with defaults
    const config: ServerConfig = {
      ...DEFAULT_CONFIG,
      rateLimit: {
        ...DEFAULT_CONFIG.rateLimit,
        perSession: { ...DEFAULT_CONFIG.rateLimit.perSession },
      },
      security: {
        ...DEFAULT_CONFIG.security,
        allowedCiphers: [...DEFAULT_CONFIG.security.allowedCiphers],
      },
    };

    // Apply environment variable overrides
    config.maxSessions = parseInteger(process.env.SSH_MCP_MAX_SESSIONS, config.maxSessions);
    config.sessionTtlMs = parseInteger(process.env.SSH_MCP_SESSION_TTL, config.sessionTtlMs);
    config.commandTimeoutMs = parseInteger(
      process.env.SSH_MCP_COMMAND_TIMEOUT,
      config.commandTimeoutMs,
    );
    config.maxCommandOutputBytes = parseInteger(
      process.env.SSH_MCP_MAX_COMMAND_OUTPUT_BYTES,
      config.maxCommandOutputBytes,
    );
    config.maxStreamChunks = parseInteger(
      process.env.SSH_MCP_MAX_STREAM_CHUNKS,
      config.maxStreamChunks,
    );
    config.maxFileSize = parseInteger(process.env.SSH_MCP_MAX_FILE_SIZE, config.maxFileSize);
    config.maxFileWriteBytes = parseInteger(
      process.env.SSH_MCP_MAX_FILE_WRITE_BYTES,
      config.maxFileWriteBytes,
    );
    config.maxTransferBytes = parseInteger(
      process.env.SSH_MCP_MAX_TRANSFER_BYTES,
      config.maxTransferBytes,
    );
    config.debug = parseBoolean(process.env.SSH_MCP_DEBUG, config.debug);
    config.rateLimit.enabled = parseBoolean(
      process.env.SSH_MCP_RATE_LIMIT,
      config.rateLimit.enabled,
    );
    config.rateLimit.maxRequests = parseInteger(
      process.env.SSH_MCP_RATE_LIMIT_MAX,
      config.rateLimit.maxRequests,
    );
    config.rateLimit.perSession.maxRequests = parseInteger(
      process.env.SSH_MCP_RATE_LIMIT_PER_SESSION_MAX,
      config.rateLimit.perSession.maxRequests,
    );
    config.rateLimit.windowMs = parseInteger(
      process.env.SSH_MCP_RATE_LIMIT_WINDOW_MS,
      config.rateLimit.windowMs,
    );

    const strictHostKeyChecking =
      process.env.STRICT_HOST_KEY_CHECKING ?? process.env.SSH_MCP_STRICT_HOST_KEY;
    if (strictHostKeyChecking !== undefined) {
      config.security.hostKeyPolicy = parseBoolean(strictHostKeyChecking, true)
        ? "strict"
        : "insecure";
    }
    config.security.hostKeyPolicy = parseHostKeyPolicy(
      process.env.SSH_MCP_HOST_KEY_POLICY,
      config.security.hostKeyPolicy,
    );
    config.security.knownHostsPath =
      process.env.KNOWN_HOSTS_PATH ??
      process.env.SSH_MCP_KNOWN_HOSTS_PATH ??
      config.security.knownHostsPath;
    config.security.allowRootLogin = parseBoolean(
      process.env.SSH_MCP_ALLOW_ROOT_LOGIN,
      config.security.allowRootLogin,
    );
    config.security.allowedCiphers = parseList(process.env.SSH_MCP_ALLOWED_CIPHERS);

    const filePolicy = loadPolicyFile(process.env.SSH_MCP_POLICY_FILE);
    config.policy = {
      ...config.policy,
      ...filePolicy,
      mode:
        process.env.SSH_MCP_POLICY_MODE === "explain"
          ? "explain"
          : (filePolicy.mode ?? config.policy.mode),
      allowRootLogin: config.security.allowRootLogin,
      allowRawSudo: parseBoolean(
        process.env.SSH_MCP_ALLOW_RAW_SUDO,
        filePolicy.allowRawSudo ?? config.policy.allowRawSudo,
      ),
      allowDestructiveCommands: parseBoolean(
        process.env.SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS,
        filePolicy.allowDestructiveCommands ?? config.policy.allowDestructiveCommands,
      ),
      allowDestructiveFs: parseBoolean(
        process.env.SSH_MCP_ALLOW_DESTRUCTIVE_FS,
        filePolicy.allowDestructiveFs ?? config.policy.allowDestructiveFs,
      ),
      allowedHosts: parseList(process.env.SSH_MCP_ALLOWED_HOSTS).length
        ? parseList(process.env.SSH_MCP_ALLOWED_HOSTS)
        : (filePolicy.allowedHosts ?? config.policy.allowedHosts),
      commandAllow: parseList(process.env.SSH_MCP_COMMAND_ALLOW).length
        ? parseList(process.env.SSH_MCP_COMMAND_ALLOW)
        : (filePolicy.commandAllow ?? config.policy.commandAllow),
      commandDeny: parseList(process.env.SSH_MCP_COMMAND_DENY).length
        ? parseList(process.env.SSH_MCP_COMMAND_DENY)
        : (filePolicy.commandDeny ?? config.policy.commandDeny),
      pathAllowPrefixes: parseList(process.env.SSH_MCP_PATH_ALLOW_PREFIXES).length
        ? parseList(process.env.SSH_MCP_PATH_ALLOW_PREFIXES)
        : (filePolicy.pathAllowPrefixes ?? config.policy.pathAllowPrefixes),
      pathDenyPrefixes: parseList(process.env.SSH_MCP_PATH_DENY_PREFIXES).length
        ? parseList(process.env.SSH_MCP_PATH_DENY_PREFIXES)
        : (filePolicy.pathDenyPrefixes ?? config.policy.pathDenyPrefixes),
      localPathAllowPrefixes: parseList(process.env.SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES).length
        ? parseList(process.env.SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES)
        : (filePolicy.localPathAllowPrefixes ?? config.policy.localPathAllowPrefixes),
      localPathDenyPrefixes: parseList(process.env.SSH_MCP_LOCAL_PATH_DENY_PREFIXES).length
        ? parseList(process.env.SSH_MCP_LOCAL_PATH_DENY_PREFIXES)
        : (filePolicy.localPathDenyPrefixes ?? config.policy.localPathDenyPrefixes),
      tunnelAllowBindHosts: parseList(process.env.SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS).length
        ? parseList(process.env.SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS)
        : (filePolicy.tunnelAllowBindHosts ?? config.policy.tunnelAllowBindHosts),
      tunnelDenyBindHosts: parseList(process.env.SSH_MCP_TUNNEL_DENY_BIND_HOSTS).length
        ? parseList(process.env.SSH_MCP_TUNNEL_DENY_BIND_HOSTS)
        : (filePolicy.tunnelDenyBindHosts ?? config.policy.tunnelDenyBindHosts),
      tunnelAllowRemoteHosts: parseList(process.env.SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS).length
        ? parseList(process.env.SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS)
        : (filePolicy.tunnelAllowRemoteHosts ?? config.policy.tunnelAllowRemoteHosts),
      tunnelDenyRemoteHosts: parseList(process.env.SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS).length
        ? parseList(process.env.SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS)
        : (filePolicy.tunnelDenyRemoteHosts ?? config.policy.tunnelDenyRemoteHosts),
      tunnelAllowPorts: parseList(process.env.SSH_MCP_TUNNEL_ALLOW_PORTS).length
        ? parseList(process.env.SSH_MCP_TUNNEL_ALLOW_PORTS)
        : (filePolicy.tunnelAllowPorts ?? config.policy.tunnelAllowPorts),
      tunnelDenyPorts: parseList(process.env.SSH_MCP_TUNNEL_DENY_PORTS).length
        ? parseList(process.env.SSH_MCP_TUNNEL_DENY_PORTS)
        : (filePolicy.tunnelDenyPorts ?? config.policy.tunnelDenyPorts),
    };
    config.policy.allowRootLogin = config.security.allowRootLogin;

    const bearerTokenFile =
      process.env.SSH_MCP_HTTP_BEARER_TOKEN_FILE ?? config.http.bearerTokenFile;
    const publicUrl = process.env.SSH_MCP_HTTP_PUBLIC_URL ?? config.http.publicUrl;
    config.http = {
      ...config.http,
      host: process.env.SSH_MCP_HTTP_HOST ?? config.http.host,
      port: parseInteger(process.env.PORT ?? process.env.SSH_MCP_HTTP_PORT, config.http.port),
      allowedOrigins: parseList(process.env.SSH_MCP_HTTP_ALLOWED_ORIGINS).length
        ? parseList(process.env.SSH_MCP_HTTP_ALLOWED_ORIGINS)
        : config.http.allowedOrigins,
      ...(bearerTokenFile ? { bearerTokenFile } : {}),
      enableLegacySse: parseBoolean(
        process.env.SSH_MCP_ENABLE_LEGACY_SSE,
        config.http.enableLegacySse,
      ),
      maxRequestBodyBytes: parseInteger(
        process.env.SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES,
        config.http.maxRequestBodyBytes,
      ),
      maxSessions: parseInteger(process.env.SSH_MCP_HTTP_MAX_SESSIONS, config.http.maxSessions),
      sessionIdleTtlMs: parseInteger(
        process.env.SSH_MCP_HTTP_SESSION_IDLE_TTL_MS,
        config.http.sessionIdleTtlMs,
      ),
      trustProxy: parseBoolean(process.env.SSH_MCP_HTTP_TRUST_PROXY, config.http.trustProxy),
      ...(publicUrl ? { publicUrl } : {}),
    };

    const connectorCredentialCommand =
      process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND ?? config.connector.credentialCommand;
    const connectorDefaultUsername =
      process.env.SSH_MCP_CONNECTOR_DEFAULT_USERNAME ?? config.connector.defaultUsername;
    config.connector = {
      ...config.connector,
      toolProfile: parseToolProfile(
        process.env.SSH_MCP_TOOL_PROFILE ?? process.env.SSH_MCP_CONNECTOR_PROFILE,
        config.connector.toolProfile,
      ),
      credentialProvider: parseCredentialProvider(
        process.env.SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER,
        config.connector.credentialProvider,
      ),
      ...(connectorCredentialCommand ? { credentialCommand: connectorCredentialCommand } : {}),
      credentialCommandArgs: parseList(process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_ARGS).length
        ? parseList(process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_ARGS)
        : config.connector.credentialCommandArgs,
      credentialCommandTimeoutMs: parseInteger(
        process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_TIMEOUT_MS,
        config.connector.credentialCommandTimeoutMs,
      ),
      ...(connectorDefaultUsername ? { defaultUsername: connectorDefaultUsername } : {}),
    };

    const oauthIssuer = process.env.SSH_MCP_OAUTH_ISSUER ?? config.auth.oauthIssuer;
    const oauthAudience = process.env.SSH_MCP_OAUTH_AUDIENCE ?? config.auth.oauthAudience;
    const oauthJwksUrl = process.env.SSH_MCP_OAUTH_JWKS_URL ?? config.auth.oauthJwksUrl;
    const oauthResource = process.env.SSH_MCP_OAUTH_RESOURCE ?? config.auth.oauthResource;
    config.auth = {
      ...config.auth,
      mode: parseAuthMode(process.env.SSH_MCP_HTTP_AUTH_MODE, config.auth.mode),
      ...(oauthIssuer ? { oauthIssuer } : {}),
      ...(oauthAudience ? { oauthAudience } : {}),
      ...(oauthJwksUrl ? { oauthJwksUrl } : {}),
      ...(oauthResource ? { oauthResource } : {}),
      oauthRequiredScopes: parseList(process.env.SSH_MCP_OAUTH_REQUIRED_SCOPES).length
        ? parseList(process.env.SSH_MCP_OAUTH_REQUIRED_SCOPES)
        : config.auth.oauthRequiredScopes,
    };

    // Apply programmatic overrides last
    const security = {
      ...config.security,
      ...overrides.security,
      allowedCiphers: overrides.security?.allowedCiphers ?? [...config.security.allowedCiphers],
    };
    const policy = {
      ...config.policy,
      ...overrides.policy,
      allowRootLogin: overrides.policy?.allowRootLogin ?? security.allowRootLogin,
      allowedHosts: overrides.policy?.allowedHosts ?? [...config.policy.allowedHosts],
      commandAllow: overrides.policy?.commandAllow ?? [...config.policy.commandAllow],
      commandDeny: overrides.policy?.commandDeny ?? [...config.policy.commandDeny],
      pathAllowPrefixes: overrides.policy?.pathAllowPrefixes ?? [
        ...config.policy.pathAllowPrefixes,
      ],
      pathDenyPrefixes: overrides.policy?.pathDenyPrefixes ?? [...config.policy.pathDenyPrefixes],
      localPathAllowPrefixes: overrides.policy?.localPathAllowPrefixes ?? [
        ...(config.policy.localPathAllowPrefixes ?? []),
      ],
      localPathDenyPrefixes: overrides.policy?.localPathDenyPrefixes ?? [
        ...(config.policy.localPathDenyPrefixes ?? []),
      ],
      tunnelAllowBindHosts: overrides.policy?.tunnelAllowBindHosts ?? [
        ...(config.policy.tunnelAllowBindHosts ?? []),
      ],
      tunnelDenyBindHosts: overrides.policy?.tunnelDenyBindHosts ?? [
        ...(config.policy.tunnelDenyBindHosts ?? []),
      ],
      tunnelAllowRemoteHosts: overrides.policy?.tunnelAllowRemoteHosts ?? [
        ...(config.policy.tunnelAllowRemoteHosts ?? []),
      ],
      tunnelDenyRemoteHosts: overrides.policy?.tunnelDenyRemoteHosts ?? [
        ...(config.policy.tunnelDenyRemoteHosts ?? []),
      ],
      tunnelAllowPorts: overrides.policy?.tunnelAllowPorts ?? [
        ...(config.policy.tunnelAllowPorts ?? []),
      ],
      tunnelDenyPorts: overrides.policy?.tunnelDenyPorts ?? [
        ...(config.policy.tunnelDenyPorts ?? []),
      ],
    };

    const rateLimit = {
      ...config.rateLimit,
      ...overrides.rateLimit,
      perSession: {
        ...config.rateLimit.perSession,
        ...overrides.rateLimit?.perSession,
      },
    };

    return {
      ...config,
      ...overrides,
      rateLimit,
      security,
      policy,
      http: {
        ...config.http,
        ...overrides.http,
        allowedOrigins: overrides.http?.allowedOrigins ?? [...config.http.allowedOrigins],
      },
      connector: {
        ...config.connector,
        ...overrides.connector,
        credentialCommandArgs: overrides.connector?.credentialCommandArgs ?? [
          ...config.connector.credentialCommandArgs,
        ],
      },
      auth: {
        ...config.auth,
        ...overrides.auth,
        oauthRequiredScopes: overrides.auth?.oauthRequiredScopes ?? [
          ...config.auth.oauthRequiredScopes,
        ],
      },
    };
  }

  /**
   * Get a configuration value
   */
  get<K extends keyof ServerConfig>(key: K): ServerConfig[K] {
    return this.config[key];
  }

  /**
   * Get the entire configuration
   */
  getAll(): Readonly<ServerConfig> {
    return Object.freeze({
      ...this.config,
      rateLimit: Object.freeze({
        ...this.config.rateLimit,
        perSession: Object.freeze({ ...this.config.rateLimit.perSession }),
      }),
      security: Object.freeze({
        ...this.config.security,
        allowedCiphers: [...this.config.security.allowedCiphers],
      }),
      policy: Object.freeze({
        ...this.config.policy,
        allowedHosts: [...this.config.policy.allowedHosts],
        commandAllow: [...this.config.policy.commandAllow],
        commandDeny: [...this.config.policy.commandDeny],
        pathAllowPrefixes: [...this.config.policy.pathAllowPrefixes],
        pathDenyPrefixes: [...this.config.policy.pathDenyPrefixes],
        localPathAllowPrefixes: [...(this.config.policy.localPathAllowPrefixes ?? [])],
        localPathDenyPrefixes: [...(this.config.policy.localPathDenyPrefixes ?? [])],
        tunnelAllowBindHosts: [...(this.config.policy.tunnelAllowBindHosts ?? [])],
        tunnelDenyBindHosts: [...(this.config.policy.tunnelDenyBindHosts ?? [])],
        tunnelAllowRemoteHosts: [...(this.config.policy.tunnelAllowRemoteHosts ?? [])],
        tunnelDenyRemoteHosts: [...(this.config.policy.tunnelDenyRemoteHosts ?? [])],
        tunnelAllowPorts: [...(this.config.policy.tunnelAllowPorts ?? [])],
        tunnelDenyPorts: [...(this.config.policy.tunnelDenyPorts ?? [])],
      }),
      http: Object.freeze({
        ...this.config.http,
        allowedOrigins: [...this.config.http.allowedOrigins],
      }),
      connector: Object.freeze({
        ...this.config.connector,
        credentialCommandArgs: [...this.config.connector.credentialCommandArgs],
      }),
      auth: Object.freeze({
        ...this.config.auth,
        oauthRequiredScopes: [...this.config.auth.oauthRequiredScopes],
      }),
    });
  }

  /**
   * Update configuration at runtime
   */
  update(updates: Partial<ServerConfig>): void {
    const security = {
      ...this.config.security,
      ...updates.security,
      allowedCiphers: updates.security?.allowedCiphers ?? [...this.config.security.allowedCiphers],
    };
    const policy = {
      ...this.config.policy,
      ...updates.policy,
      allowRootLogin: updates.policy?.allowRootLogin ?? security.allowRootLogin,
      allowedHosts: updates.policy?.allowedHosts ?? [...this.config.policy.allowedHosts],
      commandAllow: updates.policy?.commandAllow ?? [...this.config.policy.commandAllow],
      commandDeny: updates.policy?.commandDeny ?? [...this.config.policy.commandDeny],
      pathAllowPrefixes: updates.policy?.pathAllowPrefixes ?? [
        ...this.config.policy.pathAllowPrefixes,
      ],
      pathDenyPrefixes: updates.policy?.pathDenyPrefixes ?? [
        ...this.config.policy.pathDenyPrefixes,
      ],
      localPathAllowPrefixes: updates.policy?.localPathAllowPrefixes ?? [
        ...(this.config.policy.localPathAllowPrefixes ?? []),
      ],
      localPathDenyPrefixes: updates.policy?.localPathDenyPrefixes ?? [
        ...(this.config.policy.localPathDenyPrefixes ?? []),
      ],
      tunnelAllowBindHosts: updates.policy?.tunnelAllowBindHosts ?? [
        ...(this.config.policy.tunnelAllowBindHosts ?? []),
      ],
      tunnelDenyBindHosts: updates.policy?.tunnelDenyBindHosts ?? [
        ...(this.config.policy.tunnelDenyBindHosts ?? []),
      ],
      tunnelAllowRemoteHosts: updates.policy?.tunnelAllowRemoteHosts ?? [
        ...(this.config.policy.tunnelAllowRemoteHosts ?? []),
      ],
      tunnelDenyRemoteHosts: updates.policy?.tunnelDenyRemoteHosts ?? [
        ...(this.config.policy.tunnelDenyRemoteHosts ?? []),
      ],
      tunnelAllowPorts: updates.policy?.tunnelAllowPorts ?? [
        ...(this.config.policy.tunnelAllowPorts ?? []),
      ],
      tunnelDenyPorts: updates.policy?.tunnelDenyPorts ?? [
        ...(this.config.policy.tunnelDenyPorts ?? []),
      ],
    };

    const rateLimit = {
      ...this.config.rateLimit,
      ...updates.rateLimit,
      perSession: {
        ...this.config.rateLimit.perSession,
        ...updates.rateLimit?.perSession,
      },
    };

    this.config = {
      ...this.config,
      ...updates,
      rateLimit,
      security,
      policy,
      http: {
        ...this.config.http,
        ...updates.http,
        allowedOrigins: updates.http?.allowedOrigins ?? [...this.config.http.allowedOrigins],
      },
      connector: {
        ...this.config.connector,
        ...updates.connector,
        credentialCommandArgs: updates.connector?.credentialCommandArgs ?? [
          ...this.config.connector.credentialCommandArgs,
        ],
      },
      auth: {
        ...this.config.auth,
        ...updates.auth,
        oauthRequiredScopes: updates.auth?.oauthRequiredScopes ?? [
          ...this.config.auth.oauthRequiredScopes,
        ],
      },
    };
    logger.info("Configuration updated", { updates });
  }
}
