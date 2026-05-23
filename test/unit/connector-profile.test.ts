import { describe, expect, test } from "@jest/globals";
import {
  filterPromptsForProfile,
  filterResourcesForProfile,
  filterToolsForProfile,
  isPromptAllowedForProfile,
  isRemoteSafeToolProfile,
  isResourceAllowedForProfile,
  isToolAllowedForProfile,
  parseToolProfile,
} from "../../src/connector-profile.js";
import type { MCPPromptDefinition } from "../../src/prompts.js";
import type { MCPResource } from "../../src/resources.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

describe("connector profile helpers", () => {
  test("parses configured profiles with safe fallback behavior", () => {
    expect(parseToolProfile(undefined, "chatgpt")).toBe("chatgpt");
    expect(parseToolProfile("", "remote-safe")).toBe("remote-safe");
    expect(parseToolProfile("full", "chatgpt")).toBe("full");
    expect(parseToolProfile("remote-broker", "chatgpt")).toBe("remote-broker");
    expect(parseToolProfile("unknown", "chatgpt")).toBe("chatgpt");
  });

  test("identifies remote-safe profiles", () => {
    expect(isRemoteSafeToolProfile("full")).toBe(false);
    expect(isRemoteSafeToolProfile("chatgpt")).toBe(true);
    expect(isRemoteSafeToolProfile("remote-readonly")).toBe(true);
  });

  test("filters tools for remote connector profiles", () => {
    const tools = [
      { name: "connector_status" },
      { name: "ssh_open_session" },
      { name: "ssh_mutation_plan" },
    ] as Tool[];

    expect(filterToolsForProfile(tools, "full")).toBe(tools);
    expect(filterToolsForProfile(tools, "chatgpt").map((tool) => tool.name)).toEqual([
      "connector_status",
      "ssh_mutation_plan",
    ]);
    expect(isToolAllowedForProfile("ssh_open_session", "full")).toBe(true);
    expect(isToolAllowedForProfile("ssh_open_session", "chatgpt")).toBe(false);
    expect(isToolAllowedForProfile("ssh_policy_explain", "chatgpt")).toBe(true);
  });

  test("filters resources for remote connector profiles", () => {
    const resources = [
      { uri: "ssh-mcp-pro://capabilities/support-matrix", name: "Support" },
      { uri: "ssh-mcp-pro://audit/recent", name: "Audit" },
    ] as MCPResource[];

    expect(filterResourcesForProfile(resources, "full")).toBe(resources);
    expect(
      filterResourcesForProfile(resources, "remote-safe").map((resource) => resource.uri),
    ).toEqual(["ssh-mcp-pro://capabilities/support-matrix"]);
    expect(
      isResourceAllowedForProfile("ssh-mcp-pro://capabilities/support-matrix", "chatgpt"),
    ).toBe(true);
    expect(isResourceAllowedForProfile("ssh-mcp-pro://audit/recent", "chatgpt")).toBe(false);
  });

  test("filters prompts for remote connector profiles", () => {
    const prompts = [
      {
        name: "inspect-host-capabilities",
        title: "Inspect Host Capabilities",
        description: "Inspect",
        arguments: [],
      },
      { name: "safe-connect", title: "Safe Connect", description: "Connect", arguments: [] },
      { name: "plan-mutation", title: "Plan Mutation", description: "Plan", arguments: [] },
    ] as MCPPromptDefinition[];

    expect(filterPromptsForProfile(prompts, "full")).toBe(prompts);
    expect(filterPromptsForProfile(prompts, "claude").map((prompt) => prompt.name)).toEqual([
      "inspect-host-capabilities",
      "plan-mutation",
    ]);
    expect(isPromptAllowedForProfile("plan-mutation", "chatgpt")).toBe(true);
    expect(isPromptAllowedForProfile("safe-connect", "chatgpt")).toBe(false);
  });
});
