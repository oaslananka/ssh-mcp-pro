#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const dependencies = Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}).map(([name, version]) => ({
  type: "library",
  name,
  version,
  purl: `pkg:npm/${encodeURIComponent(name)}@${version.replace(/^[~^]/u, "")}`,
}));

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: packageJson.name,
      version: packageJson.version,
    },
  },
  components: dependencies,
  properties: [
    {
      name: "pnpm-lock.yaml.sha256.inputLength",
      value: String(lockfile.length),
    },
  ],
};

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/sbom.cdx.json", `${JSON.stringify(sbom, null, 2)}\n`);
console.log("generate-sbom: wrote artifacts/sbom.cdx.json.");
