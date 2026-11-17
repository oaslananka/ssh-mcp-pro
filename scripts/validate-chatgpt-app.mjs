#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { validateAppReadiness } from "./lib/validate-app-readiness.mjs";

validateAppReadiness({
  file: "apps/chatgpt/app-readiness.json",
  displayName: "ChatGPT",
  profile: "chatgpt",
  kind: "app",
});
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const bundle = JSON.parse(readFileSync("apps/chatgpt/plugin/plugin.json", "utf8"));
const remote = JSON.parse(readFileSync("apps/chatgpt/plugin/mcp.json", "utf8"));
const endpoint = "https://ssh-mcp-pro.oaslananka.dev/mcp";
const server = remote.mcpServers?.["ssh-mcp-pro"];
if (
  bundle.name !== pkg.name ||
  bundle.version !== pkg.version ||
  bundle.extensions?.["com.openai"]?.interface?.displayName !== pkg.name ||
  !bundle.extensions?.["com.openai"]?.interface?.shortDescription ||
  bundle.extensions?.["com.openai"]?.interface?.shortDescription?.length > 30 ||
  bundle.extensions?.["com.openai"]?.interface?.supportURL !==
    "https://ssh-mcp-pro.oaslananka.dev/support" ||
  bundle.extensions?.["com.openai"]?.interface?.category !== "Developer Tools" ||
  bundle.extensions?.["com.openai"]?.review?.test_cases?.positive?.length !== 5 ||
  bundle.extensions?.["com.openai"]?.review?.test_cases?.negative?.length !== 3 ||
  bundle.extensions?.["com.openai"]?.interface?.privacyPolicyURL !==
    "https://ssh-mcp-pro.oaslananka.dev/privacy" ||
  server?.url !== endpoint ||
  server?.type !== "streamable-http" ||
  server?.extensions?.["com.openai"]?.auth?.client?.mode !== "dcr" ||
  server?.extensions?.["com.openai"]?.auth?.type !== "oauth" ||
  JSON.stringify(server?.extensions?.["com.openai"]?.auth?.defaultScopes) !==
    JSON.stringify(["hosts:read", "agents:read", "status:read"]) ||
  !existsSync("apps/chatgpt/plugin/assets/icon-512.png")
) {
  throw new Error("Portable ChatGPT plugin identity, OAuth, or assets are not aligned.");
}
if (JSON.stringify(bundle).toLowerCase().includes("sshautomator")) {
  throw new Error("Portable plugin must not advertise the legacy brand.");
}

console.log("validate-chatgpt-app: readiness metadata is consistent.");
