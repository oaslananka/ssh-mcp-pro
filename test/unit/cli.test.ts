import { describe, expect, test } from "vitest";
import { parseArgs } from "../../src/cli.js";

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

  test("agent enroll captures agent args", () => {
    expect(parseArgs(["agent", "enroll", "--server", "https://example.test"])).toMatchObject({
      agentArgs: ["enroll", "--server", "https://example.test"],
    });
  });
});
