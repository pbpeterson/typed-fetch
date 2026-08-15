import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest defaults to 5000 ms, and this suite crossed it. Round 21 found ONE
    // generator test 0.6 seconds under the line; round 23 measured eleven, in
    // six files, failing under full-suite load and passing in isolation. They
    // are generator suites drawing hundreds of thousands of urls, and v8
    // coverage instrumentation roughly doubles their wall clock — so
    // `pnpm coverage`, a RELEASE gate, went red on contention rather than on a
    // defect. A budget that fails on a slower runner tests the runner.
    //
    // This is a BUDGET, never an assertion. The cost findings this audit filed
    // — R20-H2-01, R22-H2-02, R23-H2-02 — assert a RATIO across a size sweep,
    // not a wall clock, precisely so they stay meaningful whatever this number
    // is. A test that needs a tighter budget states its own.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**", "scripts/**", "fixtures/**"],
      // Each smoke runs under a runtime a Node worker cannot host, and CI
      // executes it under that runtime. Coverage for the two files is measured
      // there or not at all. An exclusion list that can grow in silence turns a
      // 100 percent threshold into decoration, so
      // tests/surface/surface-coverage-config-pins.spec.ts pins this list to these two
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
