import {
  filterPromptsForProfile,
  isPromptAllowedForProfile,
  type ToolProfile,
} from "./connector-profile.js";

/**
 * Prompt suggestions for AI assistants (ChatGPT, Claude, etc.)
 * These help users understand what they can do with the SSH MCP tool
 */

export interface PromptSuggestion {
  name: string;
  description: string;
  prompt: string;
  category: "session" | "command" | "file" | "system" | "package";
}

export interface MCPPromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  // Session management
  {
    name: "Connect to Server",
    description: "Open an SSH connection to a remote server",
    prompt: "Connect to my server at hostname with username user1",
    category: "session",
  },
  {
    name: "List Active Sessions",
    description: "Show all currently active SSH sessions",
    prompt: "Show me all my active SSH sessions",
    category: "session",
  },
  {
    name: "Check Server Health",
    description: "Ping a session to verify the connection is alive",
    prompt: "Check if my SSH session is still connected",
    category: "session",
  },

  // Command execution
  {
    name: "Run Command",
    description: "Execute a command on the remote server",
    prompt: 'Run "ls -la /var/log" on my server',
    category: "command",
  },
  {
    name: "Check Disk Space",
    description: "Check available disk space on the server",
    prompt: "How much disk space is left on my server?",
    category: "command",
  },
  {
    name: "Get System Info",
    description: "Detect OS, architecture, and system details",
    prompt: "What operating system is running on my server?",
    category: "system",
  },

  // File operations
  {
    name: "Read Configuration",
    description: "Read contents of a configuration file",
    prompt: "Show me the contents of /etc/nginx/nginx.conf",
    category: "file",
  },
  {
    name: "Edit File",
    description: "Modify a configuration file on the server",
    prompt: "Add a new server block to my nginx config",
    category: "file",
  },
  {
    name: "List Directory",
    description: "List files and directories in a path",
    prompt: "List all files in /var/www",
    category: "file",
  },

  // Package management
  {
    name: "Install Package",
    description: "Install a software package on the server",
    prompt: "Install nginx on my server",
    category: "package",
  },
  {
    name: "Manage Service",
    description: "Start, stop, or restart a service",
    prompt: "Restart the nginx service",
    category: "package",
  },
];

export const MCP_PROMPTS: MCPPromptDefinition[] = [
  {
    name: "safe-connect",
    title: "Safely connect to an SSH host",
    description:
      "Open an SSH session using strict host-key verification and explain the safety posture.",
    arguments: [
      { name: "host", description: "SSH hostname, IP, or configured host alias", required: true },
      { name: "username", description: "SSH username", required: true },
    ],
  },
  {
    name: "inspect-host-capabilities",
    title: "Inspect remote host capabilities",
    description: "Detect OS, package manager, init system, SFTP availability, and active policy.",
  },
  {
    name: "plan-mutation",
    title: "Plan a remote change before executing",
    description: "Use explain mode and policy resources to summarize a risky remote change first.",
    arguments: [{ name: "goal", description: "Desired remote change", required: true }],
  },
  {
    name: "managed-config-change",
    title: "Apply a managed config change",
    description:
      "Read a config, produce a minimal patch, dry-run it, and apply only if policy allows it.",
    arguments: [{ name: "path", description: "Remote configuration file path", required: true }],
  },
];

export function listMCPPrompts(profile: ToolProfile = "full") {
  return {
    prompts: filterPromptsForProfile(
      MCP_PROMPTS.map((prompt) => ({ ...prompt })),
      profile,
    ),
  };
}

export function getMCPPrompt(
  name: string,
  args: Record<string, string> = {},
  profile: ToolProfile = "full",
) {
  if (!isPromptAllowedForProfile(name, profile)) {
    throw new Error(`Prompt ${name} is not exposed by the ${profile} connector profile`);
  }

  const prompt = MCP_PROMPTS.find((item) => item.name === name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const text = renderPrompt(name, args);
  return {
    description: prompt.description,
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text,
        },
      },
    ],
  };
}

function renderPrompt(name: string, args: Record<string, string>): string {
  switch (name) {
    case "safe-connect":
      return [
        "Open a safe SSH session using ssh-mcp-pro.",
        `Host: ${args.host ?? "<host>"}`,
        `Username: ${args.username ?? "<username>"}`,
        "Prefer hostKeyPolicy=strict, verify known_hosts, and do not request root login unless policy explicitly allows it.",
      ].join("\n");
    case "inspect-host-capabilities":
      return [
        "Inspect the current SSH MCP environment.",
        "List active sessions, read the effective policy resource, then run os_detect for the chosen session.",
        "Summarize supported tools, SFTP availability, package manager, init system, and any policy restrictions.",
      ].join("\n");
    case "plan-mutation":
      return [
        `Goal: ${args.goal ?? "<describe change>"}`,
        "Before executing, use explain mode or read policy resources to produce a concise action plan.",
        "Call out destructive operations, sudo needs, path policy, rollback, and commands/files that would change.",
      ].join("\n");
    case "managed-config-change":
      return [
        `Remote file: ${args.path ?? "<path>"}`,
        "Read the file, propose a minimal unified diff, dry-run the patch, then apply only if policy permits.",
        "If the path is denied or the file is too large, stop and explain the safer alternative.",
      ].join("\n");
    default:
      return "Use ssh-mcp-pro safely and prefer explain mode before mutations.";
  }
}

/**
 * Get prompts by category
 */
export function getPromptsByCategory(category: PromptSuggestion["category"]): PromptSuggestion[] {
  return PROMPT_SUGGESTIONS.filter((p) => p.category === category);
}

/**
 * Get a random subset of prompts for initial suggestions
 */
export function getRandomPrompts(count = 5): PromptSuggestion[] {
  const shuffled = [...PROMPT_SUGGESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Format prompts for display in AI assistant
 */
export function formatPromptsForDisplay(): string {
  const categories = ["session", "command", "file", "system", "package"] as const;
  const lines: string[] = ["## ssh-mcp-pro - What You Can Do\n"];

  for (const category of categories) {
    const prompts = getPromptsByCategory(category);
    if (prompts.length > 0) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)} Operations`);
      for (const p of prompts) {
        lines.push(`- **${p.name}**: "${p.prompt}"`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
