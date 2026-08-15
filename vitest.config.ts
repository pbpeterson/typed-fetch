import { defineConfig } from "vitest/config";

// ═══════════════════════════════════════════════════════════════════════════
// THE FILES THAT SPAWN AN OPERATING-SYSTEM PROCESS.
//
// Nine spec files run `npm pack`, `npm install`, `tsc`, or a CHILD vitest, and
// they carry 190 of the suite's 464 seconds of test time — 41 percent of it, in
// 7 percent of the files. That work is invisible to vitest's scheduler: the pool
// counts one worker as busy and hands the remaining cores to other files, while
// the child process competes for those same cores. Everything else in the run
// slows down, and the tests with the least headroom cross their budget.
//
// `scripts/smoke-entry.spec.mjs` is here for the opposite reason. It spawns
// nothing, but it races `setTimeout` against an abort and it has the least
// headroom in the suite — 5.0 s measured against its own 10 s budget — and a
// delayed timer is what contention produces.
//
// They run as their own GROUP, before everything else, capped at three workers.
// Nothing is skipped and nothing is moved out of the gate: the same command
// runs every one of them, under the same coverage instrumentation.
//
// WHY NOT A SHARD OUTSIDE THE PUBLISH GATE. Coverage is resolved once for the
// whole run from the root config and shared by every project, so a project that
// does not run in the gate is a project whose lines are not covered in the gate
// — and `thresholds` below is 100 on all four counters. The release would fail
// on coverage instead of flaking on contention, which is a worse trade.
//
// WHY A GROUP RATHER THAN A GLOBAL WORKER CAP. Vitest requires projects that
// differ in `maxWorkers` to differ in `sequence.groupOrder`, so groups run one
// after another. That is the point here: the process-spawning files never
// overlap the rest.
//
// MEASURED, not guessed. Regenerate the ranking with
//   npx vitest run --reporter=json --outputFile=<path>
// and sum `duration` per file. A file belongs here when it spawns a process AND
// its measured total is at least 3 s.
// ═══════════════════════════════════════════════════════════════════════════
const SERIAL_SPECS = [
  "scripts/check-consumer-entry.spec.mjs",
  "scripts/check-docs-entry.spec.mjs",
  "scripts/check-docs.spec.mjs",
  "scripts/gate-mutation-disabled-steps.spec.mjs",
  "scripts/gate-mutation-ignore-ranges.spec.mjs",
  "scripts/gate-mutation-skipped-jobs.spec.mjs",
  "scripts/gate-mutation-unanchored-readers.spec.mjs",
  "scripts/gate-mutation-yaml-spellings.spec.mjs",
  "scripts/smoke-entry.spec.mjs",
  "tests/surface/surface-changelog-direction-witnesses.spec.ts",
];

/**
 * The per-test budget, named once so the root and both projects cannot drift.
 *
 * Vitest defaults to 5000 ms, and this suite crossed it. Round 21 found ONE
 * generator test 0.6 seconds under the line; round 23 measured eleven, in six
 * files, failing under full-suite load and passing in isolation. They are
 * generator suites drawing hundreds of thousands of urls, and v8 coverage
 * instrumentation roughly doubles their wall clock — so `pnpm coverage`, a
 * RELEASE gate, went red on contention rather than on a defect. A budget that
 * fails on a slower runner tests the runner.
 *
 * This is a BUDGET, never an assertion. The cost findings this audit filed —
 * R20-H2-01, R22-H2-02, R23-H2-02 — assert a RATIO across a size sweep, not a
 * wall clock, precisely so they stay meaningful whatever this number is. A test
 * that needs a tighter budget states its own.
 *
 * Round 24 did NOT raise it. Raising a budget hides contention; the projects
 * below remove it.
 */
const TEST_TIMEOUT_MS = 30_000;

/**
 * Where a full record of a run is written when one is asked for.
 *
 * A failure nobody can reproduce is diagnosable only from the run that produced
 * it. The default reporter prints to a terminal and keeps nothing, so a red run
 * left a summary line with no test name, no duration, and no stack — round 24
 * lost one that way and never identified it. With `CI` set, or with
 * `VITEST_JSON_REPORT` naming a path, the json reporter records every test, its
 * duration, and its failure message, and `.github/workflows/ci.yml` uploads the
 * file as an artifact on success and on failure alike.
 */
const jsonReport = process.env.VITEST_JSON_REPORT ?? (process.env.CI ? "test-results.json" : "");

export default defineConfig({
  test: {
    // The root value governs a run with no project filter in play. Every
    // project repeats it, for the reason stated above `projects` below.
    testTimeout: TEST_TIMEOUT_MS,
    reporters: jsonReport ? ["default", ["json", { outputFile: jsonReport }]] : ["default"],
    // REPEATED IN EVERY PROJECT, and it must be. Vitest does not propagate the
    // root `test` options to an inline project, so a project that omits this
    // silently runs on the built-in 5000 ms default — the value round 21 and
    // round 23 both measured this suite crossing. A 7-second probe under the
    // first version of this split failed with "Test timed out in 5000ms" while
    // the config above still read 30_000, which is the whole safety net gone
    // and nothing saying so. Add it to any project added later.
    projects: [
      {
        test: {
          name: "serial",
          include: SERIAL_SPECS,
          maxWorkers: 3,
          sequence: { groupOrder: 0 },
          testTimeout: TEST_TIMEOUT_MS,
        },
      },
      {
        test: {
          name: "parallel",
          exclude: ["**/node_modules/**", "**/dist/**", ...SERIAL_SPECS],
          sequence: { groupOrder: 1 },
          testTimeout: TEST_TIMEOUT_MS,
        },
      },
    ],
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
