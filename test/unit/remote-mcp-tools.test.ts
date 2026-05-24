import { describe, expect, test } from "vitest";
import { listRemoteToolDescriptors } from "../../src/remote/mcp-tools.js";
import { REMOTE_CAPABILITIES, REMOTE_TOOLS, TOOL_CAPABILITY_MAP } from "../../src/remote/types.js";

describe("remote MCP tool descriptors", () => {
  test("returns only descriptors granted by caller capabilities", () => {
    const tools = listRemoteToolDescriptors(["hosts.read", "shell.exec"]);

    expect(tools.map((tool) => tool.name)).toEqual(["list_hosts", "run_shell"]);
    expect(tools).toEqual([
      expect.objectContaining({
        name: "list_hosts",
        capability: "hosts.read",
        inputSchema: expect.objectContaining({ additionalProperties: false }),
      }),
      expect.objectContaining({
        name: "run_shell",
        capability: "shell.exec",
        inputSchema: expect.objectContaining({
          required: ["agent_id_or_alias", "command"],
        }),
      }),
    ]);
  });

  test("maps every remote tool to the descriptor capability table", () => {
    const tools = listRemoteToolDescriptors(REMOTE_CAPABILITIES);

    expect(tools.map((tool) => tool.name)).toEqual(REMOTE_TOOLS);
    for (const tool of tools) {
      expect(tool.capability).toBe(TOOL_CAPABILITY_MAP[tool.name]);
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: "object" }));
    }
  });

  test("returns no descriptors when no capabilities are granted", () => {
    expect(listRemoteToolDescriptors([])).toEqual([]);
  });
});
