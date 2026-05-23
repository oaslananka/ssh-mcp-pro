export const REMOTE_CAPABILITIES = [
  "hosts.read",
  "agents.read",
  "agents.admin",
  "system.read",
  "logs.read",
  "service.manage",
  "docker.manage",
  "files.read",
  "files.write",
  "shell.exec",
  "sudo.exec",
  "agent.admin",
  "audit.read",
] as const;

export type RemoteCapability = (typeof REMOTE_CAPABILITIES)[number];

export const REMOTE_SCOPES = [
  "hosts:read",
  "agents:read",
  "agents:admin",
  "status:read",
  "logs:read",
  "service:manage",
  "docker:manage",
  "files:read",
  "files:write",
  "shell:exec",
  "sudo:exec",
] as const;

export type RemoteScope = (typeof REMOTE_SCOPES)[number];

export const SCOPE_CAPABILITY_MAP: Record<RemoteScope, RemoteCapability[]> = {
  "hosts:read": ["hosts.read"],
  "agents:read": ["agents.read"],
  "agents:admin": ["agents.admin", "agent.admin", "audit.read"],
  "status:read": ["system.read"],
  "logs:read": ["logs.read"],
  "service:manage": ["service.manage"],
  "docker:manage": ["docker.manage"],
  "files:read": ["files.read"],
  "files:write": ["files.write"],
  "shell:exec": ["shell.exec"],
  "sudo:exec": ["sudo.exec"],
};

export type AgentProfileName = "read-only" | "operations" | "full-admin" | "custom";

export type CapabilityPolicy = Record<RemoteCapability, boolean>;

export interface AgentPolicy {
  profile: AgentProfileName;
  capabilities: CapabilityPolicy;
  allowPaths: string[];
  denyPaths: string[];
  allowServices: string[];
  allowContainers: string[];
  maxOutputBytes: number;
  maxActionTimeoutSeconds: number;
  version: number;
}

export interface GitHubUser {
  id: string;
  login: string;
}

export interface OAuthClient {
  id: string;
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: "none";
  createdAt: string;
}

export interface OAuthAuthorizationCode {
  id: string;
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scope: string;
  expiresAt: string;
  usedAt?: string | undefined;
  createdAt: string;
}

export interface RemoteAgentRecord {
  id: string;
  userId: string;
  alias: string;
  status: "pending" | "online" | "offline" | "revoked";
  publicKey?: string | undefined;
  profile: AgentProfileName;
  policy: AgentPolicy;
  policyVersion: number;
  hostMetadata?: AgentHostMetadata | undefined;
  lastSeenAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEnrollmentTokenRecord {
  id: string;
  agentId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string | undefined;
  createdAt: string;
}

export interface AgentHostMetadata {
  hostname: string;
  os: string;
  arch: string;
  platform: string;
}

export interface ActionRecord {
  id: string;
  userId: string;
  agentId: string;
  tool: RemoteToolName;
  capability: RemoteCapability;
  args: Record<string, unknown>;
  status: "pending" | "sent" | "completed" | "denied" | "timeout" | "error";
  issuedAt: string;
  deadline: string;
  completedAt?: string | undefined;
  result?: ActionResultEnvelope | undefined;
  errorCode?: RemoteErrorCode | undefined;
}

export interface AuditEvent {
  id: string;
  userId?: string | undefined;
  agentId?: string | undefined;
  actionId?: string | undefined;
  eventType: string;
  severity: "info" | "warn" | "error";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const REMOTE_TOOLS = [
  "list_hosts",
  "list_agents",
  "create_enrollment_token",
  "get_agent_install_command",
  "get_system_status",
  "tail_logs",
  "restart_service",
  "docker_ps",
  "docker_logs",
  "docker_restart",
  "file_read",
  "file_write",
  "run_shell",
  "run_shell_as_root",
  "update_agent_policy",
  "revoke_agent",
  "get_audit_events",
] as const;

export type RemoteToolName = (typeof REMOTE_TOOLS)[number];

export const TOOL_CAPABILITY_MAP: Record<RemoteToolName, RemoteCapability> = {
  list_hosts: "hosts.read",
  list_agents: "agents.read",
  create_enrollment_token: "agents.admin",
  get_agent_install_command: "agents.admin",
  get_system_status: "system.read",
  tail_logs: "logs.read",
  restart_service: "service.manage",
  docker_ps: "docker.manage",
  docker_logs: "docker.manage",
  docker_restart: "docker.manage",
  file_read: "files.read",
  file_write: "files.write",
  run_shell: "shell.exec",
  run_shell_as_root: "sudo.exec",
  update_agent_policy: "agents.admin",
  revoke_agent: "agents.admin",
  get_audit_events: "audit.read",
};

export const REMOTE_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_TOKEN",
  "INVALID_SCOPE",
  "INVALID_CLIENT",
  "INVALID_REDIRECT_URI",
  "PKCE_VALIDATION_FAILED",
  "AGENT_NOT_FOUND",
  "AGENT_OFFLINE",
  "AGENT_REVOKED",
  "AGENT_TIMEOUT",
  "POLICY_DENIED",
  "CAPABILITY_DENIED",
  "ACTION_EXPIRED",
  "ACTION_REPLAY_DETECTED",
  "SIGNATURE_INVALID",
  "COMMAND_TIMEOUT",
  "OUTPUT_TRUNCATED",
  "UNSUPPORTED_PLATFORM",
  "UNSUPPORTED_PLATFORM_OR_PRIVILEGE",
  "INTERNAL_ERROR",
] as const;

export type RemoteErrorCode = (typeof REMOTE_ERROR_CODES)[number];

export interface AgentHelloEnvelope {
  type: "agent.hello";
  agent_id: string;
  timestamp: string;
  nonce: string;
  capabilities: RemoteCapability[];
  agent_version: string;
  host: AgentHostMetadata;
  signature: string;
}

export interface ActionRequestEnvelope {
  type: "action.request";
  action_id: string;
  agent_id: string;
  user_id: string;
  tool: RemoteToolName;
  capability: RemoteCapability;
  args: Record<string, unknown>;
  policy_version: number;
  issued_at: string;
  deadline: string;
  nonce: string;
  signature: string;
}

export interface ActionResultEnvelope {
  type: "action.result";
  action_id: string;
  agent_id: string;
  nonce: string;
  status: "ok" | "error";
  exit_code?: number | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  started_at: string;
  finished_at: string;
  truncated: boolean;
  error_code?: RemoteErrorCode | undefined;
  message?: string | undefined;
  signature: string;
}

export interface PolicyUpdateEnvelope {
  type: "policy.update";
  agent_id: string;
  policy: AgentPolicy;
  policy_version: number;
  issued_at: string;
  nonce: string;
  signature: string;
}

export interface RemotePrincipal {
  userId: string;
  githubId: string;
  githubLogin: string;
  scopes: RemoteScope[];
  capabilities: RemoteCapability[];
  tokenId: string;
}

export interface RemoteConfig {
  enabled: boolean;
  publicBaseUrl: string;
  mcpResourceUrl: string;
  databaseUrl: string;
  githubClientId?: string | undefined;
  githubClientSecret?: string | undefined;
  githubCallbackUrl: string;
  allowAllUsers: boolean;
  allowedGitHubLogins: string[];
  allowedGitHubIds: string[];
  accessTokenTtlSeconds: number;
  authCodeTtlSeconds: number;
  enrollmentTokenTtlSeconds: number;
  controlPlaneSigningKeyPath: string;
  jwtSigningKeyPath: string;
  agentWsPath: string;
  maxActionTimeoutSeconds: number;
  maxOutputBytes: number;
  maxOAuthClients: number;
}
