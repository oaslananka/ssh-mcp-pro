import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { RemoteStore } from "../../src/remote/store.js";

const posixTest = process.platform === "win32" ? test.skip : test;
const now = "2026-01-01T00:00:00.000Z";

function mode(file: string): number {
  return statSync(file).mode & 0o777;
}

function withFixture(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-store-permissions-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

posixTest("creates private databases and new directories without changing existing parents", () => {
  withFixture((dir) => {
    const shared = path.join(dir, "shared");
    mkdirSync(shared);
    chmodSync(shared, 0o755);
    const privateDir = path.join(shared, "private");
    const dbPath = path.join(privateDir, "control.db");
    const store = new RemoteStore(dbPath);
    try {
      assert.equal(mode(dbPath), 0o600);
      assert.equal(mode(privateDir), 0o700);
      assert.equal(mode(shared), 0o755);
    } finally {
      store.close();
    }
  });
});

posixTest("restricts an existing database without losing data", () => {
  withFixture((dir) => {
    const dbPath = path.join(dir, "control.db");
    const original = new RemoteStore(dbPath);
    try {
      original.upsertUser({ internalId: "github:43", id: "43", login: "fixture", now });
    } finally {
      original.close();
    }
    chmodSync(dbPath, 0o644);
    const reopened = new RemoteStore(dbPath);
    try {
      assert.equal(mode(dbPath), 0o600);
      assert.equal(reopened.getUserById("github:43")?.githubLogin, "fixture");
    } finally {
      reopened.close();
    }
  });
});

posixTest("rejects a symbolic-link database without changing the target", () => {
  withFixture((dir) => {
    const target = path.join(dir, "real.db");
    const original = new RemoteStore(target);
    original.close();
    chmodSync(target, 0o644);
    const link = path.join(dir, "alias.db");
    symlinkSync(target, link);
    assert.throws(() => {
      const store = new RemoteStore(link);
      store.close();
    });
    assert.equal(mode(target), 0o644);
  });
});

posixTest("protects existing WAL and shared-memory sidecars before reopening", () => {
  withFixture((dir) => {
    const dbPath = path.join(dir, "control.db");
    const original = new RemoteStore(dbPath);
    original.close();
    const raw = new DatabaseSync(dbPath);
    try {
      raw.exec("PRAGMA journal_mode = WAL; CREATE TABLE fixture(value TEXT)");
      raw.exec("INSERT INTO fixture VALUES ('retained')");
      const files = [dbPath, dbPath + "-wal", dbPath + "-shm"];
      for (const file of files) chmodSync(file, 0o644);
      const reopened = new RemoteStore(dbPath);
      try {
        for (const file of files) assert.equal(mode(file), 0o600);
        assert.deepEqual(raw.prepare("SELECT value FROM fixture").get()?.value, "retained");
      } finally {
        reopened.close();
      }
    } finally {
      raw.close();
    }
  });
});
