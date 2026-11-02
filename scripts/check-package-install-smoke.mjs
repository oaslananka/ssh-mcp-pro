#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parsePnpmPackOutput } from "./pack-json.mjs";
import { capture, failFromResult, printResultOutput } from "./lib/command.mjs";

function run(command, args, cwd, { printSuccess = false } = {}) {
  const result = capture(command, args, {
    cwd,
  });
  if (result.status !== 0) {
    failFromResult(result, command);
  }
  if (printSuccess) {
    printResultOutput(result);
  }
  return result.stdout;
}

async function verifyPackedStdioMcp(workspace) {
  for (const mode of ["auto", "legacy"]) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(workspace, "node_modules/ssh-mcp-pro/dist/index.js")],
      cwd: workspace,
    });
    const client = new Client(
      { name: "ssh-mcp-pro-package-smoke", version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    try {
      await client.connect(transport);
      const expectedEra = mode === "auto" ? "modern" : "legacy";
      if (client.getProtocolEra() !== expectedEra) {
        throw new Error("Packed MCP stdio negotiated an unexpected protocol era");
      }
      const { tools } = await client.listTools();
      if (!tools.some((tool) => tool.name === "connector_status")) {
        throw new Error("Packed MCP stdio did not expose connector_status");
      }
      const status = await client.callTool({ name: "connector_status", arguments: {} });
      if (status.isError === true || !status.structuredContent) {
        throw new Error("Packed MCP stdio connector_status failed");
      }
      console.log("check-package-install-smoke: " + expectedEra + " stdio MCP client passed.");
    } finally {
      await client.close();
    }
  }
}

const workspace = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-install-smoke-"));
try {
  const packOutput = run(
    "pnpm",
    ["pack", "--pack-destination", workspace, "--json"],
    process.cwd(),
  );
  const packed = parsePnpmPackOutput(packOutput);
  const tarball = isAbsolute(packed.filename) ? packed.filename : join(workspace, packed.filename);

  writeFileSync(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "ssh-mcp-pro-install-smoke", version: "0.0.0", private: true }, null, 2)}\n`,
  );
  const workspaceYaml = join(process.cwd(), "pnpm-workspace.yaml");
  if (existsSync(workspaceYaml)) {
    copyFileSync(workspaceYaml, join(workspace, "pnpm-workspace.yaml"));
    const patchDirectory = join(process.cwd(), "patches");
    if (existsSync(patchDirectory)) {
      cpSync(patchDirectory, join(workspace, "patches"), { recursive: true });
    }
  }
  // A packed consumer does not install workspace-only development patches.
  run("pnpm", ["add", tarball, "--config.allow-unused-patches=true"], workspace);
  run("node", ["node_modules/ssh-mcp-pro/dist/index.js", "--version"], workspace);
  await verifyPackedStdioMcp(workspace);

  console.log("check-package-install-smoke: package installs and CLI starts.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
