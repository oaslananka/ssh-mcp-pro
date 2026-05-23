import { describe, expect, test } from "@jest/globals";
import {
  ConnectionParamsSchema,
  EnsureLinesSchema,
  EnsurePackageSchema,
  EnsureServiceSchema,
  ExecStreamSchema,
  FileDownloadSchema,
  FileUploadSchema,
  MetricsFormatSchema,
  PatchApplySchema,
  SSHMCPError,
  TunnelCloseSchema,
  TunnelListSchema,
  TunnelLocalForwardSchema,
  TunnelRemoteForwardSchema,
} from "../../src/types.js";
import { ErrorCode } from "../../src/types.js";

describe("Schema contracts", () => {
  test("ConnectionParamsSchema applies expected defaults", () => {
    const result = ConnectionParamsSchema.parse({
      host: "example.com",
      username: "deployer",
    });

    expect(result.auth).toBe("auto");
    expect(result.readyTimeoutMs).toBe(20000);
    expect(result.ttlMs).toBe(900000);
    expect(result.hostKeyPolicy).toBe("strict");
    expect(result.policyMode).toBe("enforce");
  });

  test("ConnectionParamsSchema keeps deprecated strictHostKeyChecking alias", () => {
    const result = ConnectionParamsSchema.parse({
      host: "example.com",
      username: "deployer",
      strictHostKeyChecking: false,
    });

    expect(result.strictHostKeyChecking).toBe(false);
  });

  test("PatchApplySchema accepts diff instead of patch", () => {
    const parsed = PatchApplySchema.parse({
      sessionId: "session-1",
      path: "/tmp/file.txt",
      diff: "@@ -1 +1 @@\n-old\n+new",
    });

    expect(parsed.diff).toContain("+new");
    expect(() =>
      PatchApplySchema.parse({
        sessionId: "session-1",
        path: "/tmp/file.txt",
        patch: "legacy-field",
      }),
    ).toThrow();
  });

  test("EnsurePackageSchema defaults to present and supports absent", () => {
    expect(
      EnsurePackageSchema.parse({
        sessionId: "session-1",
        name: "htop",
      }).state,
    ).toBe("present");

    expect(
      EnsurePackageSchema.parse({
        sessionId: "session-1",
        name: "htop",
        state: "absent",
      }).state,
    ).toBe("absent");
  });

  test("EnsureLinesSchema defaults to present and supports absent", () => {
    expect(
      EnsureLinesSchema.parse({
        sessionId: "session-1",
        path: "/etc/hosts",
        lines: ["127.0.0.1 localhost"],
      }).state,
    ).toBe("present");

    expect(
      EnsureLinesSchema.parse({
        sessionId: "session-1",
        path: "/etc/hosts",
        lines: ["127.0.0.1 localhost"],
        state: "absent",
      }).state,
    ).toBe("absent");
  });

  test("EnsureServiceSchema supports restarted state", () => {
    const parsed = EnsureServiceSchema.parse({
      sessionId: "session-1",
      name: "nginx",
      state: "restarted",
    });

    expect(parsed.state).toBe("restarted");
  });

  test("streaming and transfer schemas parse expected payloads", () => {
    expect(
      ExecStreamSchema.parse({
        sessionId: "session-1",
        command: "echo hi",
      }),
    ).toEqual({
      sessionId: "session-1",
      command: "echo hi",
    });

    expect(
      FileUploadSchema.parse({
        sessionId: "session-1",
        localPath: "/tmp/a",
        remotePath: "/tmp/b",
      }).remotePath,
    ).toBe("/tmp/b");

    expect(
      FileDownloadSchema.parse({
        sessionId: "session-1",
        remotePath: "/tmp/a",
        localPath: "/tmp/b",
      }).localPath,
    ).toBe("/tmp/b");
  });

  test("metrics and tunnel schemas expose defaults", () => {
    expect(MetricsFormatSchema.parse({}).format).toBe("json");
    expect(
      TunnelLocalForwardSchema.parse({
        sessionId: "session-1",
        localPort: 8080,
        remotePort: 80,
      }).remoteHost,
    ).toBe("localhost");
    expect(
      TunnelRemoteForwardSchema.parse({
        sessionId: "session-1",
        remotePort: 8080,
        localPort: 80,
      }).localHost,
    ).toBe("localhost");
    expect(TunnelCloseSchema.parse({ tunnelId: "t-1" }).tunnelId).toBe("t-1");
    expect(TunnelListSchema.parse({})).toEqual({});
  });

  test("SSHMCPError serializes to JSON", () => {
    const error = new SSHMCPError(ErrorCode.EAUTH, "boom", "hint", "friendly", false, "retry");

    expect(error.toJSON()).toEqual({
      code: ErrorCode.EAUTH,
      message: "boom",
      hint: "hint",
      userFriendlyMessage: "friendly",
      recoverable: false,
      suggestedAction: "retry",
    });
  });
});
