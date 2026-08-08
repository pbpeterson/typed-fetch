import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text"],
      // Every branch is either taken by a test or carries a written
      // justification in a `v8 ignore` range. A change that uncovers one breaks
      // this gate, which is the point: the branches nobody exercised are where
      // round 4 went looking.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
