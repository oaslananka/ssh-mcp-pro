import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentExecutor } from "../../src/remote/agent-executor.js";
import { generateEd25519PemKeyPair, verifyEnvelope } from "../../src/remote/crypto.js";
import { mergeCustomPolicy } from "../../src/remote/policy.js";
import { listRemoteToolDescriptors } from "../../src/remote/mcp-tools.js";
import type { ActionRequestEnvelope, AgentPolicy } from "../../src/remote/types.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function request(args: Record<string, unknown>): ActionRequestEnvelope {
  return {
    type: "action.request",
    action_id: "act_replace",
    agent_id: "agt_fixture",
    user_id: "github:fixture",
    tool: "file_replace",
    capability: "files.write",
    args,
    policy_version: 1,
    issued_at: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    nonce: "test-nonce",
    signature: "",
  };
}
function setup(overrides: Partial<AgentPolicy> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-safe-edit-"));
  const allowed = path.join(dir, "allowed");
  const outside = path.join(dir, "outside");
  mkdirSync(allowed);
  mkdirSync(outside);
  const file = path.join(allowed, "settings.ini");
  writeFileSync(file, "mode=basic\nunchanged=yes\n");
  const key = generateEd25519PemKeyPair();
  const policy = mergeCustomPolicy({
    capabilities: { "files.read": true, "files.write": true },
    allowPaths: [allowed.replace(/\\/gu, "/")],
    denyPaths: [outside.replace(/\\/gu, "/")],
    ...overrides,
  });
  const executor = new AgentExecutor(policy, key.privateKeyPem);
  return {
    dir,
    allowed,
    outside,
    file,
    key,
    executor,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("remote file_replace with preview and stale-write guard", () => {
  test("previews a single exact replacement, then applies it with the expected file hash", async () => {
    const env = setup();
    try {
      const input = { path: env.file, old_text: "mode=basic", new_text: "mode=advanced" };
      const preview = await env.executor.execute(request(input));
      expect(preview).toMatchObject({ status: "ok" });
      const plan = JSON.parse(preview.stdout ?? "{}") as {
        applied: boolean;
        before_sha256: string;
        after_sha256: string;
        diff: string;
      };
      expect(plan).toMatchObject({
        applied: false,
        before_sha256: hash("mode=basic\nunchanged=yes\n"),
      });
      expect(plan.diff).toContain("+mode=advanced");
      expect(readFileSync(env.file, "utf8")).toBe("mode=basic\nunchanged=yes\n");
      const applied = await env.executor.execute(
        request({ ...input, dry_run: false, expected_sha256: plan.before_sha256 }),
      );
      expect(applied).toMatchObject({ status: "ok" });
      expect(JSON.parse(applied.stdout ?? "{}")).toMatchObject({
        applied: true,
        before_sha256: plan.before_sha256,
      });
      expect(
        verifyEnvelope(applied as unknown as Record<string, unknown>, env.key.publicKeyPem),
      ).toBe(true);
      expect(readFileSync(env.file, "utf8")).toBe("mode=advanced\nunchanged=yes\n");
    } finally {
      env.cleanup();
    }
  });

  test("rejects a stale approval and preserves a concurrently changed file", async () => {
    const env = setup();
    try {
      const input = { path: env.file, old_text: "mode=basic", new_text: "mode=advanced" };
      const preview = await env.executor.execute(request(input));
      const oldHash = JSON.parse(preview.stdout ?? "{}").before_sha256 as string;
      writeFileSync(env.file, "mode=basic\nexternally_changed=true\n");
      const result = await env.executor.execute(
        request({ ...input, dry_run: false, expected_sha256: oldHash }),
      );
      expect(result).toMatchObject({ status: "error", error_code: "FILE_CONFLICT" });
      expect(readFileSync(env.file, "utf8")).toContain("externally_changed");
    } finally {
      env.cleanup();
    }
  });

  test("rejects ambiguous matches, missing expected hash, and no-op changes", async () => {
    const env = setup();
    try {
      writeFileSync(env.file, "mode=basic\nmode=basic\n");
      for (const args of [
        { old_text: "mode=basic", new_text: "mode=advanced" },
        { old_text: "not here", new_text: "new" },
        { old_text: "mode=basic", new_text: "mode=basic" },
      ]) {
        const res = await env.executor.execute(request({ path: env.file, ...args }));
        expect(res.status).toBe("error");
      }
      writeFileSync(env.file, "mode=basic\n");
      const noHash = await env.executor.execute(
        request({ path: env.file, old_text: "mode=basic", new_text: "new", dry_run: false }),
      );
      expect(noHash).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
      expect(readFileSync(env.file, "utf8")).toBe("mode=basic\n");
    } finally {
      env.cleanup();
    }
  });

  test("does not bypass either file permission or allowed paths", async () => {
    const env = setup({
      capabilities: { "files.read": false, "files.write": true } as AgentPolicy["capabilities"],
    });
    try {
      const deniedRead = await env.executor.execute(
        request({ path: env.file, old_text: "mode=basic", new_text: "new" }),
      );
      expect(deniedRead).toMatchObject({ status: "error", error_code: "CAPABILITY_DENIED" });
      const outside = path.join(env.outside, "secret.ini");
      writeFileSync(outside, "mode=basic\n");
      const other = setup();
      try {
        const deniedPath = await other.executor.execute(
          request({ path: outside, old_text: "mode=basic", new_text: "new" }),
        );
        expect(deniedPath).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
        expect(readFileSync(outside, "utf8")).toBe("mode=basic\n");
      } finally {
        other.cleanup();
      }
    } finally {
      env.cleanup();
    }
  });

  test("rejects an undersized output budget before any file mutation", async () => {
    const env = setup({ maxOutputBytes: 100 });
    try {
      const original = readFileSync(env.file, "utf8");
      const result = await env.executor.execute(
        request({
          path: env.file,
          old_text: "mode=basic",
          new_text: "mode=advanced",
          dry_run: false,
          expected_sha256: hash(original),
        }),
      );
      expect(result).toMatchObject({ status: "error", error_code: "POLICY_DENIED" });
      expect(readFileSync(env.file, "utf8")).toBe(original);
    } finally {
      env.cleanup();
    }
  });

  test("advertises a mutating MCP tool only when read and write capabilities are available", () => {
    const names = (caps: Array<"files.read" | "files.write">) =>
      listRemoteToolDescriptors(caps).map((x) => x.name);
    expect(names(["files.read"])).not.toContain("file_replace");
    expect(names(["files.write"])).not.toContain("file_replace");
    expect(names(["files.read", "files.write"])).toContain("file_replace");
    const descriptor = listRemoteToolDescriptors(["files.read", "files.write"]).find(
      (x) => x.name === "file_replace",
    );
    expect(descriptor?.annotations).toEqual(
      expect.objectContaining({ destructiveHint: true, readOnlyHint: false }),
    );
    expect(descriptor?.inputSchema).toEqual(
      expect.objectContaining({
        required: ["agent_id_or_alias", "path", "old_text", "new_text"],
        additionalProperties: false,
      }),
    );
  });
});
