import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text"],
      // The thresholds are the measured baseline. Raise `branches` to 100 in
      // the same commit that closes the last uncovered branch.
      thresholds: {
        branches: 94,
        functions: 100,
        lines: 99,
        statements: 98,
      },
    },
  },
});
