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

const REMOTE_CONNECTOR_TOOLS = new Set([
  "connector_status",
  "ssh_hosts_list",
  "ssh_policy_explain",
  "ssh_host_inspect",
  "ssh_mutation_plan",
]);

const REMOTE_CONNECTOR_RESOURCES = new Set(["ssh-mcp-pro://capabilities/support-matrix"]);

const REMOTE_CONNECTOR_PROMPTS = new Set(["inspect-host-capabilities", "plan-mutation"]);

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
  return profile !== "full";
}

export function isToolAllowedForProfile(toolName: string, profile: ToolProfile): boolean {
  return profile === "full" || REMOTE_CONNECTOR_TOOLS.has(toolName);
}

export function filterToolsForProfile(tools: Tool[], profile: ToolProfile): Tool[] {
  if (profile === "full") {
    return tools;
  }
  return tools.filter((tool) => REMOTE_CONNECTOR_TOOLS.has(tool.name));
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
