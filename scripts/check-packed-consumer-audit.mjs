#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parsePnpmPackOutput } from "./pack-json.mjs";
import { capture, failFromResult, printResultOutput } from "./lib/command.mjs";

const exceptionsPath = new URL(
  "../docs/security/dependency-audit-exceptions.json",
  import.meta.url,
);
const config = JSON.parse(readFileSync(exceptionsPath, "utf8"));
const workspace = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-packed-audit-"));

function run(command, args, cwd) {
  const result = capture(command, args, { cwd });
  if (result.status !== 0) {
    failFromResult(result, command);
  }
  return result.stdout;
}

function advisoryId(url) {
  const match = /\/(GHSA-[a-z0-9-]+)$/iu.exec(url ?? "");
  return match?.[1]?.toUpperCase() ?? null;
}

function readAdvisories(report) {
  const advisories = new Map();
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (!via || typeof via !== "object") {
        continue;
      }
      const id = advisoryId(via.url);
      if (!id) {
        continue;
      }
      advisories.set(`${packageName}:${id}`, {
        id,
        package: packageName,
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return [...advisories.values()];
}

function validateException(exception, now) {
  const requiredStrings = [
    "id",
    "package",
    "scope",
    "severity",
    "owner",
    "introducedOn",
    "expiresOn",
    "reason",
    "reachability",
    "removalCondition",
  ];
  for (const field of requiredStrings) {
    if (typeof exception[field] !== "string" || exception[field].trim().length === 0) {
      throw new Error(`Packed audit exception is missing ${field}`);
    }
  }
  if (exception.scope !== "packed-npm-consumer") {
    throw new Error(`Unsupported packed audit exception scope: ${exception.scope}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(exception.expiresOn)) {
    throw new Error(`Invalid packed audit exception expiry: ${exception.expiresOn}`);
  }
  const expiry = new Date(`${exception.expiresOn}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime()) || now.getTime() > expiry.getTime()) {
    throw new Error(`Packed audit exception ${exception.id} expired on ${exception.expiresOn}`);
  }
  return expiry;
}

try {
  if (config.version !== 1 || !Array.isArray(config.exceptions)) {
    throw new Error("Unsupported packed audit exception configuration");
  }

  const packOutput = run(
    "pnpm",
    ["pack", "--pack-destination", workspace, "--json"],
    process.cwd(),
  );
  const packed = parsePnpmPackOutput(packOutput);
  const tarball = isAbsolute(packed.filename) ? packed.filename : join(workspace, packed.filename);

  writeFileSync(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "ssh-mcp-pro-packed-audit", version: "0.0.0", private: true }, null, 2)}\n`,
  );
  run("npm", ["install", tarball, "--ignore-scripts", "--no-fund", "--no-audit"], workspace);

  const audit = capture("npm", ["audit", "--omit=dev", "--json"], { cwd: workspace });
  if (audit.error) {
    failFromResult(audit, "npm audit");
  }

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    printResultOutput(audit);
    throw new Error("npm audit did not return valid JSON");
  }

  const advisories = readAdvisories(report);
  const now = new Date();
  const configured = new Map();
  let nextExpiry = null;
  for (const exception of config.exceptions) {
    const expiry = validateException(exception, now);
    nextExpiry = nextExpiry === null || expiry < nextExpiry ? expiry : nextExpiry;
    configured.set(`${exception.package}:${exception.id.toUpperCase()}`, exception);
  }

  const unexpected = advisories.filter(
    (advisory) => !configured.has(`${advisory.package}:${advisory.id}`),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Packed npm consumer audit found unexpected advisories:\n${unexpected
        .map((item) => `- ${item.package} ${item.id} (${item.severity}): ${item.title}`)
        .join("\n")}`,
    );
  }

  const accepted = [];
  for (const advisory of advisories) {
    const exception = configured.get(`${advisory.package}:${advisory.id}`);
    if (exception.severity !== advisory.severity) {
      throw new Error(
        `Packed audit exception ${advisory.id} severity changed from ${exception.severity} to ${advisory.severity}`,
      );
    }
    accepted.push(advisory);
  }

  const stale = [...configured.entries()].filter(
    ([key]) => !advisories.some((item) => `${item.package}:${item.id}` === key),
  );
  if (stale.length > 0) {
    throw new Error(
      `Remove stale packed audit exception(s): ${stale.map(([, item]) => item.id).join(", ")}`,
    );
  }

  if (audit.status === 0 && accepted.length > 0) {
    throw new Error("npm audit passed but packed audit exceptions are still configured");
  }
  if (audit.status !== 0 && accepted.length === 0) {
    printResultOutput(audit);
    throw new Error("npm audit failed without a recognized advisory");
  }

  const suffix = nextExpiry ? `; next expiry ${nextExpiry.toISOString().slice(0, 10)}` : "";
  console.log(
    `check-packed-consumer-audit: accepted ${accepted.length} time-bounded advisory exception(s)${suffix}.`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
