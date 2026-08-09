import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**", "scripts/**", "fixtures/**"],
      // Each smoke runs under a runtime a Node worker cannot host, and CI
      // executes it under that runtime. Coverage for the two files is measured
      // there or not at all. An exclusion list that can grow in silence turns a
      // 100 percent threshold into decoration, so
      // tests/surface/round16-h4-surface.spec.ts pins this list to these two
      // paths and fails when a third one is added.
      exclude: ["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"],
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
