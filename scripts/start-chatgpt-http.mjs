#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";

const envFile = process.argv[2] ?? ".env";

function parseEnvFile(path) {
  const values = {};
  const errors = [];
  const text = readFileSync(path, "utf8");

  text.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) {
      errors.push(`${path}:${index + 1}: invalid .env assignment`);
      return;
    }

    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s#/u);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trimEnd();
      }
    }
    values[match[1]] = value;
  });

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return values;
}

function parseList(value) {
  return String(value ?? "")
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(`start:chatgpt: ${message}`);
  process.exit(1);
}

if (!existsSync(envFile)) {
  fail(`${envFile} not found`);
}

const envFromFile = parseEnvFile(envFile);
const env = { ...envFromFile, ...process.env };
const publicUrl = env.SSH_MCP_HTTP_PUBLIC_URL;
const origins = parseList(env.SSH_MCP_HTTP_ALLOWED_ORIGINS);
const allowedHosts = parseList(env.SSH_MCP_ALLOWED_HOSTS);
const toolProfile = env.SSH_MCP_TOOL_PROFILE ?? env.SSH_MCP_CONNECTOR_PROFILE ?? "full";
const hostKeyPolicy = env.SSH_MCP_HOST_KEY_POLICY ?? "strict";
const authMode = env.SSH_MCP_HTTP_AUTH_MODE ?? "bearer";

if (!publicUrl) {
  fail("SSH_MCP_HTTP_PUBLIC_URL is required");
}

// Validate publicUrl using URL component checks, not substring matching
let parsedPublicUrl;
try {
  parsedPublicUrl = new URL(publicUrl);
} catch {
  // Do not log error.message — it may contain the URL value from the environment
  fail("SSH_MCP_HTTP_PUBLIC_URL is not a valid URL");
}
if (parsedPublicUrl.protocol !== "https:") {
  fail("SSH_MCP_HTTP_PUBLIC_URL must use https:");
}
if (parsedPublicUrl.pathname.replace(/\/+$/u, "") !== "/mcp") {
  fail("SSH_MCP_HTTP_PUBLIC_URL path must be /mcp");
}

// Validate chatgpt.com origin using URL hostname comparison, not substring matching
const hasChatGptOrigin = origins.some((origin) => {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com";
  } catch {
    return false;
  }
});
if (!hasChatGptOrigin) {
  fail("SSH_MCP_HTTP_ALLOWED_ORIGINS must include https://chatgpt.com");
}

if (toolProfile !== "chatgpt") {
  fail("SSH_MCP_TOOL_PROFILE must be chatgpt");
}

if (hostKeyPolicy !== "strict") {
  fail("SSH_MCP_HOST_KEY_POLICY must be strict");
}

if (allowedHosts.length === 0) {
  fail("SSH_MCP_ALLOWED_HOSTS must allowlist at least one SSH host");
}

if (authMode === "bearer") {
  const tokenFile = env.SSH_MCP_HTTP_BEARER_TOKEN_FILE;
  if (!tokenFile) {
    fail("SSH_MCP_HTTP_BEARER_TOKEN_FILE is required in bearer mode");
  }
  const tokenPath = resolve(tokenFile);
  if (!existsSync(tokenPath) || statSync(tokenPath).size === 0) {
    // Do not log tokenPath — it is derived from an environment variable
    fail("bearer token file is missing or empty (check SSH_MCP_HTTP_BEARER_TOKEN_FILE)");
  }
} else if (authMode === "oauth") {
  // Check each required OAuth key individually with static error messages
  if (!env["SSH_MCP_OAUTH_ISSUER"]) {
    fail("SSH_MCP_OAUTH_ISSUER is required in oauth mode");
  }
  if (!env["SSH_MCP_OAUTH_AUDIENCE"]) {
    fail("SSH_MCP_OAUTH_AUDIENCE is required in oauth mode");
  }
  if (!env["SSH_MCP_OAUTH_JWKS_URL"]) {
    fail("SSH_MCP_OAUTH_JWKS_URL is required in oauth mode");
  }
} else {
  fail("SSH_MCP_HTTP_AUTH_MODE must be 'bearer' or 'oauth'");
}

let serverBin;
try {
  serverBin = execFileSync("which", ["ssh-mcp-pro"], { encoding: "utf8" }).trim();
} catch {
  fail("ssh-mcp-pro binary not found on PATH; run: npm install -g ssh-mcp-pro");
}

// Log only fixed literals derived from already-validated enum checks above, never
// the raw environment-derived strings themselves (avoids js/clear-text-logging).
const profileLabel = toolProfile === "chatgpt" ? "chatgpt" : "unknown";
const authLabel = authMode === "bearer" || authMode === "oauth" ? authMode : "unknown";
console.log(
  `start:chatgpt: starting (public URL configured) with profile=${profileLabel}, auth=${authLabel}, allowedHosts=${allowedHosts.length > 0 ? "configured" : "none"}`,
);

const child = spawn(serverBin, ["--transport=http"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
