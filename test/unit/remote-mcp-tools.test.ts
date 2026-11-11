import Ajv from "ajv";
import { describe, expect, test } from "vitest";
import { listRemoteToolDescriptors } from "../../src/remote/mcp-tools.js";
import { REMOTE_CAPABILITIES, REMOTE_TOOLS, TOOL_CAPABILITY_MAP } from "../../src/remote/types.js";

describe("remote MCP tool descriptors", () => {
  test("returns only descriptors granted by caller capabilities", () => {
    const tools = listRemoteToolDescriptors(["hosts.read", "shell.exec"]);

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_hosts",
      "run_shell",
      "process_start",
      "process_read",
      "process_input",
      "process_stop",
    ]);
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
      ...(["process_start", "process_read", "process_input", "process_stop"] as const).map((name) =>
        expect.objectContaining({ name, capability: "shell.exec" }),
      ),
    ]);
  });

  test("describes the structured outputs of every hosted MCP tool", () => {
    const ajv = new Ajv();
    const tools = listRemoteToolDescriptors(REMOTE_CAPABILITIES);
    for (const tool of tools) {
      expect(ajv.validateSchema(tool.outputSchema), tool.name).toBe(true);
      expect(tool.outputSchema.type, tool.name).toBe("object");
      expect(tool.outputSchema.properties, tool.name).toEqual(expect.any(Object));
    }

    for (const [name, sample] of [
      ["list_hosts", { hosts: [] }],
      ["list_agents", { agents: [] }],
      [
        "create_enrollment_token",
        { agent_id: "id", alias: "dev", commands: {}, enrollment_token: "one-time" },
      ],
      [
        "get_agent_install_command",
        { agent_id: "id", alias: "dev", commands: {}, token_recoverable: false },
      ],
      ["get_audit_events", { events: [] }],
      ["update_agent_policy", { agent: {} }],
      ["revoke_agent", { agent: {} }],
      ["run_shell", { action: {} }],
    ] as const) {
      const schema = tools.find((tool) => tool.name === name)?.outputSchema;
      expect(ajv.validate(schema, sample), name).toBe(true);
    }
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

  test("marks potentially destructive remote actions for MCP clients", () => {
    const tools = listRemoteToolDescriptors(REMOTE_CAPABILITIES);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "create_enrollment_token",
      "run_shell",
      "run_shell_as_root",
      "update_agent_policy",
      "revoke_agent",
      "file_write",
      "restart_service",
      "docker_restart",
    ] as const) {
      expect(byName.get(name)?.annotations, name).toEqual(
        expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        }),
      );
    }
  });

  test("exposes a bounded read-only file search tool for clients with file-read access", () => {
    const tools = listRemoteToolDescriptors(["files.read"]);
    expect(tools.map((tool) => tool.name)).toEqual([
      "file_search",
      "file_content_search",
      "file_read",
    ]);
    const search = tools.find((tool) => tool.name === "file_search");
    expect(search?.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
    );
    expect(search?.inputSchema).toEqual(
      expect.objectContaining({
        required: ["agent_id_or_alias", "name_pattern"],
        additionalProperties: false,
        properties: expect.objectContaining({
          root_path: expect.objectContaining({ type: "string" }),
          max_depth: expect.objectContaining({ maximum: 5 }),
          max_results: expect.objectContaining({ maximum: 50 }),
        }),
      }),
    );
  });

  test("retains read-only metadata for inspection tools", () => {
    const tools = listRemoteToolDescriptors(REMOTE_CAPABILITIES);
    const inspection = tools.filter((tool) =>
      [
        "list_hosts",
        "list_agents",
        "get_system_status",
        "tail_logs",
        "file_read",
        "get_audit_events",
      ].includes(tool.name),
    );
    expect(inspection).toHaveLength(6);
    for (const tool of inspection) {
      expect(tool.annotations).toEqual(
        expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
      );
    }
  });
});
