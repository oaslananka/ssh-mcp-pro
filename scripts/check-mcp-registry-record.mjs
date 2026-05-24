#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io/v0.1";
const DEFAULT_SERVER_NAME = "io.github.oaslananka/ssh-mcp-pro";
const DEFAULT_TIMEOUT_MS = 20_000;

function isRegistryUnavailableError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    (error.name === "TypeError" && error.message.includes("fetch failed"))
  );
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
  serverName = DEFAULT_SERVER_NAME,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const url = `${REGISTRY_BASE_URL}/servers/${encodeURIComponent(serverName)}/versions/latest`;

  let response;
  try {
    response = await fetchImpl(url, {
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

      return { status: "unavailable", serverName, url };
    }

    throw error;
  }

  if (response.status === 404) {
    logger.log(`No published registry record exists yet for ${serverName}.`);
    return { status: "missing", serverName, url };
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
  return { status: "reachable", serverName, url };
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
