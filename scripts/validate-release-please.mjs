#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const releasePleaseConfigFile = "release-please-config.json";
const manifestFile = ".release-please-manifest.json";
const releaseWorkflowFile = ".github/workflows/release.yml";
const expectedReleasePleaseSha = "45996ed1f6d02564a971a2fa1b5860e934307cf7";
const expectedEnvironment = "npm-production";

const failures = [];
const packageJson = readJson("package.json");
const config = readJson(releasePleaseConfigFile);
const manifest = readJson(manifestFile);
const workflow = readFile(releaseWorkflowFile);

assertEqual("package name", packageJson.name, "ssh-mcp-pro");
assertEqual("release type", config["release-type"], "node");
assertEqual("manifest root version", manifest["."], packageJson.version);
assertEqual("release package name", config.packages?.["."]?.["package-name"], packageJson.name);
assertEqual("changelog path", config.packages?.["."]?.["changelog-path"], "CHANGELOG.md");
assertIncludes("release workflow environment", workflow, `environment: ${expectedEnvironment}`);
assertIncludes(
  "release-please action pin",
  workflow,
  `googleapis/release-please-action@${expectedReleasePleaseSha}`,
);
assertIncludes("OIDC permission", workflow, "id-token: write");
assertIncludes("npm trusted publish command", workflow, "npm publish");
assertIncludes("npm publish gate", workflow, "vars.AUTO_RELEASE_PUBLISH == 'true'");
assertEqual("publish access", packageJson.publishConfig?.access, "public");

for (const target of config.packages?.["."]?.["extra-files"] ?? []) {
  if (!existsSync(target.path)) {
    failures.push(`release-please extra file is missing: ${target.path}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  throw new Error("Release Please configuration is not ready.");
}

console.log("validate-release-please: release configuration is ready.");

function readJson(path) {
  return JSON.parse(readFile(path));
}

function readFile(path) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing.`);
  }

  return readFileSync(path, "utf8");
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function assertIncludes(label, haystack, needle) {
  if (!haystack.includes(needle)) {
    failures.push(`${label} must include ${needle}.`);
  }
}
