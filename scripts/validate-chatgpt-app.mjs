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
const reviewDraft = JSON.parse(readFileSync("apps/chatgpt/review-test-cases.json", "utf8"));
const reviewCases = bundle.extensions?.["com.openai"]?.review?.test_cases;
const hostedReadTools = new Set(["list_hosts", "list_agents", "get_system_status"]);
const expectedPositive = reviewDraft.positive.map(
  ({ description, prompt, tools_triggered, expected_behavior }) => ({
    description,
    prompt,
    tools_triggered: tools_triggered.join(", "),
    expected_behavior,
  }),
);
const expectedNegative = reviewDraft.negative.map(({ description, prompt }) => ({
  description,
  prompt,
}));
if (
  !reviewDraft.positive.every(
    (entry) =>
      entry.tools_triggered.length > 0 &&
      entry.tools_triggered.every((name) => hostedReadTools.has(name)),
  ) ||
  JSON.stringify(reviewCases?.positive) !== JSON.stringify(expectedPositive) ||
  JSON.stringify(reviewCases?.negative) !== JSON.stringify(expectedNegative)
) {
  throw new Error(
    "OpenAI review scenarios must match hosted read-only MCP tools and ZIP manifest.",
  );
}

if (
  bundle.name !== pkg.name ||
  bundle.version !== pkg.version ||
  bundle.extensions?.["com.openai"]?.interface?.displayName !== "SSH Device Inspector" ||
  bundle.extensions?.["com.openai"]?.interface?.displayName?.length > 30 ||
  /\bmcp\b/iu.test(bundle.extensions?.["com.openai"]?.interface?.displayName ?? "") ||
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
