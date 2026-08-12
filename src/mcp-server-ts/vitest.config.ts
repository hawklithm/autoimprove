import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // LLM-dependent tests (e.g. scene-extraction) perform real model calls that
    // can each take several seconds; the default 5s budget is too tight and made
    // them fail with a misleading "timeout". 120s gives real calls (and the new
    // 3-retry policy) room to complete.
    testTimeout: 120000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "tests/"],
    },
  },
});
