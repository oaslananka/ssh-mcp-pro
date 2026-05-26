#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const NODE_SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu;
const USER_AGENT = "ssh-mcp-pro-dependency-freshness";

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

export function parsePackageManager(value) {
  const match = /^(?<name>[^@]+)@(?<version>\d+\.\d+\.\d+)/u.exec(value ?? "");
  if (!match?.groups) {
    throw new Error(`Unsupported packageManager value: ${value}`);
  }
  return { name: match.groups.name, version: match.groups.version };
}

export function parseNodeEngineFloors(range) {
  return [...range.matchAll(/\^?(\d+\.\d+\.\d+)/gu)].map((match) => {
    const version = match[1];
    return { major: parseVersion(version)[0], version };
  });
}

export function parseRootImporterVersions(lockText) {
  const versions = new Map();
  let inRootImporter = false;
  let group;
  let packageName;

  for (const line of lockText.split(/\r?\n/u)) {
    if (line === "  .:") {
      inRootImporter = true;
      continue;
    }
    if (inRootImporter && line.startsWith("  ") && !line.startsWith("    ")) {
      break;
    }
    const groupMatch = /^    (dependencies|devDependencies):$/u.exec(line);
    if (inRootImporter && groupMatch) {
      group = groupMatch[1];
      packageName = undefined;
      continue;
    }
    const packageMatch = /^      (?:"([^"]+)"|([^:]+)):$/u.exec(line);
    if (inRootImporter && group && packageMatch) {
      packageName = packageMatch[1] ?? packageMatch[2];
      continue;
    }
    const versionMatch = /^        version: (.+)$/u.exec(line);
    if (inRootImporter && group && packageName && versionMatch) {
      versions.set(packageName, stripLockVersion(versionMatch[1]));
    }
  }
  return versions;
}

export function statusForPackage(current, latest, deprecated) {
  if (deprecated) {
    return { status: "fail", note: `current version is deprecated: ${deprecated}` };
  }
  if (latest && compareVersions(current, latest) < 0) {
    return { status: "advisory", note: `newer latest version ${latest} is available` };
  }
  return { status: "pass", note: "current locked version matches or exceeds latest tag" };
}

export function lifecycleForNode(schedule, today) {
  if (!schedule?.end) {
    return { phase: "unknown", eol: undefined, status: "fail" };
  }
  if (schedule.end < today) {
    return { phase: "eol", eol: schedule.end, status: "fail" };
  }
  if (schedule.maintenance && schedule.maintenance <= today) {
    return { phase: "maintenance", eol: schedule.end, status: "pass" };
  }
  if (schedule.lts && schedule.lts <= today) {
    return { phase: "lts", eol: schedule.end, status: "pass" };
  }
  return { phase: "current", eol: schedule.end, status: "pass" };
}

export function markdownReport(report) {
  return [
    "# Dependency Freshness Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Failures: ${report.summary.failures}`,
    `- Advisories: ${report.summary.advisories}`,
    `- Policy: ${report.policy}`,
    "",
    "## Runtime And Tools",
    "",
    "| Component | Current | Latest | Status | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...report.runtime.map(runtimeRow),
    "",
    "## Direct Packages",
    "",
    "| Package | Type | Specifier | Locked | Latest | Status | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.packages.map(packageRow),
    "",
    "## Sources",
    "",
    ...report.sources.map((source) => `- ${source}`),
    "",
  ].join("\n");
}

export async function buildReport(options = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const lockVersions = parseRootImporterVersions(await readFile("pnpm-lock.yaml", "utf8"));
  const [nodeIndex, nodeSchedule] = await Promise.all([
    fetchJson(NODE_INDEX_URL),
    fetchJson(NODE_SCHEDULE_URL),
  ]);
  const runtime = await runtimeEntries(packageJson, nodeIndex, nodeSchedule, today);
  const packages = await packageEntries(packageJson, lockVersions);
  return assembleReport(runtime, packages);
}

async function runtimeEntries(packageJson, nodeIndex, nodeSchedule, today) {
  const entries = nodeRuntimeEntries(packageJson, nodeIndex, nodeSchedule, today);
  const packageManager = parsePackageManager(packageJson.packageManager);
  entries.push(await packageManagerEntry(packageManager));
  entries.push(...(await localToolchainEntries(nodeIndex, nodeSchedule, today)));
  return entries;
}

function nodeRuntimeEntries(packageJson, nodeIndex, nodeSchedule, today) {
  return parseNodeEngineFloors(packageJson.engines.node).map(({ major, version }) => {
    const latest = latestNodeForMajor(nodeIndex, major);
    const lifecycle = lifecycleForNode(nodeSchedule[`v${major}`], today);
    const newer = latest && compareVersions(version, latest) < 0;
    return {
      component: `node ${major} engine floor`,
      current: version,
      latest,
      status: lifecycle.status === "fail" ? "fail" : newer ? "advisory" : "pass",
      note: nodeNote(lifecycle, newer),
    };
  });
}

async function packageManagerEntry(packageManager) {
  const packument = await fetchPackument(packageManager.name);
  const latest = packument["dist-tags"]?.latest;
  const deprecated = packument.versions?.[packageManager.version]?.deprecated;
  const result = statusForPackage(packageManager.version, latest, deprecated);
  const releaseNotesUrl = githubReleaseNotesUrl(packument, latest);
  return {
    component: packageManager.name,
    current: packageManager.version,
    latest,
    status: result.status,
    note: appendReleaseNotes(result.note, releaseNotesUrl, result.status),
  };
}

async function localToolchainEntries(nodeIndex, nodeSchedule, today) {
  const files = [".node-version", ".nvmrc"];
  const entries = [];
  for (const file of files) {
    const version = (await readFile(file, "utf8")).trim();
    const major = parseVersion(version)[0];
    const latest = latestNodeForMajor(nodeIndex, major);
    const lifecycle = lifecycleForNode(nodeSchedule[`v${major}`], today);
    const newer = latest && compareVersions(version, latest) < 0;
    entries.push({
      component: file,
      current: version,
      latest,
      status: lifecycle.status === "fail" ? "fail" : newer ? "advisory" : "pass",
      note: nodeNote(lifecycle, newer),
    });
  }
  return entries;
}

async function packageEntries(packageJson, lockVersions) {
  const direct = directDependencies(packageJson);
  return Promise.all(
    direct.map(async ({ name, type, specifier }) => {
      const current = lockVersions.get(name);
      const packument = await fetchPackument(name);
      return packageFreshnessEntry(name, type, specifier, current, packument);
    }),
  );
}

function directDependencies(packageJson) {
  const dependencyEntries = Object.entries(packageJson.dependencies ?? {}).map(
    toDependency("runtime"),
  );
  const devDependencyEntries = Object.entries(packageJson.devDependencies ?? {}).map(
    toDependency("dev"),
  );
  return [...dependencyEntries, ...devDependencyEntries].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function toDependency(type) {
  return ([name, specifier]) => ({ name, type, specifier });
}

function packageFreshnessEntry(name, type, specifier, current, packument) {
  if (!current) {
    return {
      name,
      type,
      specifier,
      current: "missing",
      latest: packument["dist-tags"]?.latest,
      status: "fail",
      note: "direct dependency is missing from pnpm-lock.yaml",
    };
  }
  const latest = packument["dist-tags"]?.latest;
  const deprecated = packument.versions?.[current]?.deprecated;
  const result = statusForPackage(current, latest, deprecated);
  const releaseNotesUrl = githubReleaseNotesUrl(packument, latest);
  return {
    name,
    type,
    specifier,
    current,
    latest,
    status: result.status,
    note: appendReleaseNotes(result.note, releaseNotesUrl, result.status),
  };
}

function assembleReport(runtime, packages) {
  const generatedAt = new Date().toISOString();
  const allEntries = [...runtime, ...packages];
  const summary = {
    failures: allEntries.filter((entry) => entry.status === "fail").length,
    advisories: allEntries.filter((entry) => entry.status === "advisory").length,
  };
  return {
    generatedAt,
    policy:
      "Fail on EOL/unsupported Node lines, deprecated direct packages, or missing lockfile pins. Newer upstream versions are advisory.",
    summary,
    runtime,
    packages,
    sources: [NODE_INDEX_URL, NODE_SCHEDULE_URL, `${NPM_REGISTRY_URL}/<package>`],
  };
}

function latestNodeForMajor(nodeIndex, major) {
  const versions = nodeIndex
    .map((entry) => entry.version.replace(/^v/u, ""))
    .filter((version) => parseVersion(version)[0] === major)
    .filter((version) => !version.includes("-"));
  return versions.sort(compareVersions).at(-1);
}

function nodeNote(lifecycle, newer) {
  const parts = [`lifecycle=${lifecycle.phase}`, `eol=${lifecycle.eol ?? "unknown"}`];
  if (newer) {
    parts.push("newer patch/minor available");
  }
  return parts.join("; ");
}

function runtimeRow(entry) {
  return [entry.component, entry.current, entry.latest ?? "unknown", entry.status, entry.note]
    .map(escapeMarkdown)
    .join(" | ")
    .replace(/^/u, "| ")
    .concat(" |");
}

function packageRow(entry) {
  return [
    entry.name,
    entry.type,
    entry.specifier,
    entry.current,
    entry.latest ?? "unknown",
    entry.status,
    entry.note,
  ]
    .map(escapeMarkdown)
    .join(" | ")
    .replace(/^/u, "| ")
    .concat(" |");
}

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) {
    throw new Error(`Unsupported version string: ${version}`);
  }
  return match.slice(1, 4).map((part) => Number.parseInt(part, 10));
}

function stripLockVersion(version) {
  return version.trim().replace(/^"|"$/gu, "").replace(/\(.+$/u, "");
}

function escapeMarkdown(value) {
  return String(value).replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}

function appendReleaseNotes(note, releaseNotesUrl, status) {
  if (!releaseNotesUrl || status !== "advisory") {
    return note;
  }
  return `${note}; release notes: ${releaseNotesUrl}`;
}

function githubReleaseNotesUrl(packument, version) {
  const metadata = packument.versions?.[version] ?? packument;
  const repository = metadata.repository ?? packument.repository;
  const repositoryUrl = typeof repository === "string" ? repository : repository?.url;
  const normalized = normalizeGitHubRepository(repositoryUrl);
  return normalized ? `https://github.com/${normalized}/releases` : undefined;
}

function normalizeGitHubRepository(repositoryUrl) {
  const match = /github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/#\s]+?)(?:\.git)?(?:[#/]|$)/u.exec(
    repositoryUrl ?? "",
  );
  if (!match?.groups) {
    return undefined;
  }
  return `${match.groups.owner}/${match.groups.repo}`;
}

async function fetchPackument(packageName) {
  return fetchJson(registryPackageUrl(packageName));
}

function registryPackageUrl(packageName) {
  assertNpmPackageName(packageName);
  const url = new URL(NPM_REGISTRY_URL);
  url.pathname = encodeURIComponent(packageName);
  return url;
}

function assertNpmPackageName(packageName) {
  if (!NPM_PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new Error(`Unsupported npm package name: ${packageName}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function parseArgs(args) {
  const options = { json: "artifacts/dependency-freshness.json", markdown: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      assertOptionValue(arg, args[index + 1]);
      options.json = args[index + 1];
      index += 1;
    } else if (arg === "--markdown") {
      assertOptionValue(arg, args[index + 1]);
      options.markdown = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function assertOptionValue(option, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a file path value.`);
  }
}

async function writeOutput(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport();
  await writeOutput(options.json, `${JSON.stringify(report, null, 2)}\n`);
  if (options.markdown) {
    await writeOutput(options.markdown, markdownReport(report));
  }
  console.log(
    `dependency-freshness: ${report.summary.failures} failure(s), ${report.summary.advisories} advisory item(s).`,
  );
  if (report.summary.failures > 0) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
