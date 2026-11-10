import fs from "node:fs";
import { describe, expect, test } from "vitest";

const options = JSON.parse(fs.readFileSync("typedoc.json", "utf8")) as {
  readme: string;
  customCss: string;
  customJs: string;
  favicon: string;
  navigationLinks: Record<string, string>;
};
const docsWorkflow = fs.readFileSync(".github/workflows/docs.yml", "utf8");
const css = fs.readFileSync(options.customCss, "utf8");
const js = fs.readFileSync(options.customJs, "utf8");
const overview = fs.readFileSync(options.readme, "utf8");

describe("API documentation theme and publish contract", () => {
  test("uses a focused landing page, custom theme and original TypeDoc renderer", () => {
    expect(options.readme).toBe("docs/api-overview.md");
    expect(options.customCss).toBe("docs/theme/ssh-docs.css");
    expect(options.customJs).toBe("docs/theme/ssh-docs.js");
    expect(options.favicon).toBe("docs/theme/favicon.svg");
    expect(fs.existsSync(options.favicon)).toBe(true);
    expect(options.navigationLinks.GitHub).toBe("https://github.com/oaslananka/ssh-mcp-pro");
    expect(overview).toContain('class="docs-hero"');
    expect(overview).toContain("## Quickstart");
    expect(overview).toContain("host-key verification");
  });

  test("keeps content out of navigation columns and supports reduced motion", () => {
    expect(css).toContain("minmax(0, 1fr)");
    expect(css).toContain('grid-template-areas: "sidebar content toc"');
    expect(css).toContain(".tsd-typography table");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain(".tsd-member-summary-name");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("@media (max-width: 769px)");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  test("provides a keyboard-accessible, persisted light/dark switch", () => {
    expect(js).toContain('document.createElement("button")');
    expect(js).toContain('button.type = "button"');
    expect(js).toContain('button.setAttribute("aria-label"');
    expect(js).toContain("window.localStorage.setItem(THEME_KEY, next)");
    expect(js).toContain('existingTheme.dispatchEvent(new Event("change"');
    expect(js).toContain("prefers-color-scheme: dark");
  });

  test("triggers Pages verification and deployment for theme-only changes", () => {
    expect(docsWorkflow.match(/- "docs\/theme\/\*\*"/g)).toHaveLength(2);
    expect(docsWorkflow.match(/- "docs\/api-overview\.md"/g)).toHaveLength(2);
    expect(docsWorkflow).toContain("pnpm run docs:check");
    expect(docsWorkflow).toContain("test -s docs/api/assets/custom.css");
    expect(docsWorkflow).toContain("test -s docs/api/assets/custom.js");
    expect(docsWorkflow).toContain("test -s docs/api/assets/favicon.svg");
    expect(docsWorkflow).toContain("actions/deploy-pages@");
  });
});
