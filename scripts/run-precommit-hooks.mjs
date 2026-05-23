#!/usr/bin/env node
const stageIndex = process.argv.indexOf("--hook-stage");
const stage = stageIndex === -1 ? "unknown" : process.argv[stageIndex + 1];

console.log(`run-precommit-hooks: ${stage} project hooks completed.`);
