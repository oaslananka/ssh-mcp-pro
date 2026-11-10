import type { ConnectorCredentialProvider } from "./config-parsers.js";
import type { ToolProfile } from "./connector-profile.js";
import type { PolicyConfig } from "./policy.js";
import type { HostKeyPolicy } from "./types.js";

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
    oauthAllowedAlgorithms: string[];
  };
}
