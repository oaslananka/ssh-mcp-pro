import { sanitizeAgent, safeError } from "./http-util.js";
import { createAgentPolicy } from "./policy.js";
import { REVIEWER_DEMO_USER_ID, type RemoteAgentRecord, type RemoteToolName } from "./types.js";

const SAMPLE_POLICY = createAgentPolicy("read-only");
const SAMPLE_CREATED_AT = "2026-11-01T09:00:00.000Z";
const SAMPLE_STATUS_AT = "2026-11-18T10:30:00.000Z";

const SAMPLE_AGENTS: readonly RemoteAgentRecord[] = [
  {
    id: "sample-agent-linux-online",
    userId: REVIEWER_DEMO_USER_ID,
    alias: "reviewer-linux-online",
    status: "online",
    profile: "read-only",
    policy: SAMPLE_POLICY,
    policyVersion: SAMPLE_POLICY.version,
    hostMetadata: {
      hostname: "reviewer-linux-online",
      os: "Ubuntu 24.04 LTS",
      arch: "x86_64",
      platform: "linux",
    },
    lastSeenAt: SAMPLE_STATUS_AT,
    createdAt: SAMPLE_CREATED_AT,
    updatedAt: SAMPLE_STATUS_AT,
  },
  {
    id: "sample-agent-linux-offline",
    userId: REVIEWER_DEMO_USER_ID,
    alias: "reviewer-linux-offline",
    status: "offline",
    profile: "read-only",
    policy: SAMPLE_POLICY,
    policyVersion: SAMPLE_POLICY.version,
    hostMetadata: {
      hostname: "reviewer-linux-offline",
      os: "Debian 12",
      arch: "x86_64",
      platform: "linux",
    },
    lastSeenAt: "2026-11-17T18:45:00.000Z",
    createdAt: "2026-11-01T09:10:00.000Z",
    updatedAt: "2026-11-17T18:45:00.000Z",
  },
];

export function reviewerDemoToolResult(
  tool: RemoteToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (tool === "list_hosts") {
    return {
      hosts: SAMPLE_AGENTS.map((agent) => ({
        id: agent.id,
        alias: agent.alias,
        status: agent.status,
        host: agent.hostMetadata,
      })),
      sample_data: true,
      source: "synthetic",
    };
  }
  if (tool === "list_agents") {
    return {
      agents: SAMPLE_AGENTS.map(sanitizeAgent),
      sample_data: true,
      source: "synthetic",
    };
  }
  if (tool === "get_system_status") {
    const selector =
      typeof args.agent_id_or_alias === "string" ? args.agent_id_or_alias.trim().toLowerCase() : "";
    const agent = SAMPLE_AGENTS.find(
      (candidate) =>
        candidate.id.toLowerCase() === selector || candidate.alias.toLowerCase() === selector,
    );
    if (!agent) throw safeError("AGENT_NOT_FOUND", "Sample device not found", 404);
    if (agent.status !== "online") {
      throw safeError("AGENT_OFFLINE", "Sample device is offline", 409);
    }
    return {
      sample_data: true,
      source: "synthetic",
      action: {
        status: "ok",
        exit_code: 0,
        stdout: [
          "SYNTHETIC SAMPLE DATA — no command was executed.",
          `Hostname: ${agent.hostMetadata?.hostname ?? agent.alias}`,
          `Operating system: ${agent.hostMetadata?.os ?? "Linux"}`,
          `Architecture: ${agent.hostMetadata?.arch ?? "x86_64"}`,
          "Uptime: 12 days, 4 hours",
          "Load average: 0.08, 0.05, 0.03",
          "Disk /: 34% used (68 GB of 200 GB)",
        ].join("\n"),
        stderr: "",
        started_at: SAMPLE_STATUS_AT,
        finished_at: SAMPLE_STATUS_AT,
        truncated: false,
        synthetic: true,
      },
    };
  }
  throw safeError("INVALID_SCOPE", "Reviewer sandbox only supports synthetic read-only tools", 403);
}
