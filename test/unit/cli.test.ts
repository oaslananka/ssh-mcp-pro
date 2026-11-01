import { describe, expect, test } from "vitest";
import { applyHttpCliEnvironment, parseArgs } from "../../src/cli.js";

describe("parseArgs", () => {
  test("returns stdio defaults with optional values unset", () => {
    expect(parseArgs([])).toEqual({
      help: false,
      version: false,
      forceStdio: false,
      transport: "stdio",
      enableLegacySse: false,
      unsupportedNoStdio: false,
    });
  });

  test("--help flag sets help true", () => {
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
  });

  test("-h alias sets help true", () => {
    expect(parseArgs(["-h"])).toMatchObject({ help: true });
  });

  test("--version flag sets version true", () => {
    expect(parseArgs(["--version"])).toMatchObject({ version: true });
  });

  test("-v alias sets version true", () => {
    expect(parseArgs(["-v"])).toMatchObject({ version: true });
  });

  test("http positional sets http transport", () => {
    expect(parseArgs(["http"])).toMatchObject({ transport: "http" });
  });

  test("stdio positional sets stdio transport", () => {
    expect(parseArgs(["http", "stdio"])).toMatchObject({ transport: "stdio" });
  });

  test("--stdio forces stdio transport", () => {
    expect(parseArgs(["http", "--stdio"])).toMatchObject({
      forceStdio: true,
      transport: "stdio",
    });
  });

  test("--transport=http sets http transport", () => {
    expect(parseArgs(["--transport=http"])).toMatchObject({ transport: "http" });
  });

  test("--transport=stdio sets stdio transport", () => {
    expect(parseArgs(["http", "--transport=stdio"])).toMatchObject({ transport: "stdio" });
  });

  test("--host reads the following value", () => {
    expect(parseArgs(["--host", "1.2.3.4"])).toMatchObject({ host: "1.2.3.4" });
  });

  test("--port reads the following value", () => {
    expect(parseArgs(["--port", "3000"])).toMatchObject({ port: "3000" });
  });

  test("--bearer-token-file reads the following value", () => {
    expect(parseArgs(["--bearer-token-file", "/path"])).toMatchObject({
      bearerTokenFile: "/path",
    });
  });

  test("--enable-legacy-sse sets legacy SSE true", () => {
    expect(parseArgs(["--enable-legacy-sse"])).toMatchObject({ enableLegacySse: true });
  });

  test("--tool-profile reads the following value", () => {
    expect(parseArgs(["--tool-profile", "remote-safe"])).toMatchObject({
      toolProfile: "remote-safe",
    });
  });

  test("--connector-credential-provider reads the following value", () => {
    expect(parseArgs(["--connector-credential-provider", "agent"])).toMatchObject({
      connectorCredentialProvider: "agent",
    });
  });

  test("--no-stdio marks the unsupported flag without exiting", () => {
    expect(parseArgs(["--no-stdio"])).toMatchObject({ unsupportedNoStdio: true });
  });

  test("value flags without a following value leave their option unset", () => {
    expect(parseArgs(["--host"])).not.toHaveProperty("host");
    expect(parseArgs(["--port"])).not.toHaveProperty("port");
    expect(parseArgs(["--bearer-token-file"])).not.toHaveProperty("bearerTokenFile");
    expect(parseArgs(["--tool-profile"])).not.toHaveProperty("toolProfile");
    expect(parseArgs(["--connector-credential-provider"])).not.toHaveProperty(
      "connectorCredentialProvider",
    );
  });

  test("unknown flags are ignored", () => {
    expect(parseArgs(["--unknown", "http"])).toMatchObject({
      help: false,
      version: false,
      transport: "http",
    });
  });

  test.each([
    ["--host", "host"],
    ["--port", "port"],
    ["--bearer-token-file", "bearerTokenFile"],
    ["--tool-profile", "toolProfile"],
    ["--connector-credential-provider", "connectorCredentialProvider"],
  ] as const)("consumes the following token as the value of %s", (flag, key) => {
    expect(parseArgs([flag, "agent", "--version"])).toMatchObject({
      [key]: "agent",
      version: true,
    });
    expect(parseArgs([flag, "http"]).transport).toBe("stdio");
  });

  test("preserves the last value while continuing past flags without values", () => {
    expect(parseArgs(["--host", "first", "--host", "second", "--port"])).toMatchObject({
      host: "second",
      transport: "stdio",
    });
    expect(parseArgs(["--host", "first", "--host", "second", "--port"])).not.toHaveProperty("port");
  });

  test("agent enroll captures agent args", () => {
    expect(parseArgs(["agent", "enroll", "--server", "https://example.test"])).toMatchObject({
      agentArgs: ["enroll", "--server", "https://example.test"],
    });
  });
});

describe("HTTP CLI environment overrides", () => {
  test("applies all supplied options without changing unrelated environment variables", () => {
    const options = parseArgs([
      "http",
      "--host",
      "127.0.0.1",
      "--port",
      "3100",
      "--bearer-token-file",
      "/tmp/token",
      "--enable-legacy-sse",
      "--tool-profile",
      "remote-safe",
      "--connector-credential-provider",
      "agent",
    ]);
    const env: NodeJS.ProcessEnv = { UNRELATED: "preserve" };
    applyHttpCliEnvironment(options, env);
    expect(env).toEqual({
      UNRELATED: "preserve",
      SSH_MCP_HTTP_HOST: "127.0.0.1",
      SSH_MCP_HTTP_PORT: "3100",
      SSH_MCP_HTTP_BEARER_TOKEN_FILE: "/tmp/token",
      SSH_MCP_ENABLE_LEGACY_SSE: "true",
      SSH_MCP_TOOL_PROFILE: "remote-safe",
      SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER: "agent",
    });
  });

  test("leaves existing overrides untouched when HTTP options are absent", () => {
    const env: NodeJS.ProcessEnv = {
      SSH_MCP_HTTP_PORT: "4000",
      SSH_MCP_ENABLE_LEGACY_SSE: "false",
    };
    applyHttpCliEnvironment(parseArgs(["http"]), env);
    expect(env).toEqual({
      SSH_MCP_HTTP_PORT: "4000",
      SSH_MCP_ENABLE_LEGACY_SSE: "false",
    });
  });
});
