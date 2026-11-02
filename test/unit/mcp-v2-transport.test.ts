import { afterEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SSHMCPServer } from "../../src/mcp.js";
import { createTestContainer } from "./helpers.js";

describe("MCP v2 stdio-era negotiation", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  test.each(["auto", "legacy"] as const)(
    "serves %s clients with the same SSH tools",
    async (mode) => {
      const container = createTestContainer();
      cleanup.push(async () => {
        container.rateLimiter.destroy();
        await container.sessionManager.destroy();
      });
      const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
      const serverHandle = serveStdio(() => new SSHMCPServer(container).getSdkServer(), {
        transport: serverEnd,
      });
      cleanup.push(() => serverHandle.close());

      const client = new Client(
        { name: `stdio-acceptance-${mode}`, version: "1.0.0" },
        { versionNegotiation: { mode } },
      );
      await client.connect(clientEnd);
      cleanup.push(() => client.close());

      expect(client.getProtocolEra()).toBe(mode === "auto" ? "modern" : "legacy");
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("connector_status");
      const result = await client.callTool({ name: "connector_status", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeDefined();
    },
  );
});
