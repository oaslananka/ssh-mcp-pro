import { existsSync, readFileSync } from "node:fs";

/** Validate shipped connector metadata against the published package contract. */
export function validateAppReadiness({ file, displayName, profile, kind }) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const readiness = JSON.parse(readFileSync(file, "utf8"));
  function assertValid(condition, message) {
    if (!condition) throw new Error(message);
  }

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
