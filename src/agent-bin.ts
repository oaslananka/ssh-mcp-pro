#!/usr/bin/env node

import { runAgentCliWithReconnect } from "./remote/agent-cli.js";

try {
  await runAgentCliWithReconnect(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
