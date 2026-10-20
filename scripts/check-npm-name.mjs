#!/usr/bin/env node
import { capture, failFromResult, printResultOutput } from "./lib/command.mjs";

const packageName = process.argv[2];
// npm package names are identifiers, never command options or free-form shell input.
function validNamePart(part) {
  if (part.length === 0) return false;
  for (let index = 0; index < part.length; index += 1) {
    const point = part.charCodeAt(index);
    const letter = point >= 97 && point <= 122;
    const digit = point >= 48 && point <= 57;
    const punctuation = point === 45 || point === 46 || point === 95 || point === 126;
    if (!letter && !digit && !(index > 0 && punctuation)) return false;
  }
  return true;
}

function isValidPackageName(name) {
  if (typeof name !== "string" || name.length > 214) return false;
  if (name.startsWith("@")) {
    const parts = name.slice(1).split("/");
    return parts.length === 2 && parts.every(validNamePart);
  }
  return validNamePart(name);
}

if (!isValidPackageName(packageName)) {
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
