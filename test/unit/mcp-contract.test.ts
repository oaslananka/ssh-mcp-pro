import Ajv from "ajv";
import { afterEach, describe, expect, test } from "vitest";
import { ConfigManager, DEFAULT_CONFIG } from "../../src/config.js";
import { TOOL_PROFILES, type ToolProfile } from "../../src/connector-profile.js";
import { createToolRegistry } from "../../src/tools/index.js";
import type { ToolCallResult, ToolErrorResponse } from "../../src/tools/types.js";
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

function assertSpecificOutputSchema(schema: unknown, label: string) {
  const candidates = [
    schema,
    ...(((schema as { anyOf?: unknown[] } | undefined)?.anyOf ?? []) as unknown[]),
    ...(((schema as { oneOf?: unknown[] } | undefined)?.oneOf ?? []) as unknown[]),
  ];
  const hasTypedProperties = candidates.some((candidate) => {
    const properties = (candidate as { properties?: unknown } | undefined)?.properties;
    return (
      properties !== undefined &&
      typeof properties === "object" &&
      !Array.isArray(properties) &&
      Object.keys(properties).length > 0
    );
  });

  expect(hasTypedProperties, `${label} must define typed response properties`).toBe(true);
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
  expect(result.structuredContent, `${toolName} must include structuredContent`).toEqual(
    expect.any(Object),
  );
}

function assertToolErrorResponse(
  value: unknown,
  toolName: string,
): asserts value is ToolErrorResponse {
  expect(value, `${toolName} error structuredContent must be ToolErrorResponse-shaped`).toEqual(
    expect.objectContaining({
      error: true,
      code: expect.any(String),
      message: expect.any(String),
    }),
  );
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
      assertSpecificOutputSchema(tool.outputSchema, `${tool.name}.outputSchema`);
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

  test.each(TOOL_PROFILES)(
    "profile %s tools with missing required parameters return typed structured errors",
    async (profile) => {
      const registry = createRegistryForProfile(profile);

      for (const tool of registry.getAllTools()) {
        const required = (tool.inputSchema as { required?: unknown } | undefined)?.required;
        if (!Array.isArray(required) || required.length === 0) {
          continue;
        }

        const result = await registry.dispatch(tool.name, {});

        expect(result.isError, `${tool.name} must reject missing required parameters`).toBe(true);
        assertToolCallResult(result, tool.name);
        assertToolErrorResponse(result.structuredContent, tool.name);
      }
    },
  );
});
