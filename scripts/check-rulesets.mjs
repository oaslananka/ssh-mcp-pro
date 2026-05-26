#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rulesetDir = ".github/rulesets";
const mainProtectionFile = "main-protection.json";
const requiredMainProtectionRules = [
  "pull_request",
  "required_status_checks",
  "non_fast_forward",
  "deletion",
  "required_linear_history",
];
const requiredMainContexts = [
  "Quality Gates",
  "Unit Tests (Node 22)",
  "Unit Tests (Node 24)",
  "SSH Integration",
  "Windows Integration",
  "SSH E2E",
  "Build, SBOM, and Pack",
  "Build and smoke image",
  "Analyze TypeScript",
  "Validate MCP Registry metadata",
];
const protectedWorkflowFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/docker.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/mcp-registry.yml",
];

if (!existsSync(rulesetDir)) {
  console.log("check-rulesets: no ruleset directory found; skipping.");
  process.exit(0);
}

const files = readdirSync(rulesetDir).filter((file) => file.endsWith(".json"));
const workflowJobNames = extractWorkflowJobNames(protectedWorkflowFiles);

for (const file of files) {
  const path = join(rulesetDir, file);
  const ruleset = JSON.parse(readFileSync(path, "utf8"));
  if (!ruleset.name || !Array.isArray(ruleset.rules)) {
    throw new Error(`${path} must include a name and rules array.`);
  }

  if (file === mainProtectionFile) {
    validateMainProtection(path, ruleset, workflowJobNames);
  }
}

console.log(`check-rulesets: validated ${files.length} ruleset file(s).`);

function validateMainProtection(path, ruleset, workflowJobNames) {
  assertEqual(path, "name", ruleset.name, "main branch protection");
  assertEqual(path, "target", ruleset.target, "branch");
  assertEqual(path, "enforcement", ruleset.enforcement, "active");
  assertArrayEqual(path, "bypass_actors", ruleset.bypass_actors, []);
  assertArrayEqual(path, "conditions.ref_name.include", ruleset.conditions?.ref_name?.include, [
    "~DEFAULT_BRANCH",
  ]);
  assertArrayEqual(path, "conditions.ref_name.exclude", ruleset.conditions?.ref_name?.exclude, []);

  const ruleTypes = ruleset.rules.map((rule) => rule.type);
  for (const type of requiredMainProtectionRules) {
    if (!ruleTypes.includes(type)) {
      throw new Error(`${path} is missing required ${type} rule.`);
    }
  }

  const pullRequestRule = findRule(path, ruleset, "pull_request");
  assertArrayEqual(
    path,
    "pull_request.parameters.allowed_merge_methods",
    pullRequestRule.parameters?.allowed_merge_methods,
    ["squash", "rebase"],
  );
  assertEqual(
    path,
    "pull_request.parameters.required_review_thread_resolution",
    pullRequestRule.parameters?.required_review_thread_resolution,
    true,
  );
  assertEqual(
    path,
    "pull_request.parameters.required_approving_review_count",
    pullRequestRule.parameters?.required_approving_review_count,
    1,
  );

  const statusRule = findRule(path, ruleset, "required_status_checks");
  assertEqual(
    path,
    "required_status_checks.parameters.strict_required_status_checks_policy",
    statusRule.parameters?.strict_required_status_checks_policy,
    true,
  );
  assertEqual(
    path,
    "required_status_checks.parameters.do_not_enforce_on_create",
    statusRule.parameters?.do_not_enforce_on_create,
    false,
  );

  const contexts = statusRule.parameters?.required_status_checks?.map((check) => check.context);
  assertArrayEqual(
    path,
    "required_status_checks.parameters.required_status_checks[].context",
    contexts,
    requiredMainContexts,
  );
  validateContextsMatchWorkflowJobs(path, contexts, workflowJobNames);
}

function validateContextsMatchWorkflowJobs(path, contexts, workflowJobNames) {
  for (const context of contexts) {
    if (!workflowJobNames.some((jobName) => workflowJobNameMatchesContext(jobName, context))) {
      throw new Error(`${path} references ${context}, but no protected workflow job matches.`);
    }
  }
}

function extractWorkflowJobNames(files) {
  return files.flatMap((file) => extractJobNames(readFileSync(file, "utf8")));
}

function extractJobNames(workflow) {
  return [...workflow.matchAll(/^ {4}name:\s+(.+)$/gm)].map((match) => unquoteYamlScalar(match[1]));
}

function unquoteYamlScalar(value) {
  return value.trim().replace(/^["'](.*)["']$/, "$1");
}

function workflowJobNameMatchesContext(jobName, context) {
  if (jobName === context) {
    return true;
  }

  const token = "${{ matrix.node_major }}";
  if (!jobName.includes(token)) {
    return false;
  }

  const [prefix, suffix] = jobName.split(token);
  const matrixValue = context.slice(prefix.length, context.length - suffix.length);
  return context.startsWith(prefix) && context.endsWith(suffix) && matrixValue.length > 0;
}

function findRule(path, ruleset, type) {
  const rule = ruleset.rules.find((candidate) => candidate.type === type);
  if (!rule) {
    throw new Error(`${path} is missing required ${type} rule.`);
  }
  return rule;
}

function assertEqual(path, field, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${path} ${field} must be ${JSON.stringify(expected)}.`);
  }
}

function assertArrayEqual(path, field, actual, expected) {
  if (!Array.isArray(actual)) {
    throw new Error(`${path} ${field} must be an array.`);
  }

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} ${field} must be ${JSON.stringify(expected)}.`);
  }
}
