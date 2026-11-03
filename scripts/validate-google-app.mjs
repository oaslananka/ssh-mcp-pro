#!/usr/bin/env node
import { validateAppReadiness } from "./lib/validate-app-readiness.mjs";

validateAppReadiness({
  file: "apps/google/gemini-app-readiness.json",
  displayName: "Gemini",
  profile: "gemini",
  kind: "connector",
});
console.log("validate-google-app: readiness metadata is consistent.");
