import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  resolveConnectorCredentials,
  type ConnectorCredentialRequest,
} from "../connector-credentials.js";
import type { ServerConfig } from "../config.js";
import type { MetricsCollector } from "../metrics.js";
import type { PolicyAction, PolicyContext, PolicyEngine } from "../policy.js";
import type { SessionManager } from "../session.js";
import { getConfiguredHosts } from "../ssh-config.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

const PolicyExplainSchema = z.object({
  hostAlias: z.string().min(1).optional(),
  action: z
    .enum(["inspect", "mutation", "destructive-mutation"])
    .default("inspect")
    .describe("Requested action class to evaluate without executing it"),
  command: z.string().optional(),
  path: z.string().optional(),
});

const MutationPlanSchema = z.object({
  hostAlias: z.string().min(1),
  goal: z.string().min(1).max(1000),
  category: z.enum(["package", "service", "file", "command", "tunnel", "other"]).default("other"),
});

const HostInspectSchema = z.object({
  hostAlias: z.string().min(1),
  checks: z
    .array(z.enum(["os", "uptime", "disk", "memory"]))
    .min(1)
    .max(4)
    .optional()
    .default(["os"]),
});

export interface ConnectorToolProviderDeps {
  sessionManager: SessionManager;
  metrics: MetricsCollector;
  config: ServerConfig;
  policy: PolicyEngine;
  getConfiguredHosts?: () => Promise<string[]>;
  resolveConnectorCredentials?: (
    request: ConnectorCredentialRequest,
    config: ServerConfig,
  ) => Promise<Parameters<SessionManager["openSession"]>[0]>;
}

export class ConnectorToolProvider implements ToolProvider {
  readonly namespace = "connector";

  constructor(private readonly deps: ConnectorToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "connector_status",
        description:
          "Use this when ChatGPT or Claude needs to understand the remote connector profile, authentication mode, and credential broker readiness without exposing secrets.",
        annotations: annotate({
          title: "Connector Status",
          readOnly: true,
          idempotent: true,
          openWorld: false,
        }),
        outputSchema: objectOutputSchema("Remote connector readiness without secrets"),
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "ssh_hosts_list",
        description:
          "Use this when ChatGPT or Claude needs a safe list of SSH host aliases that may be inspected through the remote connector. Sensitive login material is omitted.",
        annotations: annotate({
          title: "List Safe SSH Host Aliases",
          readOnly: true,
          idempotent: true,
          openWorld: false,
        }),
        outputSchema: objectOutputSchema("Redacted SSH host aliases allowed by policy"),
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "ssh_policy_explain",
        description:
          "Use this when ChatGPT or Claude needs to explain whether a requested SSH inspection or mutation would be allowed. This is explain-only and does not execute commands or open tunnels.",
        annotations: annotate({
          title: "Explain SSH Policy",
          readOnly: true,
          idempotent: true,
          openWorld: false,
        }),
        outputSchema: objectOutputSchema("Explain-only policy decision"),
        inputSchema: {
          type: "object" as const,
          properties: {
            hostAlias: { type: "string", description: "Configured SSH host alias" },
            action: {
              type: "string",
              enum: ["inspect", "mutation", "destructive-mutation"],
              description: "Requested action class to evaluate without executing it",
            },
            command: {
              type: "string",
              description: "Optional command to evaluate in explain mode",
            },
            path: {
              type: "string",
              description: "Optional remote path to evaluate in explain mode",
            },
          },
          required: [],
        },
      },
      {
        name: "ssh_host_inspect",
        description:
          "Use this when ChatGPT or Claude needs read-only host inspection through the server-side credential broker. The user supplies only a configured host alias and selected checks; no secret material or login details are accepted.",
        annotations: annotate({
          title: "Inspect SSH Host",
          readOnly: true,
          idempotent: false,
          openWorld: false,
        }),
        outputSchema: objectOutputSchema("Read-only host inspection result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            hostAlias: { type: "string", description: "Configured SSH host alias" },
            checks: {
              type: "array",
              description: "Read-only checks to run",
              items: { type: "string", enum: ["os", "uptime", "disk", "memory"] },
              minItems: 1,
              maxItems: 4,
            },
          },
          required: ["hostAlias"],
        },
      },
      {
        name: "ssh_mutation_plan",
        description:
          "Use this when ChatGPT or Claude needs a non-executing plan for a remote SSH change. It never runs commands, writes files, uploads data, starts tunnels, or escalates privileges.",
        annotations: annotate({
          title: "Plan SSH Mutation",
          readOnly: true,
          destructive: false,
          idempotent: true,
          openWorld: false,
        }),
        outputSchema: objectOutputSchema("Non-executing remote mutation plan"),
        inputSchema: {
          type: "object" as const,
          properties: {
            hostAlias: { type: "string", description: "Configured SSH host alias" },
            goal: {
              type: "string",
              description: "Desired change to plan without executing",
              maxLength: 1000,
            },
            category: {
              type: "string",
              enum: ["package", "service", "file", "command", "tunnel", "other"],
              description: "Change category used for policy explanation",
            },
          },
          required: ["hostAlias", "goal"],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "connector_status":
        return this.status();
      case "ssh_hosts_list":
        return this.listHosts();
      case "ssh_policy_explain":
        return this.explainPolicy(args);
      case "ssh_host_inspect":
        return this.inspectHost(args);
      case "ssh_mutation_plan":
        return this.planMutation(args);
      default:
        return undefined;
    }
  }

  private async status(): Promise<unknown> {
    const { connector, auth, http, policy } = this.deps.config;
    return {
      toolProfile: connector.toolProfile,
      credentialProvider: connector.credentialProvider,
      credentialBrokerConfigured:
        connector.credentialProvider === "agent" ||
        (connector.credentialProvider === "command" && Boolean(connector.credentialCommand)),
      authMode: auth.mode,
      oauthConfigured: auth.mode === "oauth" && Boolean(auth.oauthIssuer && auth.oauthJwksUrl),
      nonLoopbackHttpRequiresAuthAndOrigins: true,
      allowedOriginsConfigured: http.allowedOrigins.length > 0,
      publicUrlConfigured: Boolean(http.publicUrl),
      maxHttpSessions: http.maxSessions,
      httpSessionIdleTtlMs: http.sessionIdleTtlMs,
      hostAllowlistConfigured: policy.allowedHosts.length > 0,
      safeRemoteToolsOnly: connector.toolProfile !== "full",
      credentialEntryInChat: false,
      privateKeysInChat: false,
      rawCommandExecutionDefault: false,
      destructiveExecutionDefault: false,
    };
  }

  private async listHosts(): Promise<unknown> {
    const configuredHosts = await (this.deps.getConfiguredHosts ?? getConfiguredHosts)();
    const allowedHosts = this.deps.config.policy.allowedHosts;
    const hosts = configuredHosts
      .filter((hostAlias) => isHostAllowed(hostAlias, allowedHosts))
      .map((hostAlias) => ({
        hostAlias,
        allowedByPolicy: true,
      }));

    return {
      count: hosts.length,
      hosts,
      redactedFields: ["username", "identityFile", "privateKeyPath", "password", "passphrase"],
      hostAllowlistRequired: true,
      hostAllowlistConfigured: allowedHosts.length > 0,
    };
  }

  private async explainPolicy(args: unknown): Promise<unknown> {
    const input = PolicyExplainSchema.parse(args ?? {});
    const action = mapPolicyAction(input.action, input.path);
    const context: PolicyContext = {
      action,
      destructive: input.action === "destructive-mutation",
      rawSudo: input.command?.trimStart().startsWith("sudo ") ?? false,
    };
    if (input.hostAlias) {
      context.host = input.hostAlias;
    }
    if (input.command) {
      context.command = input.command;
    }
    if (input.path) {
      context.path = input.path;
    }
    const decision = this.deps.policy.explain(context);

    return {
      executed: false,
      toolProfile: this.deps.config.connector.toolProfile,
      decision,
      requiresExplicitUserConfirmation: input.action !== "inspect",
    };
  }

  private async planMutation(args: unknown): Promise<unknown> {
    const input = MutationPlanSchema.parse(args ?? {});
    const decision = this.deps.policy.explain({
      action: mapMutationCategory(input.category),
      host: input.hostAlias,
      destructive: input.category === "file" || input.category === "command",
    });

    return {
      executed: false,
      hostAlias: input.hostAlias,
      goal: input.goal,
      category: input.category,
      policyDecision: decision,
      requiredBeforeExecution: [
        "server-side credential broker configured",
        "host allowlist permits the target alias",
        "strict host-key verification remains active",
        "policy explicitly allows the concrete operation",
        "user reviews and confirms the concrete tool payload",
      ],
      disallowedInRemoteConnectorProfile: [
        "chat-entered SSH passwords",
        "chat-entered private keys",
        "raw command execution",
        "sudo execution",
        "file writes or deletes",
        "file transfers",
        "tunnels",
      ],
    };
  }

  private async inspectHost(args: unknown): Promise<unknown> {
    const input = HostInspectSchema.parse(args ?? {});
    const credentialResolver = this.deps.resolveConnectorCredentials ?? resolveConnectorCredentials;
    const credentials = await credentialResolver(
      { hostAlias: input.hostAlias, purpose: "inspect" },
      this.deps.config,
    );
    const session = await this.deps.sessionManager.openSession(credentials);
    this.deps.metrics.recordSessionCreated();

    try {
      const inspection: Record<string, unknown> = {};
      for (const check of input.checks) {
        if (check === "os") {
          inspection.os = await this.deps.sessionManager.getOSInfo(session.sessionId);
          continue;
        }

        const active = this.deps.sessionManager.getSession(session.sessionId);
        if (!active) {
          throw new Error("Inspection session expired unexpectedly.");
        }
        const result = await active.ssh.execCommand(commandForCheck(check));
        inspection[check] = {
          code: result.code ?? 0,
          stdout: truncate(result.stdout),
          stderr: truncate(result.stderr),
        };
      }

      return {
        hostAlias: input.hostAlias,
        host: credentials.host,
        checks: input.checks,
        inspection,
        credentialsFromChat: false,
        strictHostKeyVerification: credentials.hostKeyPolicy === "strict",
      };
    } finally {
      await this.deps.sessionManager.closeSession(session.sessionId);
      this.deps.metrics.recordSessionClosed();
    }
  }
}

function isHostAllowed(hostAlias: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) {
    return false;
  }
  return allowedHosts.some((allowed) => {
    if (allowed === hostAlias) {
      return true;
    }
    try {
      return new RegExp(allowed).test(hostAlias);
    } catch {
      return false;
    }
  });
}

function mapPolicyAction(
  action: z.infer<typeof PolicyExplainSchema>["action"],
  path?: string,
): PolicyAction {
  if (action === "inspect") {
    return path ? "fs.read" : "ssh.open";
  }
  return path ? "fs.write" : "proc.exec";
}

function mapMutationCategory(
  category: z.infer<typeof MutationPlanSchema>["category"],
): PolicyAction {
  switch (category) {
    case "package":
      return "ensure.package";
    case "service":
      return "ensure.service";
    case "file":
      return "fs.write";
    case "tunnel":
      return "tunnel.local";
    case "command":
    case "other":
    default:
      return "proc.exec";
  }
}

function commandForCheck(check: "uptime" | "disk" | "memory"): string {
  switch (check) {
    case "uptime":
      return "uptime";
    case "disk":
      return "df -h /";
    case "memory":
      return "free -m || vm_stat || wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value";
  }
}

function truncate(value: string, limit = 4000): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n[truncated]`;
}
