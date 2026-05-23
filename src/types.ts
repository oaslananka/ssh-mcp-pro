import { z } from "zod";

/**
 * Authentication configuration for SSH connections
 */
export interface AuthConfig {
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  useAgent?: boolean;
}

/**
 * SSH connection parameters
 */
export interface ConnectionParams {
  host: string;
  policyHost?: string;
  username: string;
  port?: number;
  auth?: "auto" | "password" | "key" | "agent";
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  useAgent?: boolean;
  readyTimeoutMs?: number;
  ttlMs?: number;
  strictHostKeyChecking?: boolean;
  hostKeyPolicy?: HostKeyPolicy;
  knownHostsPath?: string;
  expectedHostKeySha256?: string;
  policyMode?: PolicyMode;
}

export type HostKeyPolicy = "strict" | "accept-new" | "insecure";
export type PolicyMode = "enforce" | "explain";

/**
 * SSH session information
 */
export interface SessionInfo {
  sessionId: string;
  host: string;
  username: string;
  port: number;
  createdAt: number;
  expiresAt: number;
  lastUsed: number;
  policyMode: PolicyMode;
  hostKeyPolicy: HostKeyPolicy;
}

/**
 * Session creation result
 */
export interface SessionResult {
  sessionId: string;
  host: string;
  username: string;
  sftpAvailable: boolean;
  expiresInMs: number;
  policyMode: PolicyMode;
  hostKeyPolicy: HostKeyPolicy;
  wouldConnect?: boolean;
}

/**
 * Command execution result
 */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * File system entry information
 */
export interface FileStatInfo {
  size: number;
  mtime: Date;
  mode: number;
  type: "file" | "directory" | "symlink" | "other";
}

/**
 * Directory listing entry
 */
export interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size?: number;
  mtime?: Date;
  mode?: number;
}

/**
 * Directory listing result with pagination
 */
export interface DirListResult {
  entries: DirEntry[];
  nextToken?: string;
}

/**
 * OS detection result
 */
export type Platform = "linux" | "darwin" | "windows" | "unknown";

export type PackageManager =
  | "apt"
  | "dnf"
  | "yum"
  | "pacman"
  | "apk"
  | "zypper"
  | "brew"
  | "choco"
  | "winget"
  | "unknown";

export type InitSystem = "systemd" | "service" | "launchd" | "windows-service" | "unknown";

export type ShellType = "bash" | "sh" | "powershell" | "cmd" | "unknown";

export interface OSInfo {
  platform: Platform;
  distro: string;
  version: string;
  arch: string;
  shell: string;
  packageManager: PackageManager;
  init: InitSystem;
  defaultShell?: ShellType;
  tempDir?: string;
}

/**
 * Package operation result
 */
export interface PackageResult {
  ok: boolean;
  pm: string;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Service operation result
 */
export interface ServiceResult {
  ok: boolean;
}

/**
 * Lines in file operation result
 */
export interface LinesInFileResult {
  ok: boolean;
  added: number;
}

/**
 * Patch application result
 */
export interface PatchResult {
  ok: boolean;
  changed: boolean;
}

/**
 * Custom error codes for SSH MCP operations
 */
export enum ErrorCode {
  EAUTH = "EAUTH",
  ECONN = "ECONN",
  ETIMEOUT = "ETIMEOUT",
  ENOSUDO = "ENOSUDO",
  EPMGR = "EPMGR",
  EFS = "EFS",
  EPATCH = "EPATCH",
  EBADREQ = "EBADREQ",
  EPOLICY = "EPOLICY",
  EHOSTKEY = "EHOSTKEY",
  ELIMIT = "ELIMIT",
  EUNSUPPORTED = "EUNSUPPORTED",
}

/**
 * Structured error class for SSH MCP operations
 * Enhanced for ChatGPT/AI assistant integration
 */
export class SSHMCPError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
    public userFriendlyMessage?: string,
    public recoverable: boolean = true,
    public suggestedAction?: string,
  ) {
    super(message);
    this.name = "SSHMCPError";
  }

  /**
   * Converts error to a JSON-serializable object for MCP responses
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      userFriendlyMessage: this.userFriendlyMessage,
      recoverable: this.recoverable,
      suggestedAction: this.suggestedAction,
    };
  }
}

// Zod schemas for input validation
const EnvKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);
const EnvMapSchema = z.record(EnvKeySchema, z.string());

export const ConnectionParamsSchema = z.object({
  host: z.string().min(1),
  username: z.string().min(1),
  port: z.number().min(1).max(65535).optional(),
  auth: z.enum(["auto", "password", "key", "agent"]).optional().default("auto"),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  privateKeyPath: z.string().optional(),
  passphrase: z.string().optional(),
  useAgent: z.boolean().optional(),
  readyTimeoutMs: z.number().min(1000).optional().default(20000),
  ttlMs: z.number().min(10000).optional().default(900000),
  strictHostKeyChecking: z.boolean().optional(),
  hostKeyPolicy: z.enum(["strict", "accept-new", "insecure"]).optional().default("strict"),
  knownHostsPath: z.string().optional(),
  expectedHostKeySha256: z.string().optional(),
  policyMode: z.enum(["enforce", "explain"]).optional().default("enforce"),
});

export const SessionIdSchema = z.object({
  sessionId: z.string().min(1),
});

export const ExecSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: EnvMapSchema.optional(),
  timeoutMs: z.number().min(1000).optional().describe("Command execution timeout in milliseconds"),
});

export const SudoSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().min(1000).optional().describe("Command execution timeout in milliseconds"),
});

export const FSReadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  encoding: z.string().optional().default("utf8"),
  maxBytes: z.number().int().min(1).optional(),
});

export const FSWriteSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  data: z.string(),
  mode: z.number().optional(),
});

export const FSStatSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

export const FSListSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  page: z.number().min(0).optional(),
  limit: z.number().min(1).max(1000).optional().default(100),
});

export const FSPathSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

export const FSRenameSchema = z.object({
  sessionId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});

export const EnsurePackageSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(["present", "absent"]).default("present"),
});

export const EnsureServiceSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(["started", "stopped", "restarted", "enabled", "disabled"]),
});

export const EnsureLinesSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  lines: z.array(z.string()),
  state: z.enum(["present", "absent"]).default("present"),
  createIfMissing: z.boolean().optional().default(true),
});

export const PatchApplySchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  diff: z.string(),
});

export const HostAliasSchema = z.object({
  hostAlias: z.string().min(1),
});

export const MetricsFormatSchema = z.object({
  format: z.enum(["json", "prometheus"]).optional().default("json"),
});

export const ExecStreamSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: EnvMapSchema.optional(),
  timeoutMs: z.number().min(1000).optional().describe("Streaming command timeout in milliseconds"),
});

export const FileUploadSchema = z.object({
  sessionId: z.string().min(1),
  localPath: z.string().min(1),
  remotePath: z.string().min(1),
});

export const FileDownloadSchema = z.object({
  sessionId: z.string().min(1),
  remotePath: z.string().min(1),
  localPath: z.string().min(1),
});

export const TunnelLocalForwardSchema = z.object({
  sessionId: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remoteHost: z.string().min(1).default("localhost"),
  remotePort: z.number().int().min(1).max(65535),
});

export const TunnelRemoteForwardSchema = z.object({
  sessionId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535),
  localHost: z.string().min(1).default("localhost"),
  localPort: z.number().int().min(1).max(65535),
});

export const TunnelCloseSchema = z.object({
  tunnelId: z.string().min(1),
});

export const TunnelListSchema = z.object({
  sessionId: z.string().min(1).optional(),
});
