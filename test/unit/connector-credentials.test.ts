import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type ServerConfig } from "../../src/config.js";
import { resolveConnectorCredentials } from "../../src/connector-credentials.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { force: true, recursive: true });
  }
  tempDirs = [];
});

describe("connector credential resolver", () => {
  test("uses SSH agent credentials with a configured default username", async () => {
    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        {
          ...DEFAULT_CONFIG,
          connector: {
            ...DEFAULT_CONFIG.connector,
            credentialProvider: "agent",
            defaultUsername: "deploy",
          },
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        host: "prod",
        policyHost: "prod",
        username: "deploy",
        auth: "agent",
        useAgent: true,
        hostKeyPolicy: "strict",
      }),
    );
  });

  test("rejects disabled and incomplete credential providers", async () => {
    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        {
          ...DEFAULT_CONFIG,
          connector: { ...DEFAULT_CONFIG.connector, credentialProvider: "none" },
        },
      ),
    ).rejects.toThrow("credential provider is not configured");

    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        {
          ...DEFAULT_CONFIG,
          connector: { ...DEFAULT_CONFIG.connector, credentialProvider: "command" },
        },
      ),
    ).rejects.toThrow("requires SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND");
  });

  test("validates command-provider output and does not require chat credentials", async () => {
    const script = writeResolverScript(
      'console.log(JSON.stringify({ host: "prod.example", username: "deploy", auth: "agent", hostKeyPolicy: "strict" }));',
    );

    await expect(
      resolveConnectorCredentials({ hostAlias: "prod", purpose: "inspect" }, configFor(script)),
    ).resolves.toEqual(
      expect.objectContaining({
        host: "prod.example",
        policyHost: "prod",
        username: "deploy",
        auth: "agent",
        useAgent: true,
        hostKeyPolicy: "strict",
      }),
    );
  });

  test("uses command-provider key credentials and default username safely", async () => {
    const script = writeResolverScript(
      'console.log(JSON.stringify({ auth: "key", privateKeyPath: "/tmp/credential-ref", knownHostsPath: "/tmp/known-hosts", expectedHostKeySha256: "SHA256:test-fixture", port: 2222, readyTimeoutMs: 1500, ttlMs: 10000 }));',
    );

    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        configFor(script, { defaultUsername: "deploy" }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        host: "prod",
        policyHost: "prod",
        username: "deploy",
        port: 2222,
        auth: "key",
        useAgent: false,
        privateKeyPath: "/tmp/credential-ref",
        knownHostsPath: "/tmp/known-hosts",
        expectedHostKeySha256: "SHA256:test-fixture",
        readyTimeoutMs: 1500,
        ttlMs: 10000,
      }),
    );
  });

  test("rejects credential command output that includes forbidden secret fields", async () => {
    const script = writeResolverScript(
      'console.log(JSON.stringify({ host: "prod.example", username: "deploy", password: "super-secret" }));',
    );

    await expect(
      resolveConnectorCredentials({ hostAlias: "prod", purpose: "inspect" }, configFor(script)),
    ).rejects.toThrow("Unrecognized key");
  });

  test("enforces credential command timeout", async () => {
    const script = writeResolverScript("setTimeout(() => {}, 5000);");

    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        configFor(script, { credentialCommandTimeoutMs: 50 }),
      ),
    ).rejects.toThrow("timed out");
  });

  test("rejects failed, oversized, and incomplete credential command output", async () => {
    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        configFor(writeResolverScript("process.exit(1);")),
      ),
    ).rejects.toThrow("Credential command failed");

    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        configFor(writeResolverScript('process.stdout.write("x".repeat(33 * 1024));')),
      ),
    ).rejects.toThrow("exceeded 32 KiB");

    await expect(
      resolveConnectorCredentials(
        { hostAlias: "prod", purpose: "inspect" },
        configFor(
          writeResolverScript('console.log(JSON.stringify({ auth: "key", username: "deploy" }));'),
        ),
      ),
    ).rejects.toThrow("auth=key requires privateKeyPath");
  });
});

function writeResolverScript(source: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-credentials-"));
  tempDirs.push(tempDir);
  const scriptPath = join(tempDir, "resolver.mjs");
  writeFileSync(scriptPath, source);
  return scriptPath;
}

function configFor(
  scriptPath: string,
  connectorOverrides: Partial<ServerConfig["connector"]> = {},
): ServerConfig {
  return {
    ...DEFAULT_CONFIG,
    connector: {
      ...DEFAULT_CONFIG.connector,
      credentialProvider: "command",
      credentialCommand: process.execPath,
      credentialCommandArgs: [scriptPath],
      credentialCommandTimeoutMs: 10_000,
      ...connectorOverrides,
    },
  };
}
