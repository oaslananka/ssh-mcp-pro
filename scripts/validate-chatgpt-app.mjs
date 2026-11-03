#!/usr/bin/env node
import { validateAppReadiness } from "./lib/validate-app-readiness.mjs";

validateAppReadiness({
  file: "apps/chatgpt/app-readiness.json",
  displayName: "ChatGPT",
  profile: "chatgpt",
  kind: "app",
});
console.log("validate-chatgpt-app: readiness metadata is consistent.");
