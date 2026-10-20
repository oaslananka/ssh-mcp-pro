import { describe, expect, test } from "vitest";
import {
  isValidCommitRange,
  isValidPackageName,
} from "../../scripts/lib/maintenance-cli-input.mjs";

describe("pure maintenance CLI input validation", () => {
  test.each(["ssh-mcp-pro", "@team/ssh-mcp-pro", "a", "abc._~-2"])(
    "allows valid npm identifier %s",
    (name) => expect(isValidPackageName(name)).toBe(true),
  );

  test.each([
    undefined,
    7,
    "",
    "@",
    "@scope",
    "@scope/",
    "@scope/name/other",
    "--registry",
    "../outside",
    "unsafe;command",
    "invalid💥",
    "_leading",
    "a".repeat(215),
  ])("rejects invalid npm identifier %s", (name) => {
    expect(isValidPackageName(name)).toBe(false);
  });

  test.each(["HEAD", "HEAD~1..HEAD", "origin/main..HEAD", "9fcef12", "v1.2.3^{commit}"])(
    "accepts valid Git revision %s",
    (range) => expect(isValidCommitRange(range)).toBe(true),
  );

  test.each([undefined, "", "-c", "--exec=echo", "HEAD;echo", "HEAD --all", "HEAD\nbad"])(
    "rejects Git option or unsafe revision %s",
    (range) => expect(isValidCommitRange(range)).toBe(false),
  );
});
