import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type OutputSchema = NonNullable<Tool["outputSchema"]> & {
  additionalProperties?: unknown;
  anyOf?: unknown[];
};

function zodOutputSchema(schema: z.ZodType, description: string): Tool["outputSchema"] {
  const jsonSchema = z.toJSONSchema(schema.describe(description)) as OutputSchema;
  delete jsonSchema.$schema;

  return {
    ...jsonSchema,
    type: "object",
    description,
  };
}

const ToolProfileSchema = z.enum([
  "full",
  "remote-safe",
  "chatgpt",
  "claude",
  "remote-readonly",
  "remote-broker",
]);
const HostKeyPolicySchema = z.enum(["strict", "accept-new", "insecure"]);
const PolicyModeSchema = z.enum(["enforce", "explain"]);
const PolicyActionSchema = z.enum([
  "ssh.open",
  "proc.exec",
  "proc.sudo",
  "fs.read",
  "fs.stat",
  "fs.list",
  "fs.write",
  "fs.remove",
  "fs.mkdir",
  "fs.rename",
  "ensure.package",
  "ensure.service",
  "ensure.lines",
  "patch.apply",
  "transfer.upload",
  "transfer.download",
  "transfer.local.read",
  "transfer.local.write",
  "transfer.local.create",
  "transfer.local.overwrite",
  "tunnel.local",
  "tunnel.remote",
]);

const PolicyDecisionOutputZodSchema = z.strictObject({
  allowed: z.boolean(),
  mode: PolicyModeSchema,
  action: PolicyActionSchema,
  reason: z.string().optional(),
  hint: z.string().optional(),
  riskLevel: z.string().optional(),
});

const FileTypeSchema = z.enum(["file", "directory", "symlink", "other"]);

const SessionRecordOutputZodSchema = z.strictObject({
  sessionId: z.string(),
  host: z.string(),
  username: z.string(),
  port: z.number(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsed: z.string(),
  remainingMs: z.number(),
});

const TunnelInfoOutputZodSchema = z.strictObject({
  id: z.string(),
  sessionId: z.string(),
  type: z.enum(["local", "remote", "dynamic"]),
  localHost: z.string(),
  localPort: z.number(),
  remoteHost: z.string(),
  remotePort: z.number(),
  createdAt: z.number(),
  active: z.boolean(),
});

const MetricsGroupOutputZodSchema = z.strictObject({
  sessions: z.strictObject({
    created: z.number(),
    closed: z.number(),
    active: z.number(),
    errors: z.number(),
  }),
  commands: z.strictObject({
    executed: z.number(),
    successful: z.number(),
    failed: z.number(),
    totalDurationMs: z.number(),
    avgDurationMs: z.number(),
  }),
  files: z.strictObject({
    reads: z.number(),
    writes: z.number(),
    deletes: z.number(),
    bytesRead: z.number(),
    bytesWritten: z.number(),
  }),
  transfers: z.strictObject({
    uploads: z.number(),
    downloads: z.number(),
    bytesUploaded: z.number(),
    bytesDownloaded: z.number(),
  }),
  tunnels: z.strictObject({
    opened: z.number(),
    closed: z.number(),
    active: z.number(),
    errors: z.number(),
  }),
  policy: z.strictObject({
    allowed: z.number(),
    denied: z.number(),
    explainOnly: z.number(),
  }),
  uptime: z.number(),
  startedAt: z.number(),
});

export const SESSION_OPEN_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    sessionId: z.string(),
    host: z.string(),
    username: z.string(),
    sftpAvailable: z.boolean(),
    expiresInMs: z.number(),
    policyMode: PolicyModeSchema,
    hostKeyPolicy: HostKeyPolicySchema,
    wouldConnect: z.boolean().optional(),
  }),
  "Session creation result or explain-mode connection plan",
);

export const SESSION_CLOSE_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({ closed: z.boolean() }),
  "Session close result",
);

export const SESSION_LIST_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    count: z.number(),
    sessions: z.array(SessionRecordOutputZodSchema),
  }),
  "Active SSH sessions",
);

export const SESSION_PING_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    alive: z.boolean(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
    sessionId: z.string().optional(),
    host: z.string().optional(),
    remainingMs: z.number().optional(),
  }),
  "Session health check result",
);

export const CONFIGURED_HOSTS_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    count: z.number(),
    hosts: z.array(z.string()),
  }),
  "Configured SSH host aliases",
);

export const RESOLVED_HOST_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    host: z.string(),
    username: z.string().optional(),
    port: z.number().optional(),
    privateKeyPath: z.string().optional(),
    proxyJump: z.string().optional(),
  }),
  "Resolved SSH connection parameters",
);

export const EXEC_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    code: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
    safetyWarning: z.string().optional(),
  }),
  "Remote command result",
);

export const STREAM_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    code: z.number(),
    chunks: z.array(
      z.strictObject({
        type: z.enum(["stdout", "stderr", "exit", "truncated"]),
        data: z.string().optional(),
        code: z.number().optional(),
        timestamp: z.number(),
      }),
    ),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
    truncated: z.boolean(),
    safetyWarning: z.string().optional(),
  }),
  "Streaming command result with output chunks",
);

export const FILE_READ_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({ content: z.string() }),
  "Remote file content",
);

export const FILE_OPERATION_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({ ok: z.boolean() }),
  "Remote file operation result",
);

export const FILE_STAT_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    size: z.number(),
    mtime: z.string(),
    mode: z.number(),
    type: FileTypeSchema,
  }),
  "Remote path stat result",
);

export const DIRECTORY_LIST_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    entries: z.array(
      z.strictObject({
        name: z.string(),
        type: FileTypeSchema,
        size: z.number().optional(),
        mtime: z.string().optional(),
        mode: z.number().optional(),
      }),
    ),
    nextToken: z.string().optional(),
  }),
  "Remote directory entries",
);

export const PACKAGE_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    ok: z.boolean(),
    pm: z.string(),
    code: z.number(),
    stdout: z.string(),
    stderr: z.string(),
  }),
  "Package state result",
);

export const SERVICE_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({ ok: z.boolean() }),
  "Service state result",
);

export const LINES_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    ok: z.boolean(),
    added: z.number(),
  }),
  "Line management result",
);

export const PATCH_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    ok: z.boolean(),
    changed: z.boolean(),
  }),
  "Patch application result",
);

export const TRANSFER_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    success: z.boolean(),
    filename: z.string(),
    size: z.number(),
    durationMs: z.number(),
    averageSpeed: z.number(),
    sha256: z.string(),
    verified: z.boolean(),
  }),
  "File transfer result with integrity details",
);

export const TUNNEL_OUTPUT_SCHEMA = zodOutputSchema(TunnelInfoOutputZodSchema, "SSH tunnel info");

export const TUNNEL_CLOSE_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({ closed: z.boolean() }),
  "Tunnel close result",
);

export const TUNNEL_LIST_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    count: z.number(),
    tunnels: z.array(TunnelInfoOutputZodSchema),
  }),
  "Active SSH tunnels",
);

export const OS_INFO_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    platform: z.enum(["linux", "darwin", "windows", "unknown"]),
    distro: z.string(),
    version: z.string(),
    arch: z.string(),
    shell: z.string(),
    packageManager: z.enum([
      "apt",
      "dnf",
      "yum",
      "pacman",
      "apk",
      "zypper",
      "brew",
      "choco",
      "winget",
      "unknown",
    ]),
    init: z.enum(["systemd", "service", "launchd", "windows-service", "unknown"]),
    defaultShell: z.enum(["bash", "sh", "powershell", "cmd", "unknown"]).optional(),
    tempDir: z.string().optional(),
  }),
  "Remote operating system information",
);

export const METRICS_OUTPUT_SCHEMA = zodOutputSchema(
  z.union([
    MetricsGroupOutputZodSchema,
    z.strictObject({
      format: z.literal("prometheus"),
      metrics: z.string(),
    }),
  ]),
  "Runtime metrics",
);

export const CONNECTOR_STATUS_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    toolProfile: ToolProfileSchema,
    credentialProvider: z.enum(["none", "agent", "command"]),
    credentialBrokerConfigured: z.boolean(),
    authMode: z.enum(["bearer", "oauth"]),
    oauthConfigured: z.boolean(),
    nonLoopbackHttpRequiresAuthAndOrigins: z.boolean(),
    allowedOriginsConfigured: z.boolean(),
    publicUrlConfigured: z.boolean(),
    maxHttpSessions: z.number(),
    httpSessionIdleTtlMs: z.number(),
    hostAllowlistConfigured: z.boolean(),
    safeRemoteToolsOnly: z.boolean(),
    credentialEntryInChat: z.boolean(),
    privateKeysInChat: z.boolean(),
    rawCommandExecutionDefault: z.boolean(),
    destructiveExecutionDefault: z.boolean(),
  }),
  "Remote connector readiness without secrets",
);

export const SSH_HOSTS_LIST_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    count: z.number(),
    hosts: z.array(
      z.strictObject({
        hostAlias: z.string(),
        allowedByPolicy: z.boolean(),
      }),
    ),
    redactedFields: z.array(z.string()),
    hostAllowlistRequired: z.boolean(),
    hostAllowlistConfigured: z.boolean(),
  }),
  "Redacted SSH host aliases allowed by policy",
);

export const POLICY_EXPLAIN_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    executed: z.literal(false),
    toolProfile: ToolProfileSchema,
    decision: PolicyDecisionOutputZodSchema,
    requiresExplicitUserConfirmation: z.boolean(),
  }),
  "Explain-only policy decision",
);

export const HOST_INSPECT_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    hostAlias: z.string(),
    host: z.string(),
    checks: z.array(z.enum(["os", "uptime", "disk", "memory"])),
    inspection: z.record(z.string(), z.unknown()),
    credentialsFromChat: z.boolean(),
    strictHostKeyVerification: z.boolean(),
  }),
  "Read-only host inspection result",
);

export const MUTATION_PLAN_OUTPUT_SCHEMA = zodOutputSchema(
  z.strictObject({
    executed: z.literal(false),
    hostAlias: z.string(),
    goal: z.string(),
    category: z.enum(["package", "service", "file", "command", "tunnel", "other"]),
    policyDecision: PolicyDecisionOutputZodSchema,
    requiredBeforeExecution: z.array(z.string()),
    disallowedInRemoteConnectorProfile: z.array(z.string()),
  }),
  "Non-executing remote mutation plan",
);
