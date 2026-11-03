#!/usr/bin/env node
import { validateAppReadiness } from "./lib/validate-app-readiness.mjs";

validateAppReadiness({
  file: "apps/claude/connector-readiness.json",
  displayName: "Claude",
  profile: "claude",
  kind: "connector",
});
console.log("validate-claude-connector: readiness metadata is consistent.");
