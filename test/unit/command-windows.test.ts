import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { capture, commandFailure, executable, run } from "../../scripts/lib/command.mjs";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0, stdout: "11.0.0\n", stderr: "" })),
  };
});
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

const mockSpawn = vi.mocked(spawnSync);
const mockExists = vi.mocked(existsSync);
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const path = process.env.PATH;
const comspec = process.env.ComSpec;

beforeEach(() => {
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  process.env.PATH = "C:\tools;C:\node";
  process.env.ComSpec = "C:\Windows\System32\cmd.exe";
  mockSpawn.mockClear();
  mockExists.mockReset().mockReturnValue(false);
});
afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform);
  process.env.PATH = path;
  if (comspec === undefined) delete process.env.ComSpec;
  else process.env.ComSpec = comspec;
});

describe("Windows maintenance command invocation", () => {
  test.each(["npm", "npx"])("runs bundled %s JavaScript without shell/PATH .cmd", (tool) => {
    mockExists.mockImplementation((candidate) =>
      String(candidate).endsWith(tool === "npm" ? "/npm/bin/npm-cli.js" : "/npm/bin/npx-cli.js"),
    );
    const result = capture(tool, ["--version"]);
    expect(result.status).toBe(0);
    expect(mockSpawn).toHaveBeenCalledOnce();
    const [command, args, options] = mockSpawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args?.[0]).toContain("npm/bin/");
    expect(args?.[1]).toBe("--version");
    expect(options?.shell).not.toBe(true);
  });

  test("routes pnpm through its Corepack JavaScript entrypoint when installed", () => {
    mockExists.mockImplementation((candidate) =>
      String(candidate).endsWith("/corepack/dist/pnpm.js"),
    );
    run("pnpm", ["--version"]);
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("corepack/dist/pnpm.js"), "--version"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  test("uses a PATH pnpm shim when no bundled CLI is present", () => {
    mockExists.mockImplementation((candidate) => String(candidate).endsWith("pnpm.cmd"));
    capture("pnpm", ["list", "--json"]);
    expect(mockSpawn).toHaveBeenCalledWith(
      process.env.ComSpec,
      ["/d", "/c", expect.stringContaining("pnpm.cmd"), "list", "--json"],
      expect.objectContaining({ stdio: "pipe" }),
    );
  });

  test("quotes safe space-containing arguments in the cmd fallback", () => {
    capture("pnpm", ["file with space", "--version"]);
    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe(process.env.ComSpec);
    expect(args?.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(args?.[3]).toContain('"file with space"');
  });

  test("rejects unsafe cmd variable expansion in fallback", () => {
    expect(() => capture("pnpm", ["%COMSPEC%"])).toThrow("unsafe Windows command shim");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test("leaves non-shim commands as direct argv execution", () => {
    expect(executable("git")).toBe("git");
    expect(executable("npm")).toBe("npm.cmd");
    capture("git", ["status"]);
    expect(mockSpawn).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  test("formats errors from failed tools", () => {
    expect(commandFailure("npm", { status: null, stderr: "denied", stdout: "" })).toEqual({
      ok: false,
      status: null,
      error: "npm failed: denied",
    });
  });
});
