#!/usr/bin/env node
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import process from "node:process";
import { commandFailure, runCommand } from "./lib/command.mjs";

const args = new Set(process.argv.slice(2));
const offline = args.has("--offline");
const json = args.has("--json");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseConfig = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

const state = {
  generatedAt: new Date().toISOString(),
  repository: "oaslananka/ssh-mcp-pro",
  package: {
    name: packageJson.name,
    version: packageJson.version,
    publishAccess: packageJson.publishConfig?.access ?? null,
  },
  releasePlease: {
    releaseType: releaseConfig["release-type"],
    manifestVersion: JSON.parse(readFileSync(".release-please-manifest.json", "utf8"))["."],
    changelogPath: releaseConfig.packages?.["."]?.["changelog-path"] ?? null,
  },
  workflow: inspectWorkflow(releaseWorkflow),
  trustedPublishing: {
    provider: "github",
    package: packageJson.name,
    repository: "oaslananka/ssh-mcp-pro",
    workflowFile: basename(".github/workflows/release.yml"),
    environment: "npm-production",
    allowedAction: "npm publish",
    autoPublishVariable: "AUTO_RELEASE_PUBLISH",
  },
  localTools: {
    node: process.version,
    npm: commandVersion("npm", ["--version"]),
    pnpm: commandVersion("pnpm", ["--version"]),
  },
};

if (!offline) {
  state.github = readGithubState();
  state.npm = readNpmState(packageJson.name);
}

if (json) {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
} else {
  printTextSummary(state);
}

function inspectWorkflow(workflow) {
  return {
    hasNpmProductionEnvironment: workflow.includes("environment: npm-production"),
    hasOidcPermission: workflow.includes("id-token: write"),
    usesNpmPublish: workflow.includes("npm publish"),
    gatesPublishWithVariable: workflow.includes("vars.AUTO_RELEASE_PUBLISH == 'true'"),
  };
}

function commandVersion(command, commandArgs) {
  const result = runCommand(command, commandArgs);
  if (result.status !== 0) {
    return commandFailure(command, result);
  }

  return { ok: true, value: result.stdout.trim() };
}

function readGithubState() {
  return {
    environment: runGhJson(["api", "repos/oaslananka/ssh-mcp-pro/environments/npm-production"]),
    environmentVariables: runGhJson([
      "api",
      "repos/oaslananka/ssh-mcp-pro/environments/npm-production/variables",
    ]),
    releases: runGhJson(["api", "repos/oaslananka/ssh-mcp-pro/releases"]),
  };
}

function readNpmState(packageName) {
  return {
    packageVersion: runNpmJson(["view", packageName, "version", "--json"]),
    trustedPublishers: runNpmJson(["trust", "list", packageName, "--json"]),
    trustedPublisherDryRun: runNpmJson([
      "trust",
      "github",
      packageName,
      "--file",
      "release.yml",
      "--repo",
      "oaslananka/ssh-mcp-pro",
      "--env",
      "npm-production",
      "--allow-publish",
      "--dry-run",
      "--json",
    ]),
  };
}

function runGhJson(commandArgs) {
  return runJsonCommand("gh", commandArgs, "GitHub CLI");
}

function runNpmJson(commandArgs) {
  return runJsonCommand("npm", commandArgs, "npm CLI");
}

function runJsonCommand(command, commandArgs, label) {
  const result = runCommand(command, commandArgs);
  if (result.status !== 0) {
    return commandFailure(label, result);
  }

  try {
    return { ok: true, value: JSON.parse(result.stdout || "null") };
  } catch (error) {
    return { ok: false, status: result.status ?? null, error: `${label} returned invalid JSON.` };
  }
}

function printTextSummary(currentState) {
  console.log(`release-state: ${currentState.package.name}@${currentState.package.version}`);
  console.log(`release-state: environment ${currentState.trustedPublishing.environment}`);
  console.log(`release-state: publish gate ${currentState.trustedPublishing.autoPublishVariable}`);
  console.log(`release-state: offline=${offline}`);
}
