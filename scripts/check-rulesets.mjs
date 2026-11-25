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
  "Unit Tests (Node 26)",
  "Unit Tests (Node 24)",
  "SSH Integration",
  "Windows Command-Path Integration",
  "SSH E2E",
  "Build, SBOM, and Pack",
  "Build and smoke image",
  "Validate MCP Registry metadata",
  "Secret scan (full history)",
  "Dependency Review",
  "SonarCloud Code Analysis",
  "Codacy Static Code Analysis",
];
const externalStatusContexts = new Set(["SonarCloud Code Analysis", "Codacy Static Code Analysis"]);
const protectedWorkflowFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/docker.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/mcp-registry.yml",
  ".github/workflows/gitleaks.yml",
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
  assertEqual(path, "name", ruleset.name, "main-standard");
  assertEqual(path, "target", ruleset.target, "branch");
  assertEqual(path, "enforcement", ruleset.enforcement, "active");
  assertArrayEqual(path, "bypass_actors", ruleset.bypass_actors, [
    { actor_id: 285490571, actor_type: "User", bypass_mode: "pull_request" },
  ]);
  assertArrayEqual(path, "conditions.ref_name.include", ruleset.conditions?.ref_name?.include, [
    "~DEFAULT_BRANCH",
  ]);
  assertArrayEqual(path, "conditions.ref_name.exclude", ruleset.conditions?.ref_name?.exclude, []);

  const ruleTypes = new Set(ruleset.rules.map((rule) => rule.type));
  for (const type of requiredMainProtectionRules) {
    if (!ruleTypes.has(type)) {
      throw new Error(`${path} is missing required ${type} rule.`);
    }
  }

  const pullRequestRule = findRule(path, ruleset, "pull_request");
  assertArrayEqual(
    path,
    "pull_request.parameters.allowed_merge_methods",
    pullRequestRule.parameters?.allowed_merge_methods,
    ["squash"],
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
    0,
  );

  assertEqual(
    path,
    "pull_request.parameters.dismiss_stale_reviews_on_push",
    pullRequestRule.parameters?.dismiss_stale_reviews_on_push,
    false,
  );
  assertEqual(
    path,
    "pull_request.parameters.require_code_owner_review",
    pullRequestRule.parameters?.require_code_owner_review,
    false,
  );
  assertEqual(
    path,
    "pull_request.parameters.require_last_push_approval",
    pullRequestRule.parameters?.require_last_push_approval,
    false,
  );
  assertEqual(
    path,
    "pull_request.parameters.require_extra_approval_for_unattributed_changes",
    pullRequestRule.parameters?.require_extra_approval_for_unattributed_changes,
    true,
  );
  assertArrayEqual(
    path,
    "pull_request.parameters.required_reviewers",
    pullRequestRule.parameters?.required_reviewers,
    [],
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
  const codacy = statusRule.parameters.required_status_checks.find(
    (check) => check.context === "Codacy Static Code Analysis",
  );
  assertEqual(path, "Codacy integration_id", codacy?.integration_id, 56611);
  validateContextsMatchWorkflowJobs(path, contexts, workflowJobNames);
}

function validateContextsMatchWorkflowJobs(path, contexts, workflowJobNames) {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const nodeMajors = [...ci.matchAll(/^\s+node_major: (\d+)$/gmu)].map((match) => match[1]);
  for (const context of contexts) {
    if (externalStatusContexts.has(context)) continue;
    if (
      !workflowJobNames.some((jobName) =>
        workflowJobNameMatchesContext(jobName, context, nodeMajors),
      )
    ) {
      throw new Error(`${path} references ${context}, but no protected workflow job matches.`);
    }
  }
}

function extractWorkflowJobNames(files) {
  return files.flatMap((file) => extractJobNames(readFileSync(file, "utf8")));
}

function extractJobNames(workflow) {
  const names = [];
  let inJobs = false;
  let currentJob;

  for (const line of workflow.split("\n")) {
    if (!inJobs) {
      inJobs = line === "jobs:";
      continue;
    }

    const jobId = jobIdFromLine(line);
    if (jobId) {
      appendResolvedJobName(names, currentJob);
      currentJob = { id: jobId, name: undefined };
      continue;
    }

    const jobName = jobNameFromLine(line);
    if (currentJob && !currentJob.name && jobName) {
      currentJob.name = jobName;
    }
  }

  appendResolvedJobName(names, currentJob);
  return names;
}

function appendResolvedJobName(names, job) {
  if (job) {
    names.push(job.name ?? job.id);
  }
}

function jobIdFromLine(line) {
  if (!line.startsWith("  ") || line.startsWith("    ")) {
    return undefined;
  }
  const separator = line.indexOf(":", 2);
  if (separator < 3) {
    return undefined;
  }
  const id = line.slice(2, separator);
  return /^[a-zA-Z0-9_-]+$/u.test(id) ? id : undefined;
}

function jobNameFromLine(line) {
  const prefix = "    name:";
  if (!line.startsWith(prefix)) {
    return undefined;
  }
  const value = line.slice(prefix.length).trim();
  return value ? unquoteYamlScalar(value) : undefined;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  const isQuoted =
    trimmed.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"));
  return isQuoted ? trimmed.slice(1, -1) : trimmed;
}

function workflowJobNameMatchesContext(jobName, context, nodeMajors) {
  if (jobName === context) {
    return true;
  }

  const token = "${{ matrix.node_major }}";
  if (!jobName.includes(token)) {
    return false;
  }

  const [prefix, suffix] = jobName.split(token);
  const matrixValue = context.slice(prefix.length, context.length - suffix.length);
  return context.startsWith(prefix) && context.endsWith(suffix) && nodeMajors.includes(matrixValue);
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
    throw new TypeError(`${path} ${field} must be an array.`);
  }

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} ${field} must be ${JSON.stringify(expected)}.`);
  }
}
