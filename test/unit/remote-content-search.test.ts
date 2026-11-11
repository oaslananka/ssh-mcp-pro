import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { searchAuthorizedFileContents } from "../../src/remote/agent-content-search.js";
import { AgentExecutor } from "../../src/remote/agent-executor.js";
import { generateEd25519PemKeyPair, verifyEnvelope } from "../../src/remote/crypto.js";
import { listRemoteToolDescriptors } from "../../src/remote/mcp-tools.js";
import { mergeCustomPolicy } from "../../src/remote/policy.js";
import type { ActionRequestEnvelope } from "../../src/remote/types.js";

function workspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ssh-content-search-"));
  const allowed = path.join(root, "allowed");
  const denied = path.join(allowed, "private");
  const outside = path.join(root, "outside");
  mkdirSync(path.join(allowed, "src"), { recursive: true });
  mkdirSync(denied);
  mkdirSync(outside);
  writeFileSync(
    path.join(allowed, "src", "settings.ini"),
    "first line\nMODE=advanced\nlast line\n",
  );
  writeFileSync(path.join(allowed, "config.json"), '{"mode": "advanced"}\n');
  writeFileSync(path.join(allowed, "src", "ignored.txt"), "mode=advanced");
  writeFileSync(path.join(allowed, ".hidden.ini"), "mode=advanced");
  writeFileSync(path.join(denied, "secret.ini"), "mode=advanced");
  writeFileSync(path.join(outside, "outside.ini"), "mode=advanced");
  writeFileSync(path.join(allowed, "binary.ini"), Buffer.from([0x00, 0x64, 0x61, 0x74, 0x61]));
  writeFileSync(path.join(allowed, "oversized.ini"), "mode=advanced\n".repeat(12_000));
  const policy = mergeCustomPolicy({
    capabilities: { "files.read": true },
    allowPaths: [allowed.replaceAll("\\", "/")],
    denyPaths: [denied.replaceAll("\\", "/")],
    maxOutputBytes: 4096,
  });
  return {
    root,
    allowed,
    denied,
    outside,
    policy,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("bounded authorized filename and content discovery", () => {
  test("finds literal text case-insensitively with line numbers, avoids denied/hidden/huge/binary files", async () => {
    const w = workspace();
    try {
      const result = await searchAuthorizedFileContents(w.policy, { query: "mode=advanced" });
      expect(result.matches.map((x) => x.name).sort()).toEqual(
        ["settings.ini", "ignored.txt"].sort(),
      );
      expect(result.matches.find((x) => x.name === "settings.ini")).toMatchObject({
        line_number: 2,
        snippet: expect.stringContaining("MODE=advanced"),
      });
      expect(result.matches.every((x) => x.path.startsWith(w.allowed))).toBe(true);
      expect(
        result.matches.some(
          (x) =>
            x.path.includes("private") || x.path.includes(".hidden") || x.path.includes("outside"),
        ),
      ).toBe(false);
      expect(result.truncated).toBe(false);
    } finally {
      w.cleanup();
    }
  });

  test("filters filenames and respects depth, hidden opt-in, literal matching and case sensitivity", async () => {
    const w = workspace();
    try {
      const ini = await searchAuthorizedFileContents(w.policy, {
        query: "advanced",
        name_pattern: "*.ini",
      });
      expect(ini.matches.map((x) => x.name)).toContain("settings.ini");
      expect(ini.matches.map((x) => x.name)).not.toContain("config.json");
      const top = await searchAuthorizedFileContents(w.policy, { query: "mode", max_depth: 0 });
      expect(top.matches.map((x) => x.name)).toEqual(["config.json"]);
      const hidden = await searchAuthorizedFileContents(w.policy, {
        query: "advanced",
        max_depth: 0,
        include_hidden: true,
      });
      expect(hidden.matches.map((x) => x.name)).toContain(".hidden.ini");
      const sensitive = await searchAuthorizedFileContents(w.policy, {
        query: "mode=advanced",
        case_sensitive: true,
      });
      expect(sensitive.matches.map((x) => x.name)).toEqual(["ignored.txt"]);
      const literal = await searchAuthorizedFileContents(w.policy, { query: "mode.*" });
      expect(literal.matches).toHaveLength(0);
    } finally {
      w.cleanup();
    }
  });

  test.skipIf(process.platform === "win32")(
    "never follows symlinks to data outside the allowlist",
    async () => {
      const w = workspace();
      try {
        symlinkSync(w.outside, path.join(w.allowed, "external"), "dir");
        symlinkSync(path.join(w.outside, "outside.ini"), path.join(w.allowed, "linked.ini"));
        const result = await searchAuthorizedFileContents(w.policy, { query: "advanced" });
        expect(result.matches.map((x) => x.name)).not.toContain("outside.ini");
        expect(result.matches.map((x) => x.name)).not.toContain("linked.ini");
      } finally {
        w.cleanup();
      }
    },
  );

  test("denies invalid requests and out-of-policy roots", async () => {
    const w = workspace();
    try {
      for (const args of [
        { query: "" },
        { query: "a".repeat(201) },
        { query: "a\nb" },
        { query: "a", root_path: w.outside },
        { query: "a", max_depth: 40 },
        { query: "a", max_results: 0 },
        { query: "a", case_sensitive: "yes" },
      ]) {
        await expect(searchAuthorizedFileContents(w.policy, args as never)).rejects.toMatchObject({
          code: "POLICY_DENIED",
        });
      }
    } finally {
      w.cleanup();
    }
  });

  test("stops reading after its candidate file budget and announces truncation", async () => {
    const w = workspace();
    try {
      for (let i = 0; i < 140; i += 1) {
        writeFileSync(
          path.join(w.allowed, "search-" + String(i).padStart(3, "0") + ".log"),
          "nothing relevant",
        );
      }
      const result = await searchAuthorizedFileContents(w.policy, {
        query: "not here",
        name_pattern: "search-*.log",
      });
      expect(result.truncated).toBe(true);
      expect(result.scanned_entries).toBeGreaterThanOrEqual(128);
      expect(result.matches).toHaveLength(0);
    } finally {
      w.cleanup();
    }
  });

  test("honors response size policy using valid JSON and marks partial results", async () => {
    const w = workspace();
    try {
      const policy = { ...w.policy, maxOutputBytes: 140 };
      const result = await searchAuthorizedFileContents(policy, { query: "advanced" });
      expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(140);
      expect(result.truncated).toBe(true);
    } finally {
      w.cleanup();
    }
  });

  test("signed read-only action and tool discovery work only under files.read", async () => {
    const w = workspace();
    try {
      const key = generateEd25519PemKeyPair();
      const request: ActionRequestEnvelope = {
        type: "action.request",
        action_id: "act_content_search",
        agent_id: "agt_test",
        user_id: "github:test",
        tool: "file_content_search",
        capability: "files.read",
        args: { query: "mode=advanced", name_pattern: "*.ini" },
        policy_version: 1,
        issued_at: new Date().toISOString(),
        deadline: new Date(Date.now() + 30_000).toISOString(),
        nonce: "fixture",
        signature: "",
      };
      const executor = new AgentExecutor(w.policy, key.privateKeyPem);
      const result = await executor.execute(request);
      expect(result.status).toBe("ok");
      expect(JSON.parse(result.stdout ?? "{}").matches).toEqual([
        expect.objectContaining({ name: "settings.ini", line_number: 2 }),
      ]);
      expect(verifyEnvelope(result as unknown as Record<string, unknown>, key.publicKeyPem)).toBe(
        true,
      );
      const disabled = new AgentExecutor(
        mergeCustomPolicy({ capabilities: { "files.read": false } }),
        key.privateKeyPem,
      );
      const denied = await disabled.execute(request);
      expect(denied).toMatchObject({ status: "error", error_code: "CAPABILITY_DENIED" });
      const tools = listRemoteToolDescriptors(["files.read"]);
      expect(tools.map((t) => t.name)).toContain("file_content_search");
      expect(tools.find((t) => t.name === "file_content_search")?.annotations).toEqual(
        expect.objectContaining({
          readOnlyHint: true,
          destructiveHint: false,
        }),
      );
      expect(listRemoteToolDescriptors([]).map((t) => t.name)).not.toContain("file_content_search");
    } finally {
      w.cleanup();
    }
  });
});
