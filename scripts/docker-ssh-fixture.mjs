#!/usr/bin/env node
import net from "node:net";
import { capture as captureCommand, executable } from "./lib/command.mjs";

const CONTAINER_NAME = "ssh-mcp-pro-test";
const SSH_HOST = "127.0.0.1";
const SSH_PORT = 2222;
const WAIT_TIMEOUT_MS = Number.parseInt(process.env.SSH_FIXTURE_TIMEOUT_MS ?? "120000", 10);
const UP_ATTEMPTS = Number.parseInt(process.env.SSH_FIXTURE_UP_ATTEMPTS ?? "3", 10);
const UP_RETRY_DELAY_MS = Number.parseInt(process.env.SSH_FIXTURE_UP_RETRY_DELAY_MS ?? "5000", 10);

function run(command, args, options = {}) {
  const result = captureCommand(executable(command), args, {
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
  });

  if (result.error) {
    console.error(`${command} failed to start: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

function capture(command, args) {
  const result = captureCommand(command, args);

  if (result.error || result.status !== 0) {
    return "";
  }

  return result.stdout.trim();
}

function compose(args, options = {}) {
  return run("docker", ["compose", ...args], options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getContainerStatus() {
  return capture("docker", [
    "inspect",
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    CONTAINER_NAME,
  ]);
}

function canConnectToSsh() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: SSH_HOST, port: SSH_PORT });
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function printFixtureLogs() {
  compose(["logs", "--no-color", "--tail", "120", "ssh-server"], { stdio: "inherit" });
}

async function waitForSshFixture() {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastStatus = "unknown";

  while (Date.now() < deadline) {
    lastStatus = getContainerStatus() || lastStatus;
    if (lastStatus === "healthy") {
      return;
    }

    if (lastStatus === "running" && (await canConnectToSsh())) {
      return;
    }

    await sleep(2000);
  }

  printFixtureLogs();
  throw new Error(
    `SSH fixture did not become ready within ${WAIT_TIMEOUT_MS}ms; status=${lastStatus}`,
  );
}

async function composeUpWithRetry() {
  const attempts = Math.max(1, UP_ATTEMPTS);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const status = compose(["up", "-d", "ssh-server"]);
    if (status === 0) {
      return 0;
    }

    if (attempt === attempts) {
      return status;
    }

    console.warn(
      `docker compose up failed with exit code ${status}; retrying in ${UP_RETRY_DELAY_MS}ms (${attempt}/${attempts})`,
    );
    down({ bestEffort: true });
    await sleep(UP_RETRY_DELAY_MS);
  }

  return 1;
}

async function up() {
  const status = await composeUpWithRetry();
  if (status !== 0) {
    process.exit(status);
  }
  await waitForSshFixture();
}

function down({ bestEffort = false } = {}) {
  const status = compose(["down", "--remove-orphans"]);
  if (status !== 0 && bestEffort) {
    console.warn(
      `docker compose down failed with exit code ${status}; continuing after test failure.`,
    );
    return 0;
  }

  return status;
}

async function runSuite(suite) {
  const testScript = suite === "e2e" ? "test:e2e" : "test:integration";
  const env = {
    ...process.env,
    RUN_SSH_E2E: suite === "e2e" ? "1" : process.env.RUN_SSH_E2E,
    RUN_SSH_INTEGRATION: suite === "integration" ? "1" : process.env.RUN_SSH_INTEGRATION,
    TEST_SSH_HOST: SSH_HOST,
    TEST_SSH_PORT: String(SSH_PORT),
    TEST_SSH_USER: "testuser",
    TEST_SSH_PASS: "testpass",
  };

  await up();
  const status = run("pnpm", ["run", testScript], { env });
  const cleanupStatus = down({ bestEffort: status !== 0 });
  process.exit(status !== 0 ? status : cleanupStatus);
}

async function main() {
  const [action, suite] = process.argv.slice(2);

  if (action === "up") {
    await up();
    return;
  }

  if (action === "down") {
    process.exit(down());
  }

  if (action === "run" && (suite === "integration" || suite === "e2e")) {
    await runSuite(suite);
    return;
  }

  console.error("Usage: docker-ssh-fixture.mjs up | down | run <integration|e2e>");
  process.exit(1);
}

await main();
