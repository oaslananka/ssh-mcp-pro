#!/usr/bin/env node

import { runAgentCli } from "./remote/agent-cli.js";

runAgentCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
