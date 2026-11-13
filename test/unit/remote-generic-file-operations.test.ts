import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentExecutor } from "../../src/remote/agent-executor.js";
import { generateEd25519PemKeyPair, verifyEnvelope } from "../../src/remote/crypto.js";
import { createAgentPolicy, mergeCustomPolicy } from "../../src/remote/policy.js";
import type { ActionRequestEnvelope, RemoteToolName } from "../../src/remote/types.js";

function request(
  tool: string,
  capability: ActionRequestEnvelope["capability"],
  args: Record<string, unknown>,
): ActionRequestEnvelope {
  return {
    type: "action.request",
    action_id: "file-test",
    agent_id: "fixture-agent",
    user_id: "fixture-user",
    tool: tool as RemoteToolName,
    capability,
    args,
    policy_version: 1,
    issued_at: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    nonce: "fixture-nonce",
    signature: "",
  };
}

describe("generic computer file tools", () => {
  test("a single full-admin owner can inspect, create, copy, move and remove project files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ssh-mcp-computer-"));
    const key = generateEd25519PemKeyPair();
    const agent = new AgentExecutor(createAgentPolicy("full-admin"), key.privateKeyPem);
    const call = (
      tool: string,
      capability: ActionRequestEnvelope["capability"],
      args: Record<string, unknown>,
    ) => agent.execute(request(tool, capability, args));
    try {
      const project = path.join(root, "my-project");
      const child = path.join(project, "nested");
      const mkdir = await call("file_manage", "files.write", {
        operation: "mkdir",
        path: child,
        recursive: true,
      });
      expect(mkdir.status).toBe("ok");
      const source = path.join(child, "main.txt");
      writeFileSync(source, "user-approved project content");
      writeFileSync(path.join(child, "other.txt"), "another item");
      const limited = await call("file_inspect", "files.read", {
        operation: "list",
        path: child,
        max_entries: 1,
      });
      expect(JSON.parse(limited.stdout ?? "{}")).toMatchObject({
        truncated: true,
        entries: [expect.objectContaining({ name: expect.any(String) })],
      });
      const listed = await call("file_inspect", "files.read", {
        operation: "list",
        path: child,
        max_entries: 10,
      });
      expect(listed.status).toBe("ok");
      expect(JSON.parse(listed.stdout ?? "{}")).toEqual(
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ name: "main.txt", type: "file" }),
          ]),
        }),
      );
      const stats = await call("file_inspect", "files.read", { operation: "stat", path: source });
      expect(JSON.parse(stats.stdout ?? "{}")).toEqual(
        expect.objectContaining({ type: "file", size_bytes: 29 }),
      );
      const copy = path.join(child, "copy.txt");
      expect(
        (
          await call("file_manage", "files.write", {
            operation: "copy",
            path: source,
            destination_path: copy,
          })
        ).status,
      ).toBe("ok");
      expect(readFileSync(copy, "utf8")).toBe("user-approved project content");
      const moved = path.join(project, "moved.txt");
      expect(
        (
          await call("file_manage", "files.write", {
            operation: "move",
            path: copy,
            destination_path: moved,
          })
        ).status,
      ).toBe("ok");
      expect(readFileSync(moved, "utf8")).toBe("user-approved project content");
      const removed = await call("file_manage", "files.write", {
        operation: "remove",
        path: moved,
      });
      expect(removed.status).toBe("ok");
      expect(verifyEnvelope(removed as unknown as Record<string, unknown>, key.publicKeyPem)).toBe(
        true,
      );
    } finally {
      agent.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Full Admin completes an ordinary project task in the current OS home directory", async () => {
    const root = mkdtempSync(path.join(homedir(), ".ssh-mcp-real-home-"));
    const key = generateEd25519PemKeyPair();
    const agent = new AgentExecutor(createAgentPolicy("full-admin"), key.privateKeyPem);
    const call = (
      tool: string,
      capability: ActionRequestEnvelope["capability"],
      args: Record<string, unknown>,
    ) => agent.execute(request(tool, capability, args));
    try {
      const folder = path.join(root, "ordinary-project");
      const source = path.join(folder, "project.txt");
      const copy = path.join(folder, "copy.txt");
      const moved = path.join(folder, "moved.txt");
      expect(
        (await call("file_manage", "files.write", { operation: "mkdir", path: folder })).status,
      ).toBe("ok");
      expect(
        (await call("file_write", "files.write", { path: source, content: "initial version" }))
          .status,
      ).toBe("ok");
      expect((await call("file_read", "files.read", { path: source })).stdout).toBe(
        "initial version",
      );
      expect(
        (await call("file_write", "files.write", { path: source, content: "edited version" }))
          .status,
      ).toBe("ok");
      expect(
        (
          await call("file_manage", "files.write", {
            operation: "copy",
            path: source,
            destination_path: copy,
          })
        ).status,
      ).toBe("ok");
      expect(
        (
          await call("file_manage", "files.write", {
            operation: "move",
            path: copy,
            destination_path: moved,
          })
        ).status,
      ).toBe("ok");
      expect((await call("file_read", "files.read", { path: moved })).stdout).toBe(
        "edited version",
      );
      const cli = await call("run_shell", "shell.exec", { command: "node --version", cwd: folder });
      expect(cli.status).toBe("ok");
      expect(cli.stdout).toMatch(/^v\d+/u);
      expect(
        (await call("file_manage", "files.write", { operation: "remove", path: moved })).status,
      ).toBe("ok");
      expect(
        (await call("file_inspect", "files.read", { operation: "list", path: folder })).status,
      ).toBe("ok");
    } finally {
      agent.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("never overwrites an existing destination unless explicitly requested", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ssh-mcp-no-clobber-"));
    const key = generateEd25519PemKeyPair();
    const agent = new AgentExecutor(createAgentPolicy("full-admin"), key.privateKeyPem);
    try {
      const source = path.join(root, "source.txt");
      const destination = path.join(root, "destination.txt");
      writeFileSync(source, "new content");
      writeFileSync(destination, "keep me");
      const result = await agent.execute(
        request("file_manage", "files.write", {
          operation: "copy",
          path: source,
          destination_path: destination,
        }),
      );
      expect(result.status).toBe("error");
      expect(result.error_code).toBe("POLICY_DENIED");
      expect(readFileSync(destination, "utf8")).toBe("keep me");
    } finally {
      agent.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "does not delete a real file through its symbolic link",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ssh-mcp-link-removal-"));
      const key = generateEd25519PemKeyPair();
      const agent = new AgentExecutor(createAgentPolicy("full-admin"), key.privateKeyPem);
      try {
        const source = path.join(root, "real.txt");
        const link = path.join(root, "shortcut.txt");
        writeFileSync(source, "preserve");
        symlinkSync(source, link);
        const result = await agent.execute(
          request("file_manage", "files.write", {
            operation: "remove",
            path: link,
          }),
        );
        expect(result.status).toBe("error");
        expect(result.error_code).toBe("POLICY_DENIED");
        expect(readFileSync(source, "utf8")).toBe("preserve");
      } finally {
        agent.dispose();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test("recursive mkdir refuses a destination symlink outside a custom policy", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ssh-mcp-mkdir-link-"));
    const outside = mkdtempSync(path.join(tmpdir(), "ssh-mcp-mkdir-external-"));
    const keys = generateEd25519PemKeyPair();
    const agent = new AgentExecutor(
      mergeCustomPolicy({ profile: "full-admin", allowPaths: [root], denyPaths: [] }),
      keys.privateKeyPem,
    );
    try {
      const link = path.join(root, "linked-directory");
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      const result = await agent.execute(
        request("file_manage", "files.write", { operation: "mkdir", path: link, recursive: true }),
      );
      expect(result.status).toBe("error");
      expect(result.error_code).toBe("POLICY_DENIED");
    } finally {
      agent.dispose();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  test("the same commands never bypass Read-Only and scoped file policies", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ssh-mcp-restricted-"));
    const outside = mkdtempSync(path.join(tmpdir(), "ssh-mcp-external-"));
    const key = generateEd25519PemKeyPair();
    const readOnly = new AgentExecutor(createAgentPolicy("read-only"), key.privateKeyPem);
    const restricted = new AgentExecutor(
      mergeCustomPolicy({
        profile: "full-admin",
        allowPaths: [root],
        denyPaths: [],
      }),
      key.privateKeyPem,
    );
    try {
      expect(
        (
          await readOnly.execute(
            request("file_manage", "files.write", {
              operation: "mkdir",
              path: path.join(root, "new"),
            }),
          )
        ).error_code,
      ).toBe("CAPABILITY_DENIED");
      const external = path.join(outside, "secrets.txt");
      writeFileSync(external, "private");
      symlinkSync(
        outside,
        path.join(root, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const escaped = await restricted.execute(
        request("file_inspect", "files.read", {
          operation: "stat",
          path: path.join(root, "escape", "secrets.txt"),
        }),
      );
      expect(escaped.status).toBe("error");
      expect(escaped.error_code).toBe("POLICY_DENIED");
      const escapedCopy = await restricted.execute(
        request("file_manage", "files.write", {
          operation: "copy",
          path: external,
          destination_path: path.join(root, "copy.txt"),
        }),
      );
      expect(escapedCopy.error_code).toBe("POLICY_DENIED");
      expect(
        (
          await restricted.execute(
            request("file_manage", "files.write", {
              operation: "remove",
              path: path.parse(root).root,
              recursive: true,
            }),
          )
        ).status,
      ).toBe("error");
    } finally {
      readOnly.dispose();
      restricted.dispose();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
