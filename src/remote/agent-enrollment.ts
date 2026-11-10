import { hashSecret, id, nowIso, randomToken } from "./crypto.js";
import { asString, quotePosixArg, quotePowerShellArg, safeError } from "./http-util.js";
import { createAgentPolicy } from "./policy.js";
import { hasCapability } from "./scopes.js";
import type { RemoteStore } from "./store.js";
import type { AuditEvent, RemoteAgentRecord, RemoteConfig, RemotePrincipal } from "./types.js";

/** Owns agent enrollment and user-facing installation commands, not agent connections. */
export class AgentEnrollmentService {
  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {}

  createEnrollmentToken(
    principal: RemotePrincipal,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const alias = asString(args.alias)?.trim();
    if (!alias) {
      throw safeError("FORBIDDEN", "alias is required");
    }
    const profile = asString(args.requested_profile) ?? "read-only";
    const policy = createAgentPolicy(
      profile === "operations" || profile === "full-admin" ? profile : "read-only",
    );
    const now = nowIso();
    const existing = this.store.getAgentByAlias(principal.userId, alias);
    if (existing && existing.status !== "revoked") {
      throw safeError("FORBIDDEN", "Agent alias already exists");
    }
    const agent: RemoteAgentRecord = {
      id: id("agt"),
      userId: principal.userId,
      alias,
      status: "pending",
      profile: policy.profile,
      policy,
      policyVersion: policy.version,
      createdAt: now,
      updatedAt: now,
    };
    const token = randomToken(32);
    this.store.insertAgent(agent);
    this.store.insertEnrollmentToken({
      id: id("enr"),
      agentId: agent.id,
      userId: principal.userId,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + this.config.enrollmentTokenTtlSeconds * 1000).toISOString(),
      createdAt: now,
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "enrollment_token_created",
      severity: "info",
      metadata: { alias, profile: policy.profile },
    });
    return { ...this.installCommand(agent, token), enrollment_token: token };
  }

  installCommand(agent: RemoteAgentRecord, token: string | undefined): Record<string, unknown> {
    const tokenArgument = token ?? "<create-a-new-enrollment-token>";
    const posixBase = [
      "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll",
      `--server ${quotePosixArg(this.config.publicBaseUrl)}`,
      `--token ${quotePosixArg(tokenArgument)}`,
      `--alias ${quotePosixArg(agent.alias)}`,
    ].join(" ");
    const powershellBase = [
      "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll",
      `--server ${quotePowerShellArg(this.config.publicBaseUrl)}`,
      `--token ${quotePowerShellArg(tokenArgument)}`,
      `--alias ${quotePowerShellArg(agent.alias)}`,
    ].join(" ");
    return {
      agent_id: agent.id,
      alias: agent.alias,
      token_recoverable: Boolean(token),
      commands: {
        npm: posixBase,
        run: "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run",
        windows: powershellBase,
      },
      expires_in_seconds: token ? this.config.enrollmentTokenTtlSeconds : undefined,
    };
  }
}
