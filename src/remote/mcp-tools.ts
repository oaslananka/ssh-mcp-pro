import type { RemoteCapability, RemoteToolName } from "./types.js";
import { REMOTE_TOOLS, TOOL_CAPABILITY_MAP } from "./types.js";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

interface RemoteToolDescriptor {
  name: RemoteToolName;
  description: string;
  capability: RemoteCapability;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
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

// Every hosted MCP tool returns structuredContent. Exposing the actual
// top-level result shape helps clients validate responses and plan follow-up
// calls without assuming an arbitrary JSON blob.
const ACTION_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { action: { type: "object" } },
  required: ["action"],
};

const REMOTE_OUTPUT_SCHEMAS: Partial<Record<RemoteToolName, Record<string, unknown>>> = {
  list_hosts: {
    type: "object",
    properties: { hosts: { type: "array", items: { type: "object" } } },
    required: ["hosts"],
  },
  list_agents: {
    type: "object",
    properties: { agents: { type: "array", items: { type: "object" } } },
    required: ["agents"],
  },
  create_enrollment_token: {
    type: "object",
    properties: {
      agent_id: { type: "string" },
      alias: { type: "string" },
      commands: { type: "object" },
      enrollment_token: { type: "string" },
    },
    required: ["agent_id", "alias", "commands", "enrollment_token"],
  },
  get_agent_install_command: {
    type: "object",
    properties: {
      agent_id: { type: "string" },
      alias: { type: "string" },
      commands: { type: "object" },
      token_recoverable: { type: "boolean" },
    },
    required: ["agent_id", "alias", "commands", "token_recoverable"],
  },
  update_agent_policy: {
    type: "object",
    properties: { agent: { type: "object" } },
    required: ["agent"],
  },
  revoke_agent: {
    type: "object",
    properties: { agent: { type: "object" } },
    required: ["agent"],
  },
  get_audit_events: {
    type: "object",
    properties: { events: { type: "array", items: { type: "object" } } },
    required: ["events"],
  },
};

const descriptors: Record<
  RemoteToolName,
  Omit<RemoteToolDescriptor, "name" | "capability" | "outputSchema">
> = {
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
  file_search: {
    description:
      "Find file names in locally allowed folders without reading file contents. Optional root_path narrows the search; results and scan depth are bounded.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "name_pattern"],
      properties: {
        agent_id_or_alias: agentSelector,
        name_pattern: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description:
            "Case-insensitive name fragment or * / ? wildcard pattern; cannot contain directory separators.",
        },
        root_path: {
          type: "string",
          minLength: 1,
          description: "Optional allowed folder. Omit to search all policy-allowed roots.",
        },
        max_depth: { type: "integer", minimum: 0, maximum: 5, default: 3 },
        max_results: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        include_hidden: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  file_read: {
    description: "Read an allowed text file; optional byte offsets and limits page large files.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "path"],
      properties: {
        agent_id_or_alias: agentSelector,
        path: { type: "string", minLength: 1 },
        offset_bytes: { type: "integer", minimum: 0, maximum: 2147483647 },
        max_bytes: { type: "integer", minimum: 4, maximum: 1048576 },
      },
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
  file_replace: {
    description:
      "Preview or apply one exact text replacement in an allowed existing file. Preview first (default); apply requires expected_sha256 from preview. Both files.read and files.write must be granted.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "path", "old_text", "new_text"],
      properties: {
        agent_id_or_alias: agentSelector,
        path: { type: "string", minLength: 1 },
        old_text: { type: "string", minLength: 1, maxLength: 20000 },
        new_text: { type: "string", maxLength: 20000 },
        dry_run: { type: "boolean", default: true },
        expected_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
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
  process_start: {
    description:
      "Start a bounded interactive shell process on an enrolled agent. Use process_read to view output and process_stop to cancel. Requires shell.exec.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "command"],
      properties: {
        agent_id_or_alias: agentSelector,
        command: { type: "string", minLength: 1, maxLength: 4096 },
        cwd: { type: "string", minLength: 1 },
        max_runtime_seconds: { type: "integer", minimum: 1, maximum: 600, default: 300 },
      },
      additionalProperties: false,
    },
  },
  process_read: {
    description:
      "Read cursor-paged output and status for a managed shell process owned by the current user.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "process_id"],
      properties: {
        agent_id_or_alias: agentSelector,
        process_id: { type: "string", minLength: 1 },
        cursor: { type: "integer", minimum: 0, default: 0 },
        max_bytes: { type: "integer", minimum: 1024, maximum: 32768, default: 8192 },
      },
      additionalProperties: false,
    },
  },
  process_input: {
    description: "Send limited text to stdin of a running shell process owned by the current user.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "process_id", "input"],
      properties: {
        agent_id_or_alias: agentSelector,
        process_id: { type: "string", minLength: 1 },
        input: { type: "string", maxLength: 4096 },
        close_stdin: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  process_stop: {
    description: "Terminate a managed shell process owned by the current user.",
    inputSchema: {
      type: "object",
      required: ["agent_id_or_alias", "process_id"],
      properties: {
        agent_id_or_alias: agentSelector,
        process_id: { type: "string", minLength: 1 },
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

const READ_ONLY_REMOTE_TOOLS = new Set<RemoteToolName>([
  "list_hosts",
  "list_agents",
  "get_agent_install_command",
  "get_system_status",
  "tail_logs",
  "docker_ps",
  "docker_logs",
  "file_search",
  "file_read",
  "process_read",
  "get_audit_events",
]);

// These hints communicate potential impact to AI clients, not the permission
// decision. Arbitrary shell commands and administrative enrollment/policy
// changes can mutate state even when an individual invocation does not.
const DESTRUCTIVE_REMOTE_TOOLS = new Set<RemoteToolName>([
  "create_enrollment_token",
  "run_shell",
  "process_start",
  "process_input",
  "process_stop",
  "run_shell_as_root",
  "update_agent_policy",
  "revoke_agent",
  "file_write",
  "file_replace",
  "restart_service",
  "docker_restart",
]);

export function remoteToolAnnotations(name: RemoteToolName): ToolAnnotations {
  const isReadOnly = READ_ONLY_REMOTE_TOOLS.has(name);
  const isDestructive = DESTRUCTIVE_REMOTE_TOOLS.has(name);
  return {
    readOnlyHint: isReadOnly,
    destructiveHint: isDestructive,
    openWorldHint: !isReadOnly,
  };
}

export function listRemoteToolDescriptors(
  capabilities: readonly RemoteCapability[],
): RemoteToolDescriptor[] {
  const allowed = new Set(capabilities);
  return REMOTE_TOOLS.filter(
    (name) =>
      allowed.has(TOOL_CAPABILITY_MAP[name]) &&
      (name !== "file_replace" || allowed.has("files.read")),
  ).map((name) => ({
    name,
    capability: TOOL_CAPABILITY_MAP[name],
    outputSchema: REMOTE_OUTPUT_SCHEMAS[name] ?? ACTION_OUTPUT_SCHEMA,
    annotations: remoteToolAnnotations(name),
    ...descriptors[name],
  }));
}
