#!/usr/bin/env node
import { capture, failFromResult, printResultOutput } from "./lib/command.mjs";

const packageName = process.argv[2];
// npm package names are identifiers, never command options or free-form shell input.
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
if (
  typeof packageName !== "string" ||
  packageName.length === 0 ||
  packageName.length > 214 ||
  !NPM_PACKAGE_NAME.test(packageName)
) {
  throw new Error("Usage: check-npm-name.mjs <valid-package-name>");
}

const result = capture("npm", ["view", packageName, "name", "version", "--json"]);
if (result.status === 0) {
  printResultOutput(result);
  throw new Error(`npm package name is already published: ${packageName}`);
}

const combined = `${result.stdout}\n${result.stderr}`;
if (/E404|404 Not Found|Not found/u.test(combined)) {
  console.log(`check-npm-name: ${packageName} is available on npm.`);
  process.exit(0);
}

failFromResult(result, "npm view");
