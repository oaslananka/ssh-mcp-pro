import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Windows integration coverage configuration", () => {
  test("declares a Windows-specific integration script", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["test:integration:windows"]).toBe(
      "vitest run --project integration test/integration/windows-ssh.integration.test.ts",
    );
  });

  test("adds a Windows runner integration job to CI", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("integration-windows:");
    expect(workflow).toContain("runs-on: windows-2022");
    expect(workflow).toContain("pnpm run test:integration:windows");
    expect(workflow).toContain('RUN_WINDOWS_SSH_INTEGRATION: "1"');
  });
});
