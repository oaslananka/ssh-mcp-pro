import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["test/setup-logs.ts"],
    include: [
      "test/unit/auth.test.ts",
      "test/unit/config*.test.ts",
      "test/unit/http-security.test.ts",
      "test/unit/mutation-gate.test.ts",
      "test/unit/oauth.test.ts",
      "test/unit/policy*.test.ts",
      "test/unit/remote-control-plane.test.ts",
      "test/unit/remote-crypto.test.ts",
      "test/unit/remote-policy.test.ts",
      "test/unit/remote-scopes.test.ts",
      "test/unit/safety*.test.ts",
      "test/unit/session.test.ts",
    ],
  },
});
