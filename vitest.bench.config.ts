import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    environment: "node",
    // Keep logging out of the measured code paths regardless of the caller's LOG_LEVEL.
    env: { LOG_LEVEL: "silent" },
    benchmark: {
      include: ["test/bench/**/*.bench.ts"],
    },
  },
});
