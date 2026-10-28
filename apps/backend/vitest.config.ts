import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig.json `paths` mapping so unit tests can
      // import modules that use the `@/` prefix without each test
      // having to hand-mock every transitive logger / utils import.
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // This dependency-free harness uses node:test and runs separately (see docs).
    exclude: [...configDefaults.exclude, "**/proxy-recovery.behavior.test.mjs"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.config.ts",
        "**/*.spec.ts",
        "**/*.test.ts",
      ],
    },
  },
});
