import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = [
  { name: "ChatGPT", path: "apps/chatgpt/app-readiness.json", profile: "chatgpt", kind: "app" },
  {
    name: "Claude",
    path: "apps/claude/connector-readiness.json",
    profile: "claude",
    kind: "connector",
  },
  {
    name: "Gemini",
    path: "apps/google/gemini-app-readiness.json",
    profile: "gemini",
    kind: "connector",
  },
] as const;

type Readiness = {
  publishReady: unknown;
  submission: Record<string, unknown>;
};

function runValidation(
  fixture: (typeof fixtures)[number],
  mutate: (readiness: Readiness) => void = () => {},
) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ssh-mcp-app-readiness-"));
  try {
    const readiness = JSON.parse(
      readFileSync(resolve(repoRoot, fixture.path), "utf8"),
    ) as Readiness;
    mutate(readiness);
    const temporaryFile = join(temporaryDirectory, "readiness.json");
    writeFileSync(temporaryFile, JSON.stringify(readiness));
    const script = [
      'import { validateAppReadiness } from "./scripts/lib/validate-app-readiness.mjs";',
      "validateAppReadiness({",
      "  file: process.argv[1],",
      "  displayName: process.argv[2],",
      "  profile: process.argv[3],",
      "  kind: process.argv[4],",
      "});",
    ].join("\n");
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        script,
        temporaryFile,
        fixture.name,
        fixture.profile,
        fixture.kind,
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 15_000 },
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function markLegalDocsReviewed(readiness: Readiness) {
  readiness.submission.privacyPolicyReviewed = true;
  (readiness as Readiness & { privacyUrl: string; termsUrl: string }).privacyUrl =
    "https://example.org/privacy";
  (readiness as Readiness & { privacyUrl: string; termsUrl: string }).termsUrl =
    "https://example.org/terms";
}

describe("app publication readiness guard", () => {
  test.each(fixtures)("$name: unpublished metadata still validates", (fixture) => {
    const result = runValidation(fixture);
    expect(result.status, result.stderr).toBe(0);
  });

  test.each(fixtures)("$name: publication flag cannot be a string", (fixture) => {
    const result = runValidation(fixture, (r) => {
      r.publishReady = "true";
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("publishReady must be an explicit boolean");
  });

  test.each(fixtures)("$name: inaccurate policy links fail publication", (fixture) => {
    const result = runValidation(fixture, (r) => {
      r.publishReady = true;
      r.submission.privacyPolicyReviewed = true;
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("privacyUrl must link to a dedicated HTTPS policy document");
  });

  test("a security advisory page cannot replace a privacy notice", () => {
    const result = runValidation(fixtures[0], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
      (r as Readiness & { privacyUrl: string }).privacyUrl = "https://example.org/SECURITY.md";
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("privacyUrl must link to a dedicated HTTPS policy document");
  });

  test("an open-source license cannot replace hosted-service terms", () => {
    const result = runValidation(fixtures[1], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
      (r as Readiness & { termsUrl: string }).termsUrl = "https://example.org/LICENSE";
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("termsUrl must link to a dedicated HTTPS policy document");
  });

  test("ChatGPT: unpublished domain verification is a blocker", () => {
    const result = runValidation(fixtures[0], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("submission.domainVerificationConfigured");
  });

  test("ChatGPT: screenshots are independently required", () => {
    const result = runValidation(fixtures[0], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
      r.submission.domainVerificationConfigured = true;
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("submission.screenshotsPrepared");
  });

  test("Gemini: incomplete OAuth blocks a publication-ready claim", () => {
    const result = runValidation(fixtures[2], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("submission.oauthConfigured");
  });

  test("an insecure HTTP MCP endpoint cannot be declared publication-ready", () => {
    const result = runValidation(fixtures[1], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
      r.submission.publicHttpsMcpEndpoint = "http://localhost:3000/mcp";
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("submission.publicHttpsMcpEndpoint");
  });

  test("an explicitly completed checklist passes metadata validation", () => {
    const result = runValidation(fixtures[0], (r) => {
      r.publishReady = true;
      markLegalDocsReviewed(r);
      r.submission.domainVerificationConfigured = true;
      r.submission.screenshotsPrepared = true;
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
