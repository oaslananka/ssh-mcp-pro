#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { validateAppReadiness } from "./lib/validate-app-readiness.mjs";

validateAppReadiness({
  file: "apps/google/gemini-app-readiness.json",
  displayName: "Gemini",
  profile: "gemini",
  kind: "connector",
});

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!existsSync("gemini-extension.json")) {
  throw new Error("gemini-extension.json must exist for Gemini CLI extension support.");
}

const geminiExt = JSON.parse(readFileSync("gemini-extension.json", "utf8"));
if (geminiExt.name !== pkg.name) {
  throw new Error(
    `gemini-extension.json name '${geminiExt.name}' must match package.json name '${pkg.name}'.`,
  );
}
if (geminiExt.version !== pkg.version) {
  throw new Error(
    `gemini-extension.json version '${geminiExt.version}' must match package.json version '${pkg.version}'.`,
  );
}
if (!geminiExt.mcpServers?.["ssh-mcp-pro"]) {
  throw new Error("gemini-extension.json must define mcpServers['ssh-mcp-pro'].");
}

console.log("validate-google-app: readiness metadata and gemini-extension are consistent.");
