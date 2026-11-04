import { existsSync, readFileSync } from "node:fs";

function assertValid(condition, message) {
  if (!condition) throw new Error(message);
}

/** Validate shipped connector metadata against the published package contract. */
export function validateAppReadiness({ file, displayName, profile, kind }) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const readiness = JSON.parse(readFileSync(file, "utf8"));

  assertValid(
    readiness.sourceRepository === pkg.repository.url.replace(/^git\+/u, "").replace(/\.git$/u, ""),
    "sourceRepository must match package repository.",
  );
  for (const [field, expected] of [
    ["serverName", pkg.mcpName],
    ["packageName", pkg.name],
    ["version", pkg.version],
  ]) {
    assertValid(
      readiness.mcp?.[field] === expected,
      `${displayName} ${field} must match package ${field === "serverName" ? "mcpName" : field}.`,
    );
  }

  assertValid(
    typeof readiness.publishReady === "boolean",
    displayName + " publishReady must be an explicit boolean.",
  );

  // The metadata validator must accept intentional pre-release drafts, but
  // a positive publication claim needs every existing project attestation.
  if (readiness.publishReady) {
    const submission = readiness.submission;
    assertValid(
      submission && typeof submission === "object",
      displayName + " submission checklist is required for publishReady.",
    );
    // Security disclosure instructions and an open-source license are not
    // a privacy notice or hosted-service terms. Do not attest publication
    // readiness until distinct, reviewed documents have been published.
    for (const field of ["privacyUrl", "termsUrl"]) {
      const value = readiness[field];
      let url;
      try {
        url = typeof value === "string" ? new URL(value) : undefined;
      } catch {
        // Fall through to the deterministic validation error below.
      }
      assertValid(
        url?.protocol === "https:" &&
          url.hostname !== "" &&
          !/\/(?:SECURITY\.md|LICENSE)(?:$|\/)/iu.test(url.pathname),
        displayName + " " + field + " must link to a dedicated HTTPS policy document.",
      );
    }

    const shared = ["oauthConfigured", "privacyPolicyReviewed", "reviewTestCasesPrepared"];
    const specific =
      kind === "app"
        ? [
            "dashboardConfigured",
            "domainVerificationConfigured",
            "componentCspConfigured",
            "screenshotsPrepared",
          ]
        : ["allowedOriginsConfigured", "supportContactConfigured"];
    for (const field of [...shared, ...specific]) {
      assertValid(
        submission[field] === true,
        displayName + " submission." + field + " must be true before publication.",
      );
    }
    assertValid(
      typeof submission.publicHttpsMcpEndpoint === "string" &&
        /^https:\/\/[^\s/]+\/mcp$/u.test(submission.publicHttpsMcpEndpoint),
      displayName + " submission.publicHttpsMcpEndpoint must be an HTTPS MCP URL.",
    );
  }

  if (kind === "app") {
    assertValid(
      readiness.app?.defaultProfile === profile,
      `${displayName} default profile must be ${profile}.`,
    );
    assertValid(existsSync(readiness.app?.icon), `${displayName} icon file must exist.`);
  } else if (kind === "connector") {
    assertValid(
      readiness.connector?.runtimeProfile === profile,
      `${displayName} runtime profile must be ${profile}.`,
    );
  } else {
    throw new Error("Unknown connector readiness type.");
  }
}
