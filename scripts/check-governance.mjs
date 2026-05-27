#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TAXONOMY_URL = new URL("../docs/governance/issue-taxonomy.json", import.meta.url);

export const PROJECT_SCOPE_HINT =
  "GitHub Projects access requires read:project. Run: gh auth refresh -s read:project";

export function loadTaxonomy(taxonomyPath = fileURLToPath(DEFAULT_TAXONOMY_URL)) {
  return JSON.parse(readFileSync(taxonomyPath, "utf8"));
}

export function getRequiredLabels(taxonomy) {
  return Object.values(taxonomy.labelGroups).flat();
}

export function validateLabels(actualLabels, taxonomy) {
  const actualByName = new Map((actualLabels ?? []).map((label) => [label.name, label]));
  const failures = [];

  for (const expected of getRequiredLabels(taxonomy)) {
    const actual = actualByName.get(expected.name);
    if (!actual) {
      failures.push(`Missing label ${expected.name}.`);
      continue;
    }

    if (normalizeColor(actual.color) !== normalizeColor(expected.color)) {
      failures.push(`Label ${expected.name} color is ${actual.color}; expected ${expected.color}.`);
    }

    if (normalizeText(actual.description) !== expected.description) {
      failures.push(`Label ${expected.name} description does not match the governance taxonomy.`);
    }
  }

  return failures;
}

export function validateIssueTaxonomy(issues, taxonomy) {
  const groups = getLabelGroups(taxonomy);
  const failures = [];

  for (const issue of issues ?? []) {
    const issueLabels = new Set((issue.labels ?? []).map((label) => label.name));
    for (const [groupName, labelNames] of Object.entries(groups)) {
      const matches = labelNames.filter((labelName) => issueLabels.has(labelName));
      if (matches.length !== 1) {
        failures.push(
          `Issue #${issue.number} has ${matches.length} ${groupName} labels; expected exactly one.`,
        );
      }
    }
  }

  return failures;
}

export function validateProjectFields(fieldsPayload, taxonomy) {
  const fields = Array.isArray(fieldsPayload) ? fieldsPayload : fieldsPayload?.fields;
  const actualNames = new Set((fields ?? []).map((field) => field.name));

  return taxonomy.project.requiredFields
    .filter((fieldName) => !actualNames.has(fieldName))
    .map((fieldName) => `Project is missing required field ${fieldName}.`);
}

export function extractProjectItemIssueNumbers(projectPayload) {
  const items = Array.isArray(projectPayload) ? projectPayload : projectPayload?.items;
  const numbers = new Set();

  for (const item of items ?? []) {
    collectIssueNumbers(item, numbers);
  }

  return numbers;
}

export function validateProjectItems(projectPayload, issues) {
  const projectIssueNumbers = extractProjectItemIssueNumbers(projectPayload);
  const openIssueNumbers = (issues ?? []).map((issue) => issue.number);

  if (openIssueNumbers.length > 0 && projectIssueNumbers.size === 0) {
    return ["Project item list did not expose issue numbers for synchronization validation."];
  }

  return openIssueNumbers
    .filter((issueNumber) => !projectIssueNumbers.has(issueNumber))
    .map((issueNumber) => `Open issue #${issueNumber} is missing from the governance project.`);
}

export function formatFailures(failures) {
  return `Governance check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`;
}

export function formatGhFailure(args, result) {
  if (result.error) {
    return `Failed to execute gh: ${result.error.message}`;
  }

  const stderr = normalizeText(result.stderr);
  const stdout = normalizeText(result.stdout);
  const output = [stderr, stdout].filter(Boolean).join("\n");
  const base = `gh ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`;

  if (output.includes("read:project") || output.includes("missing required scopes")) {
    return `${base}\n${PROJECT_SCOPE_HINT}`;
  }

  return output ? `${base}\n${output}` : base;
}

export function runGovernanceCheck(options = {}) {
  const runGh = options.runGh ?? defaultRunGh;
  const taxonomy = loadTaxonomy(options.taxonomyPath);
  const repo = options.repo ?? taxonomy.repository;
  const owner = options.owner ?? taxonomy.project.owner;
  const project = String(options.project ?? taxonomy.project.number);
  const failures = [];

  const labels = runGhJson(
    ["label", "list", "--repo", repo, "--limit", "500", "--json", "name,color,description"],
    runGh,
  );
  const issues = runGhJson(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      "500",
      "--json",
      "number,title,labels",
    ],
    runGh,
  );
  failures.push(...validateLabels(labels, taxonomy), ...validateIssueTaxonomy(issues, taxonomy));

  if (!options.skipProject) {
    const fields = runGhJson(
      ["project", "field-list", project, "--owner", owner, "--format", "json"],
      runGh,
    );
    const items = runGhJson(
      ["project", "item-list", project, "--owner", owner, "--format", "json", "--limit", "100"],
      runGh,
    );
    failures.push(
      ...validateProjectFields(fields, taxonomy),
      ...validateProjectItems(items, issues),
    );
  }

  return { failures, issueCount: issues.length };
}

function getLabelGroups(taxonomy) {
  return Object.fromEntries(
    Object.entries(taxonomy.labelGroups).map(([groupName, labels]) => [
      groupName,
      labels.map((label) => label.name),
    ]),
  );
}

function collectIssueNumbers(value, numbers, seen = new Set(), key = "") {
  if (!value) {
    return;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
  }

  const issueNumber = getProjectIssueNumber(value, key);
  if (issueNumber !== null) {
    numbers.add(issueNumber);
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectIssueNumbers(item, numbers, seen, key));
  } else if (typeof value === "object") {
    Object.entries(value).forEach(([childKey, item]) =>
      collectIssueNumbers(item, numbers, seen, childKey),
    );
  }
}

function getProjectIssueNumber(value, key) {
  if (typeof value === "string") {
    return parseIssueNumber(value);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const urlIssueNumber = [value.url, value.resourcePath]
    .map(parseIssueNumber)
    .find((number) => number !== null);
  if (urlIssueNumber !== undefined) {
    return urlIssueNumber;
  }

  if ((key === "content" || value.type === "Issue") && isPositiveInteger(value.number)) {
    return value.number;
  }
  return null;
}

function parseIssueNumber(value) {
  const match = String(value ?? "").match(/(?:\/issues\/|#)(\d+)(?:\b|$)/u);
  return match ? Number(match[1]) : null;
}

function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function runGhJson(args, runGh) {
  const result = runGh(args);
  if (result.status !== 0) {
    throw new Error(formatGhFailure(args, result));
  }

  return JSON.parse(result.stdout);
}

function defaultRunGh(args) {
  return spawnSync("gh", args, { encoding: "utf8" });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--skip-project") {
      options.skipProject = true;
    } else if (arg === "--repo") {
      options.repo = argv[++index];
    } else if (arg === "--owner") {
      options.owner = argv[++index];
    } else if (arg === "--project") {
      options.project = argv[++index];
    } else if (arg === "--taxonomy") {
      options.taxonomyPath = argv[++index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function normalizeColor(color) {
  return normalizeText(color).toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function main() {
  try {
    const result = runGovernanceCheck(parseArgs(process.argv.slice(2)));
    if (result.failures.length > 0) {
      console.error(formatFailures(result.failures));
      process.exitCode = 1;
      return;
    }

    console.log(`Governance check passed for ${result.issueCount} open issues.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
