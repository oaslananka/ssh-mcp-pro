import type { MCPPromptDefinition } from "./prompts.js";
import type { MCPResource } from "./resources.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOL_PROFILES = [
  "full",
  "remote-safe",
  "chatgpt",
  "claude",
  "remote-readonly",
  "remote-broker",
] as const;

export type ToolProfile = (typeof TOOL_PROFILES)[number];

const REMOTE_CONNECTOR_BASELINE_TOOL_NAMES = [
  "connector_status",
  "ssh_hosts_list",
  "ssh_policy_explain",
  "ssh_host_inspect",
  "ssh_mutation_plan",
] as const;

export const REMOTE_SAFE_TOOL_NAMES = Object.freeze([
  ...REMOTE_CONNECTOR_BASELINE_TOOL_NAMES,
] as const);

const REMOTE_SAFE_TOOL_NAME_SET = new Set<string>(REMOTE_SAFE_TOOL_NAMES);

function createRemoteConnectorToolSet(): Set<string> {
  return new Set<string>(REMOTE_CONNECTOR_BASELINE_TOOL_NAMES);
}

function parseExtraToolNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((toolName) => toolName.trim())
    .filter(Boolean);
}

export const CHATGPT_EXTRA_TOOLS = new Set<string>(
  parseExtraToolNames(process.env.SSH_MCP_CHATGPT_EXTRA_TOOLS),
);
export const CLAUDE_EXTRA_TOOLS = new Set<string>(
  parseExtraToolNames(process.env.SSH_MCP_CLAUDE_EXTRA_TOOLS),
);

export const PROFILE_TOOL_SETS: Record<ToolProfile, Set<string>> = {
  full: new Set<string>(),
  "remote-safe": createRemoteConnectorToolSet(),
  chatgpt: createRemoteConnectorToolSet(),
  claude: createRemoteConnectorToolSet(),
  "remote-readonly": createRemoteConnectorToolSet(),
  "remote-broker": createRemoteConnectorToolSet(),
};

const REMOTE_CONNECTOR_RESOURCES = new Set(["ssh-mcp-pro://capabilities/support-matrix"]);

const REMOTE_CONNECTOR_PROMPTS = new Set(["inspect-host-capabilities", "plan-mutation"]);

export function getEffectiveProfileToolSet(profile: ToolProfile): ReadonlySet<string> {
  const effectiveTools = new Set<string>(PROFILE_TOOL_SETS[profile]);

  if (profile === "chatgpt") {
    for (const toolName of CHATGPT_EXTRA_TOOLS) {
      effectiveTools.add(toolName);
    }
  }

  if (profile === "claude") {
    for (const toolName of CLAUDE_EXTRA_TOOLS) {
      effectiveTools.add(toolName);
    }
  }

  return effectiveTools;
}

export function getUnsafeRemoteToolNames(profile: ToolProfile): string[] {
  if (profile === "full") {
    return [];
  }
  return [...getEffectiveProfileToolSet(profile)]
    .filter((toolName) => !REMOTE_SAFE_TOOL_NAME_SET.has(toolName))
    .sort();
}

export function parseToolProfile(value: string | undefined, fallback: ToolProfile): ToolProfile {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (TOOL_PROFILES.includes(value as ToolProfile)) {
    return value as ToolProfile;
  }
  return fallback;
}

export function isRemoteSafeToolProfile(profile: ToolProfile): boolean {
  return profile !== "full" && getUnsafeRemoteToolNames(profile).length === 0;
}

export function isToolAllowedForProfile(toolName: string, profile: ToolProfile): boolean {
  return profile === "full" || getEffectiveProfileToolSet(profile).has(toolName);
}

export function filterToolsForProfile(tools: Tool[], profile: ToolProfile): Tool[] {
  if (profile === "full") {
    return tools;
  }
  const profileTools = getEffectiveProfileToolSet(profile);
  return tools.filter((tool) => profileTools.has(tool.name));
}

export function filterResourcesForProfile(resources: MCPResource[], profile: ToolProfile) {
  if (profile === "full") {
    return resources;
  }
  return resources.filter((resource) => REMOTE_CONNECTOR_RESOURCES.has(resource.uri));
}

export function isResourceAllowedForProfile(uri: string, profile: ToolProfile): boolean {
  return profile === "full" || REMOTE_CONNECTOR_RESOURCES.has(uri);
}

export function filterPromptsForProfile(prompts: MCPPromptDefinition[], profile: ToolProfile) {
  if (profile === "full") {
    return prompts;
  }
  return prompts.filter((prompt) => REMOTE_CONNECTOR_PROMPTS.has(prompt.name));
}

export function isPromptAllowedForProfile(name: string, profile: ToolProfile): boolean {
  return profile === "full" || REMOTE_CONNECTOR_PROMPTS.has(name);
}
