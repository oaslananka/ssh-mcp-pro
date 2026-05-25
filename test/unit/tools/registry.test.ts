import { describe, expect, test } from "vitest";
import type { TextContent, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createTestContainer } from "../helpers.js";
import { createToolRegistry } from "../../../src/tools/index.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { ToolCallResult, ToolErrorResponse, ToolProvider } from "../../../src/tools/types.js";

function makeProvider(namespace: string, toolName: string): ToolProvider {
  return {
    namespace,
    getTools(): Tool[] {
      return [
        {
          name: toolName,
          description: toolName,
          inputSchema: { type: "object", properties: {} },
        },
      ];
    },
    handleTool(name: string): Promise<unknown> | undefined {
      if (name === toolName) {
        return Promise.resolve({ tool: name });
      }
      return undefined;
    },
  };
}

function assertToolErrorResponse(value: unknown): asserts value is ToolErrorResponse {
  expect(value).toEqual(
    expect.objectContaining({
      error: true,
      code: expect.any(String),
      message: expect.any(String),
    }),
  );
}

describe("ToolRegistry", () => {
  test("registers providers and lists tools", () => {
    const registry = new ToolRegistry()
      .register(makeProvider("a", "tool_a"))
      .register(makeProvider("b", "tool_b"));

    expect(registry.getAllTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["tool_a", "tool_b"]),
    );
  });

  test("throws on duplicate namespaces", () => {
    const registry = new ToolRegistry().register(makeProvider("dup", "tool_a"));
    expect(() => registry.register(makeProvider("dup", "tool_b"))).toThrow("already registered");
  });

  test("dispatches tools and aliases", async () => {
    const registry = new ToolRegistry().register(makeProvider("session", "ssh_open_session"));

    const direct = await registry.dispatch("ssh_open_session", {});
    const alias = await registry.dispatch("ssh.openSession", {});
    const aliasContent =
      alias.content[0] && alias.content[0].type === "text" ? alias.content[0].text : "";

    expect(direct.isError).toBeFalsy();
    expect(direct.structuredContent).toEqual({ tool: "ssh_open_session" });
    expect(aliasContent).toContain("ssh_open_session");
  });

  test("passes through explicit structured tool call results", async () => {
    const content: TextContent[] = [{ type: "text", text: "closed" }];
    const explicitResult: ToolCallResult = {
      content,
      structuredContent: { closed: true },
    };
    const registry = new ToolRegistry().register({
      namespace: "explicit",
      getTools: () => [
        {
          name: "explicit_tool",
          description: "Returns an explicit MCP tool result",
          inputSchema: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            properties: { closed: { type: "boolean" } },
            required: ["closed"],
            additionalProperties: false,
          },
        },
      ],
      handleTool(name: string): Promise<unknown> | undefined {
        if (name === "explicit_tool") {
          return Promise.resolve(explicitResult);
        }
        return undefined;
      },
    });

    await expect(registry.dispatch("explicit_tool", {})).resolves.toEqual(explicitResult);
  });

  test("rejects primitive handler results instead of using generic result fallback", async () => {
    const registry = new ToolRegistry().register({
      namespace: "primitive",
      getTools: () => [
        {
          name: "primitive_tool",
          description: "Returns a primitive result",
          inputSchema: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      ],
      handleTool(name: string): Promise<unknown> | undefined {
        if (name === "primitive_tool") {
          return Promise.resolve(true);
        }
        return undefined;
      },
    });

    const result = await registry.dispatch("primitive_tool", {});

    assertToolErrorResponse(result.structuredContent);
    expect(result).toEqual(
      expect.objectContaining({
        isError: true,
        structuredContent: expect.objectContaining({
          error: true,
          code: "ESTRUCTUREDCONTENT",
        }),
      }),
    );
    expect(result.structuredContent).not.toHaveProperty("result");
  });

  test("returns ToolErrorResponse-shaped structured errors and unknown-tool responses", async () => {
    const registry = new ToolRegistry().register({
      namespace: "broken",
      getTools: () => [],
      handleTool(name: string): Promise<unknown> | undefined {
        if (name === "broken_tool") {
          return Promise.reject(new Error("boom"));
        }
        return undefined;
      },
    });

    const broken = await registry.dispatch("broken_tool", {});
    const missing = await registry.dispatch("missing_tool", {});

    expect(broken.isError).toBe(true);
    assertToolErrorResponse(broken.structuredContent);
    expect(broken.structuredContent).toEqual(
      expect.objectContaining({ code: "ETOOL", message: "boom" }),
    );

    expect(missing.isError).toBe(true);
    assertToolErrorResponse(missing.structuredContent);
    expect(missing.structuredContent).toEqual(
      expect.objectContaining({
        code: "ETOOLNOTFOUND",
        message: "Unknown tool: missing_tool",
      }),
    );
  });

  test("all production tools expose required MCP annotations", async () => {
    const container = createTestContainer();
    const registry = createToolRegistry(container);

    for (const tool of registry.getAllTools()) {
      expect(tool.annotations).toEqual(
        expect.objectContaining({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        }),
      );
      expect(tool.title ?? tool.annotations?.title).toEqual(expect.any(String));
      expect(tool.outputSchema).toEqual(expect.objectContaining({ type: "object" }));
    }

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });
});
