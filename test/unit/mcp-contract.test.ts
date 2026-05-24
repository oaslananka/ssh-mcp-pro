import Ajv from "ajv";
import { afterEach, describe, expect, test } from "vitest";
import { ConfigManager, DEFAULT_CONFIG } from "../../src/config.js";
import { TOOL_PROFILES, type ToolProfile } from "../../src/connector-profile.js";
import { createToolRegistry } from "../../src/tools/index.js";
import type { ToolCallResult } from "../../src/tools/types.js";
import { createTestContainer } from "./helpers.js";

const EXPECTED_TOOL_COUNTS: Record<ToolProfile, number> = {
  full: 33,
  "remote-safe": 5,
  chatgpt: 5,
  claude: 5,
  "remote-readonly": 5,
  "remote-broker": 5,
};

const ajv = new Ajv({ allErrors: true, validateSchema: true });
const containers = new Set<ReturnType<typeof createTestContainer>>();

function formatAjvErrors() {
  return ajv.errorsText(ajv.errors, { separator: "\n" });
}

function createRegistryForProfile(profile: ToolProfile) {
  const container = createTestContainer({
    config: new ConfigManager({
      connector: {
        ...DEFAULT_CONFIG.connector,
        toolProfile: profile,
      },
    }),
  });
  containers.add(container);

  return createToolRegistry(container);
}

function assertValidSchema(schema: unknown, label: string) {
  expect(
    ajv.validateSchema(schema),
    `${label} must be valid JSON Schema:\n${formatAjvErrors()}`,
  ).toBe(true);
}

function assertToolCallResult(result: ToolCallResult, toolName: string) {
  expect(result, `${toolName} must return a ToolCallResult`).toEqual(
    expect.objectContaining({
      content: expect.any(Array),
    }),
  );
  expect(
    result.content.length,
    `${toolName} must return at least one content item`,
  ).toBeGreaterThan(0);
}

afterEach(async () => {
  for (const container of containers) {
    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  }
  containers.clear();
});

describe("MCP tool contracts", () => {
  test.each(TOOL_PROFILES)("profile %s exposes the expected tool count", (profile) => {
    const registry = createRegistryForProfile(profile);

    expect(registry.getAllTools()).toHaveLength(EXPECTED_TOOL_COUNTS[profile]);
  });

  test.each(TOOL_PROFILES)("profile %s exposes valid tool metadata and schemas", (profile) => {
    const registry = createRegistryForProfile(profile);

    for (const tool of registry.getAllTools()) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/u);
      expect(tool.description.trim()).not.toHaveLength(0);
      expect(tool.annotations).toEqual(expect.objectContaining({ title: expect.any(String) }));
      expect(tool.annotations?.title?.trim()).not.toHaveLength(0);
      assertValidSchema(tool.inputSchema, `${tool.name}.inputSchema`);
      assertValidSchema(tool.outputSchema, `${tool.name}.outputSchema`);
    }
  });

  test.each(TOOL_PROFILES)(
    "profile %s tools dispatch with empty args without uncaught exceptions",
    async (profile) => {
      const registry = createRegistryForProfile(profile);

      for (const tool of registry.getAllTools()) {
        const result = await registry.dispatch(tool.name, {});

        assertToolCallResult(result, tool.name);
        if (!result.isError) {
          expect(
            ajv.validate(tool.outputSchema, result.structuredContent),
            `${tool.name}.structuredContent must satisfy outputSchema:\n${formatAjvErrors()}`,
          ).toBe(true);
        }
      }
    },
  );
});
