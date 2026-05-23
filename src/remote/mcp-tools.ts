import type { RemoteCapability, RemoteToolName } from "./types.js";
import { REMOTE_TOOLS, TOOL_CAPABILITY_MAP } from "./types.js";

interface RemoteToolDescriptor {
  name: RemoteToolName;
  description: string;
  capability: RemoteCapability;
  inputSchema: Record<string, unknown>;
}

const agentSelector = {
  type: "string",
  description: "Agent ID or alias owned by the authenticated user.",
};

const limitSchema = {
  type: "integer",
  minimum: 1,
  maximum: 200,
  default: 50,
};

const descriptors: Record<RemoteToolName, Omit<RemoteToolDescriptor, "name" | "capability">> = {
  list_hosts: {
    description: "List enrolled host aliases available through outbound agents.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  list_agents: {
    description: "List enrolled agents and their connection state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  create_enrollment_token: {
    description: "Create a one-time token and install command for enrolling a new outbound agent.",
    inputSchema: {
      type: "object",
      required: ["alias"],
      properties: {
        alias: { type: "string", minLength: 1, maxLength: 80 },
        labels: { type: "array", items: { type: "string" }, default: [] },
        requested_profile: {
          type: "string",
          enum: ["read-only", "operations", "full-admin"],
          default: "read-only",
        },
      },
      additionalProperties: false,
    },
  },
  get_agent_install_command: {
    description: "Return npm-based install/run commands for a pending or enrolled agent.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias"],
      properties: { agent_id_or_alias: agentSelector },
      additionalProperties: false,
    },
  },
  get_system_status: {
    description: "Collect basic OS, uptime, load, and disk status from an online agent.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias"],
      properties: { agent_id_or_alias: agentSelector, timeout_seconds: limitSchema },
      additionalProperties: false,
    },
  },
  tail_logs: {
    description: "Tail a configured system service unit or allowed log file through the agent.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "unit_or_file"],
      properties: {
        agent_id_or_alias: agentSelector,
        unit_or_file: { type: "string", minLength: 1 },
        lines: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      additionalProperties: false,
    },
  },
  restart_service: {
    description: "Restart an allowlisted service through the agent local policy.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "service"],
      properties: { agent_id_or_alias: agentSelector, service: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  docker_ps: {
    description: "List Docker containers on an agent host when Docker is available.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias"],
      properties: { agent_id_or_alias: agentSelector },
      additionalProperties: false,
    },
  },
  docker_logs: {
    description: "Read bounded Docker logs for an allowlisted container.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "container"],
      properties: {
        agent_id_or_alias: agentSelector,
        container: { type: "string", minLength: 1 },
        lines: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      additionalProperties: false,
    },
  },
  docker_restart: {
    description: "Restart an allowlisted Docker container through the agent local policy.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "container"],
      properties: { agent_id_or_alias: agentSelector, container: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  file_read: {
    description: "Read a bounded text file from an allowed path.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "path"],
      properties: { agent_id_or_alias: agentSelector, path: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  file_write: {
    description: "Write text content to an allowed path when files.write is enabled.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "path", "content"],
      properties: {
        agent_id_or_alias: agentSelector,
        path: { type: "string", minLength: 1 },
        content: { type: "string" },
        mode: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  run_shell: {
    description: "Run a bounded shell command. Disabled unless shell.exec is explicitly granted.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "command"],
      properties: {
        agent_id_or_alias: agentSelector,
        command: { type: "string", minLength: 1 },
        cwd: { type: "string" },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
      },
      additionalProperties: false,
    },
  },
  run_shell_as_root: {
    description:
      "Run a bounded privileged command. Disabled unless sudo.exec is explicitly granted.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "command"],
      properties: {
        agent_id_or_alias: agentSelector,
        command: { type: "string", minLength: 1 },
        cwd: { type: "string" },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
      },
      additionalProperties: false,
    },
  },
  update_agent_policy: {
    description: "Update an agent capability profile and local policy.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "policy"],
      properties: {
        agent_id_or_alias: agentSelector,
        policy: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  revoke_agent: {
    description: "Revoke an agent so no new actions can be dispatched.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias"],
      properties: { agent_id_or_alias: agentSelector },
      additionalProperties: false,
    },
  },
  get_audit_events: {
    description: "Read recent control-plane audit events for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id_or_alias: agentSelector,
        limit: limitSchema,
      },
      additionalProperties: false,
    },
  },
};

export function listRemoteToolDescriptors(
  capabilities: readonly RemoteCapability[],
): RemoteToolDescriptor[] {
  const allowed = new Set(capabilities);
  return REMOTE_TOOLS.filter((name) => allowed.has(TOOL_CAPABILITY_MAP[name])).map((name) => ({
    name,
    capability: TOOL_CAPABILITY_MAP[name],
    ...descriptors[name],
  }));
}
