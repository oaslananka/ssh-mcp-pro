#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PUBLISHED_REGISTRY_TARGETS = new Map([
  [
    "io.github.oaslananka/ssh-mcp-pro",
    "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.oaslananka%2Fssh-mcp-pro/versions/latest",
  ],
]);
const DEFAULT_TIMEOUT_MS = 20_000;

export function resolvePublishedRegistryTarget({ serverPath = "server.json" } = {}) {
  const server = JSON.parse(readFileSync(serverPath, "utf8"));
  const serverName = server?.name;

  if (typeof serverName !== "string" || serverName.length === 0) {
    throw new Error(`${serverPath} must define a non-empty string name for registry validation.`);
  }

  const registryLatestUrl = PUBLISHED_REGISTRY_TARGETS.get(serverName);
  if (!registryLatestUrl) {
    throw new Error(`${serverPath} name ${serverName} is not mapped to a published registry URL.`);
  }

  return { serverName, registryLatestUrl };
}

export function assertExpectedRegistryServerName(options = {}) {
  resolvePublishedRegistryTarget(options);
}

function isRegistryUnavailableError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "TimeoutError";
}

function formatError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export async function checkPublishedRegistryRecord({
  fetchImpl = globalThis.fetch,
  logger = console,
  serverPath = "server.json",
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const { serverName, registryLatestUrl } = resolvePublishedRegistryTarget({ serverPath });

  let response;
  try {
    response = await fetchImpl(registryLatestUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isRegistryUnavailableError(error)) {
      logger.warn(
        `MCP Registry latest lookup unavailable for ${serverName}: ${formatError(
          error,
        )}. Local metadata validation already passed; skipping published record check.`,
      );

      return { status: "unavailable", serverName, url: registryLatestUrl };
    }

    throw error;
  }

  if (response.status === 404) {
    logger.log(`No published registry record exists yet for ${serverName}.`);
    return { status: "missing", serverName, url: registryLatestUrl };
  }

  if (!response.ok) {
    throw new Error(`Registry latest lookup failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const publishedName = body?.server?.name ?? body?.name;
  if (publishedName && publishedName !== serverName) {
    throw new Error(`Registry latest returned ${publishedName}, expected ${serverName}`);
  }

  logger.log(`Registry latest record is reachable for ${serverName}.`);
  return { status: "reachable", serverName, url: registryLatestUrl };
}

async function main() {
  await checkPublishedRegistryRecord();
}

const invokedScriptUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (import.meta.url === invokedScriptUrl) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
