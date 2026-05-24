#!/usr/bin/env node

/**
 * SSH MCP Server - Entry Point
 *
 * A Model Context Protocol (MCP) server that provides SSH automation tools
 * for MCP-capable clients. Supports secure session management, remote command
 * execution, file operations, transfers, tunnels, and system administration.
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "./cli.js";
import { createContainer, type AppContainer } from "./container.js";
import { SERVER_VERSION, SSHMCPServer } from "./mcp.js";
import { logger } from "./logging.js";
import { initTelemetry, shutdownTelemetry } from "./telemetry.js";

function getPackageInfo() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    return JSON.parse(raw) as { version?: string; name?: string };
  } catch {
    return {};
  }
}

function printHelp() {
  const pkg = getPackageInfo();
  const name = pkg.name ?? "ssh-mcp-pro";
  const version = pkg.version ? `v${pkg.version}` : "";
  const help = [
    `${name} ${version}`.trim(),
    "",
    "Usage:",
    "  ssh-mcp-pro             Start MCP server over stdio (default)",
    "  ssh-mcp-pro stdio       Start MCP server over stdio",
    "  ssh-mcp-pro http        Start Streamable HTTP server",
    "  ssh-mcp-pro --transport=http Start Streamable HTTP server",
    "  ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>",
    "  ssh-mcp-pro-agent run        Run the no-custody outbound agent",
    "  ssh-mcp-pro-agent status     Show local agent enrollment status",
    "  ssh-mcp-pro --help      Show this help",
    "  ssh-mcp-pro --version   Show version",
    "  ssh-mcp-pro --stdio     Force stdio mode (default)",
    "  ssh-mcp-pro --transport=http --host 127.0.0.1 --port 3000",
    "  ssh-mcp-pro --transport=http --bearer-token-file /path/token --enable-legacy-sse",
    "  ssh-mcp-pro --transport=http --tool-profile remote-safe",
    "  ssh-mcp-pro --transport=http --connector-credential-provider agent",
    "",
    "Examples:",
    "  Run as MCP stdio server: ssh-mcp-pro",
    "  Enroll remote agent: npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>",
    "  Run remote agent: npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run",
    "  Claude/VS Code config snippet:",
    '    { "servers": { "ssh-mcp": { "type": "stdio", "command": "ssh-mcp-pro", "args": [] }}}',
    "  Debug: MCP_STDIO=1 ssh-mcp-pro",
    "",
  ].join("\n");
  process.stdout.write(help);
}

function printVersion() {
  const pkg = getPackageInfo();
  process.stdout.write(`${pkg.version ?? "0.0.0"}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts.unsupportedNoStdio) {
    process.stderr.write("Error: --no-stdio is not supported. This server only runs over stdio.\n");
    process.exit(2);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    printVersion();
    process.exit(0);
  }

  if (opts.agentArgs) {
    const { runAgentCli } = await import("./remote/agent-cli.js");
    await runAgentCli(opts.agentArgs);
    return;
  }

  if (opts.transport === "http") {
    if (opts.host) {
      process.env.SSH_MCP_HTTP_HOST = opts.host;
    }
    if (opts.port) {
      process.env.SSH_MCP_HTTP_PORT = opts.port;
    }
    if (opts.bearerTokenFile) {
      process.env.SSH_MCP_HTTP_BEARER_TOKEN_FILE = opts.bearerTokenFile;
    }
    if (opts.enableLegacySse) {
      process.env.SSH_MCP_ENABLE_LEGACY_SSE = "true";
    }
    if (opts.toolProfile) {
      process.env.SSH_MCP_TOOL_PROFILE = opts.toolProfile;
    }
    if (opts.connectorCredentialProvider) {
      process.env.SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER = opts.connectorCredentialProvider;
    }
    await import("./server-http.js");
    return;
  }

  try {
    logger.info("Starting SSH MCP Server...");

    container = createContainer();
    initTelemetry({
      serviceVersion: SERVER_VERSION,
    });
    const server = new SSHMCPServer(container);
    await server.run();

    // Gentle warning if a human types into the terminal
    let warned = false;
    process.stdin.on("data", (chunk: Buffer) => {
      const trimmed = chunk.toString().trimStart();
      if (!warned && trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        process.stderr.write(
          "This is an MCP stdio server. Do not type commands here. Use an MCP client or run --help.\n",
        );
        warned = true;
      }
    });

    // Check if running in daemon mode (for testing)
    if (process.env.SSH_MCP_DAEMON === "true") {
      logger.info("Running in daemon mode - will not wait for stdin");
      // Keep alive but don't block on stdin
      setInterval(() => {}, 1000);
    } else if (process.env.SSH_MCP_ONESHOT === "true") {
      logger.info("Running in one-shot mode - will exit after processing");
      // Process stdin once and exit with timeout
      const timeout = setTimeout(() => {
        logger.info("One-shot mode timeout, exiting");
        process.exit(0);
      }, 2000);

      process.stdin.once("data", () => {
        clearTimeout(timeout);
        setTimeout(() => process.exit(0), 100);
      });
      process.stdin.resume();
    } else {
      // Keep the process running for MCP stdio communication
      process.stdin.resume();
    }
  } catch (error) {
    logger.error("Failed to start SSH MCP Server", { error });
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection", { reason, promise });
  process.exit(1);
});

// Handle graceful shutdown
let shuttingDown = false;
let container: AppContainer | undefined;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    // Second signal = force exit immediately
    logger.info("Force exit");
    process.exit(0);
  }
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down...`);

  // Force exit after 2 seconds max
  const forceExit = setTimeout(() => {
    logger.info("Shutdown timeout, forcing exit");
    process.exit(0);
  }, 2000);

  try {
    container?.rateLimiter.destroy();
    if (container) {
      await container.sessionManager.destroy();
    }
    await shutdownTelemetry();
  } catch (error) {
    logger.error("Shutdown error", { error });
  }

  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

// Run the server
void main();
