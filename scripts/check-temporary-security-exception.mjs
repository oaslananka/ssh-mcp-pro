import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const advisoryId = "GHSA-fc5q-39xc-vjpf";
const expiry = "2026-12-17T00:00:00.000Z";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function audit(args) {
  const result = spawnSync("pnpm", ["audit", ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function fail(message) {
  console.error("Dependency audit blocked: " + message);
  process.exitCode = 1;
}

const production = audit(["--prod", "--audit-level", "moderate"]);
if (production.status !== 0) {
  fail(
    "Production dependency audit did not pass. " + (production.stderr || production.stdout).trim(),
  );
} else {
  const full = audit(["--audit-level", "moderate", "--json"]);
  let report;
  try {
    report = JSON.parse(full.stdout);
  } catch {
    fail("Full audit did not return valid JSON. " + full.stderr.trim());
  }

  if (report) {
    const advisories = Object.values(report.advisories || {});
    if (full.status !== 1 || advisories.length !== 1) {
      fail(
        "Expected exactly one documented development-only advisory; found " +
          advisories.length +
          " or audit exited " +
          full.status +
          ". Recheck the full report and remove the exception if fixed.",
      );
    } else {
      const issue = advisories[0];
      const paths = (issue.findings || []).flatMap((finding) => finding.paths || []);
      const verified =
        issue.url?.toLowerCase().endsWith(advisoryId.toLowerCase()) &&
        issue.module_name === "picomatch" &&
        issue.patched_versions == null &&
        paths.length > 0 &&
        paths.every((path) => {
          const direct = path.split(">")[1];
          return (
            direct &&
            Object.hasOwn(pkg.devDependencies || {}, direct) &&
            !Object.hasOwn(pkg.dependencies || {}, direct) &&
            !Object.hasOwn(pkg.optionalDependencies || {}, direct)
          );
        });

      if (!verified) {
        fail("The known advisory is no longer solely unpatched dev-tool exposure.");
      } else if (Date.now() >= Date.parse(expiry)) {
        fail("The reviewed dev-tool exception expired on 2026-12-17.");
      } else {
        console.log("Production dependencies: no known moderate-or-higher findings.");
        console.log(
          "Known dev-only exception " +
            advisoryId +
            " is still present, unpatched and scoped to development tools.",
        );
        console.log("The exception expires 2026-12-17; all other advisories remain blocking.");
      }
    }
  }
}
