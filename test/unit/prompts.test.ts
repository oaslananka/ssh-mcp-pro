import { describe, expect, test } from "vitest";
import {
  formatPromptsForDisplay,
  getMCPPrompt,
  getPromptsByCategory,
  listMCPPrompts,
  getRandomPrompts,
  PROMPT_SUGGESTIONS,
} from "../../src/prompts.js";

describe("prompt suggestions", () => {
  test("filters prompts by category", () => {
    const prompts = getPromptsByCategory("session");

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((prompt) => prompt.category === "session")).toBe(true);
  });

  test("returns a bounded random selection", () => {
    const prompts = getRandomPrompts(3);

    expect(prompts.length).toBe(3);
    expect(prompts.every((prompt) => PROMPT_SUGGESTIONS.includes(prompt))).toBe(true);
  });

  test("formats display output by category", () => {
    const display = formatPromptsForDisplay();

    expect(display).toContain("ssh-mcp-pro - What You Can Do");
    expect(display).toContain("Session Operations");
    expect(display).toContain("Package Operations");
  });

  test("exposes curated MCP prompts", () => {
    const prompts = listMCPPrompts();

    expect(prompts.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "safe-connect",
          title: expect.stringContaining("Safely connect"),
        }),
        expect.objectContaining({
          name: "plan-mutation",
        }),
      ]),
    );

    const prompt = getMCPPrompt("safe-connect", {
      host: "prod-1",
      username: "deploy",
    });

    expect(prompt.messages[0]?.content.text).toContain("hostKeyPolicy=strict");
    expect(prompt.messages[0]?.content.text).toContain("prod-1");
    expect(() => getMCPPrompt("missing")).toThrow("Unknown prompt");
  });

  test("renders every curated MCP prompt with safe fallbacks", () => {
    expect(getMCPPrompt("safe-connect").messages[0]?.content.text).toContain("<host>");
    expect(getMCPPrompt("inspect-host-capabilities").messages[0]?.content.text).toContain(
      "os_detect",
    );
    expect(getMCPPrompt("plan-mutation").messages[0]?.content.text).toContain("<describe change>");
    expect(getMCPPrompt("managed-config-change").messages[0]?.content.text).toContain("<path>");
  });
});
