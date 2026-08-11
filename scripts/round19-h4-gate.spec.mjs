// ═══════════════════════════════════════════════════════════════════════════
// ROUND 19, LANE H4 — a gate is tested by BREAKING what it guards.
//
// R16-ORCH-01 was a coverage gate that could not fail when what it guarded was
// broken. R17-H4-02 was the same shape one layer up: a pin whose pattern named
// what it expected, so it could not see what it did not expect. R18-H4-04 was
// the same shape a THIRD time, inside a pin written by the round that found the
// first two: it asserted the text `thresholds: {` existed and read no number.
//
// Every gate and every pin this audit has added is therefore driven here
// against a MUTATION of the thing it guards, in a scratch root of symlinks, and
// the only evidence accepted is a RED run. Reading that a gate passes proves
// nothing about a gate.
//
// Two subjects:
//
//  1. Section 8.6 acceptance item 4 — "every remaining `v8 ignore` range
//     carries a written justification that states the exact condition that
//     makes the line unreachable". Items 1, 2 and 3 each have a committed test.
//     Item 4 has none, and this file shows what an unjustified range buys.
//  2. The exclusion list's own PREMISE. `vitest.config.ts` drops two files from
//     the 100 percent threshold because "CI executes it under that runtime".
//     One half of that premise is guarded by a committed test and the other
//     half is guarded by nothing.
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** This round's own H4 proof files. Neither is a committed check of anything. */
const OWN_PROOF_FILES = [
  "scripts/round19-h4-gate.spec.mjs",
  "tests/surface/round19-h4-surface.spec.ts",
];
const repoText = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Every spec file in the repository, by its path from the root. */
function everySpecFile() {
  const found = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.spec\.(?:ts|mjs)$/.test(entry.name)) found.push(next);
    }
  };
  walk("tests");
  walk("scripts");
  return found;
}

/** A vitest child, run over `root`, answering its exit status. */
function runVitest(root, argv) {
  // A clean environment: this runs INSIDE a vitest worker, and the child must
  // not inherit the parent run's pool bookkeeping. One worker, no file
  // parallelism, for the same reason round 17's harness states — the parent
  // suite holds cost tests with a budget a child pool would take away.
  // `NODE_V8_COVERAGE` goes too: under `pnpm coverage` the parent worker
  // carries one, and a child that inherits it writes its scratch project's
  // v8 output into the repository's own report directory.
  // `NO_COLOR`, because this harness reads the child's summary lines as text.
  // Vitest turns its own colors OFF when `std-env` reports an AI agent — it
  // reads `AI_AGENT` and `CLAUDECODE` — and leaves them ON everywhere else. So
  // every read below passed under the agent that wrote it and failed on a
  // developer's terminal, on escape codes nobody put in the assertion. The
  // child writes to a pipe and is read as text: it never needs color.
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("VITEST") && key !== "NODE_V8_COVERAGE",
      ),
    ),
    NO_COLOR: "1",
  };
  return spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--root",
      root,
      ...argv,
      "--pool=threads",
      "--maxWorkers=1",
      "--fileParallelism=false",
    ],
    { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
  );
}

/**
 * The coverage run this harness reads: the table, and the summary lines the
 * four threshold reads below quote word for word.
 *
 * `text-summary` is named here because vitest ADDS it on its own when
 * `std-env` reports an AI agent, and only then. The summary the reads below
 * quote existed under the agent that wrote them and in no other environment.
 * Naming both reporters makes the child print the same report everywhere.
 */
const COVERAGE_ARGV = [
  "--coverage.enabled",
  "--coverage.provider=v8",
  "--coverage.reporter=text",
  "--coverage.reporter=text-summary",
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. R19-H4-03 — acceptance item 4 is enforced by nothing, and an unjustified
//    `v8 ignore` range buys a 100 percent report over an untested branch.
//
// Section 8.6 lists five acceptance conditions for the coverage workstream.
// Item 1 (the include names all three trees) is pinned by
// `tests/surface/round16-h4-surface.spec.ts`. Item 2's thresholds are pinned by
// `tests/surface/round17-h4-surface.spec.ts`, and R18-H4-04 made that pin read
// the four numbers. Item 3 (the exclusion list) is pinned twice and driven
// against a grown list by R17-H4-02.
//
// Item 4 is the one that decides whether a 100 percent report means anything,
// because a `v8 ignore` range removes its lines from the denominator. Nothing
// in this repository reads one.
// ═══════════════════════════════════════════════════════════════════════════

describe("R19-H4-03 — the `v8 ignore` justifications acceptance item 4 requires", () => {
  const IGNORE = /\/\*\s*v8 ignore/;

  test("EVIDENCE: the repository ships `v8 ignore` ranges under measurement", () => {
    // Six ranges in four measured files. Each one removes its lines from the
    // denominator of the very gate that reports 100 percent, so item 4 is not
    // decoration: it is the only thing that makes the number mean anything.
    const carriers = [
      "src/response-verdict.ts",
      "src/errors/response-identity.ts",
      "src/errors/base-http-error.ts",
      "fixtures/channels.ts",
      "fixtures/http-server.ts",
    ].filter((file) => IGNORE.test(repoText(file)));

    expect(carriers.length).toBeGreaterThan(0);
    // And every one of them is inside a tree the coverage `include` names.
    const include = /include:\s*\[([^\]]*)\]/.exec(repoText("vitest.config.ts"));
    expect(include).not.toBeNull();
    expect(include?.[1]).toContain("src/**");
    expect(include?.[1]).toContain("fixtures/**");
  });

  test("EVIDENCE: an untested branch fails the four thresholds when nothing hides it", () => {
    // The control half. Without it the test below could be green because the
    // scratch project never measured anything.
    const project = coverageProject(
      [
        "export function pick(flag: boolean): string {",
        '  const label = "x";',
        '  if (flag) return "yes-" + label;',
        '  return "no-" + label;',
        "}",
      ].join("\n"),
    );
    try {
      const child = runVitest(project, COVERAGE_ARGV);
      expect(child.stdout).toContain("Statements   : 75%");
      expect(child.stdout).toContain("Branches     : 50%");
      expect(child.stdout + child.stderr).toContain("does not meet global threshold");
      expect(child.status).not.toBe(0);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  test("EVIDENCE: a bare `v8 ignore` range with no reason reports 100 on all four axes", () => {
    // The same untested branch, wrapped in a range that states no condition,
    // names no reason, and cites no round. The gate prints 100 / 100 / 100 /
    // 100 and exits 0.
    const project = coverageProject(
      [
        "export function pick(flag: boolean): string {",
        '  const label = "x";',
        "  /* v8 ignore start */",
        '  if (flag) return "yes-" + label;',
        "  /* v8 ignore stop */",
        '  return "no-" + label;',
        "}",
      ].join("\n"),
    );
    try {
      const child = runVitest(project, COVERAGE_ARGV);
      expect(child.stdout + child.stderr).not.toContain("does not meet global threshold");
      expect(child.stdout).toContain("Statements   : 100%");
      expect(child.stdout).toContain("Branches     : 100%");
      expect(child.stdout).toContain("Functions    : 100%");
      expect(child.stdout).toContain("Lines        : 100%");
      expect(child.status).toBe(0);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  test("some committed check reads a `v8 ignore` range and can refuse an unjustified one", () => {
    // R19-H4-03.
    //
    // Acceptance item 4 says every remaining range "carries a written
    // justification that states the exact condition that makes the line
    // unreachable", and round 5 found one such justification FALSE — which is
    // why the protocol makes a human verifier read each one. A human read is
    // not a gate. The two tests above show what the absence buys: an untested
    // branch reports 100 on all four axes and `pnpm coverage` exits 0, so the
    // whole enforcement rounds 16, 17 and 18 built is defeated by four words
    // no check ever looks at.
    // This round's own two proof files are excluded: a file that merely NAMES
    // the problem is not a check that can refuse an unjustified range.
    const readers = everySpecFile().filter(
      (file) => !OWN_PROOF_FILES.includes(file) && /v8 ignore/.test(repoText(file)),
    );

    expect(
      readers,
      "protocol section 8.6 acceptance item 4 requires every `v8 ignore` range to carry a " +
        "written justification, and no spec, no gate script and no workflow step in this " +
        "repository reads a `v8 ignore` range at all; the two EVIDENCE tests above show that a " +
        "range with no reason takes a wholly untested branch to 100/100/100/100 and exits the " +
        "coverage gate 0",
    ).not.toEqual([]);
  });
});

/**
 * A throwaway vitest project with the repository's own four thresholds, one
 * measured module holding `source`, and one spec that covers half of it.
 *
 * Nothing in the repository is read or written. The project borrows only
 * `node_modules`, by symlink.
 */
function coverageProject(source) {
  // `realpathSync`, because macOS `tmpdir()` is a symlink and vitest's
  // uncovered-file scan would then report the same module under two paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round19-h4-cov-")));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "t"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  writeFileSync(
    join(root, "vitest.config.ts"),
    [
      'import { defineConfig } from "vitest/config";',
      "export default defineConfig({",
      "  test: {",
      "    coverage: {",
      '      provider: "v8",',
      '      include: ["src/**"],',
      '      reporter: ["text"],',
      "      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },",
      "    },",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "src/m.ts"), `${source}\n`);
  writeFileSync(
    join(root, "t/m.spec.ts"),
    [
      'import { expect, test } from "vitest";',
      'import { pick } from "../src/m";',
      'test("covers one arm", () => {',
      '  expect(pick(false)).toBe("no-x");',
      "});",
      "",
    ].join("\n"),
  );
  return root;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. R19-H4-04 — the exclusion list's premise, guarded on one half only.
//
// `vitest.config.ts` drops two files from the 100 percent threshold and states
// the reason in its own comment:
//
//   "Each smoke runs under a runtime a Node worker cannot host, and CI executes
//    it under that runtime. Coverage for the two files is measured there or not
//    at all."
//
// Two committed tests pin the LIST. Nothing pins the PREMISE for
// `scripts/smoke/bun.mjs`. `scripts/gate-properties.spec.mjs` pins it for the
// Deno twin — "the Deno job runs the consumer gate and the runtime smoke after
// the build" — and the asymmetry is what this section measures.
// ═══════════════════════════════════════════════════════════════════════════

describe("R19-H4-04 — the coverage exclusion list's premise, driven against a deleted CI job", () => {
  /**
   * The repository's own roster gates, run over a root whose `ci.yml` is
   * `mutate(ci.yml)`. Answers the exit status.
   *
   * A COPY of the two spec files in a root of SYMLINKS, because each one
   * resolves the documents it reads from its own location. Copying the specs
   * and linking everything else is what lets `ci.yml` under them be a different
   * file while every other input stays the repository's own.
   */
  function rosterGateExit(mutate) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round19-h4-ci-")));
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, ".github/workflows"), { recursive: true });
      for (const spec of ["gate-properties.spec.mjs", "validate-release.spec.mjs"]) {
        copyFileSync(join(REPO_ROOT, "scripts", spec), join(root, "scripts", spec));
      }
      for (const entry of [
        "check-consumer.mjs",
        "check-deno-consumer.mjs",
        "check-doc-style.mjs",
        "check-docs.mjs",
        "lib",
        "smoke",
        "validate-release.mjs",
        "verify-pack.mjs",
      ]) {
        symlinkSync(join(REPO_ROOT, "scripts", entry), join(root, "scripts", entry));
      }
      for (const entry of [
        ".tool-versions",
        "CHANGELOG.md",
        "CONTEXT.md",
        "CONTRIBUTING.md",
        "README.md",
        "RELEASING.md",
        "SECURITY.md",
        "dist",
        "fixtures",
        "index.ts",
        "node_modules",
        "package.json",
        "src",
        "tsconfig.json",
        "vitest.config.ts",
      ]) {
        // `dist` is the one entry a clean checkout can be missing, and neither
        // gate under test reads it.
        if (existsSync(join(REPO_ROOT, entry)))
          symlinkSync(join(REPO_ROOT, entry), join(root, entry));
      }
      symlinkSync(
        join(REPO_ROOT, ".github/workflows/release.yml"),
        join(root, ".github/workflows/release.yml"),
      );
      writeFileSync(
        join(root, ".github/workflows/ci.yml"),
        mutate(repoText(".github/workflows/ci.yml")),
      );

      const child = runVitest(root, [
        "scripts/gate-properties.spec.mjs",
        "scripts/validate-release.spec.mjs",
      ]);
      expect(
        child.stdout,
        `the roster gates did not run in the copied root:\n${child.stdout}\n${child.stderr}`,
      ).toMatch(/Test Files {2}\d+ (?:passed|failed)/);
      return child.status ?? 1;
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }

  /** Remove the whole `name:` job from a workflow's `jobs:` block. */
  const dropJob = (name) => (workflow) => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    expect(start, `ci.yml must declare a ${name} job`).not.toBe(-1);
    const rest = workflow.slice(start + 1);
    const end = rest.search(/\n {2}[A-Za-z][\w-]*:\n/);
    return workflow.slice(0, start + 1) + (end === -1 ? "" : rest.slice(end + 1));
  };

  test("EVIDENCE: the harness is live — a gate removed from the test job fails the roster", () => {
    // Without this the test below could be green because the copied root never
    // ran the gates, or because `ci.yml` was never the file they read.
    expect(rosterGateExit((ci) => ci.replace("      - run: pnpm coverage\n", ""))).not.toBe(0);
  });

  test("EVIDENCE: the Deno half of the same premise IS guarded", () => {
    // `scripts/smoke/deno.ts` is excluded for the identical reason, and
    // `gate-properties.spec.mjs` asserts the deno-smoke job runs it. Removing
    // that step is red. This is the shape the Bun half is missing.
    expect(rosterGateExit((ci) => ci.replace("      - run: pnpm smoke:deno\n", ""))).not.toBe(0);
  });

  test("deleting the whole `bun-smoke` job fails some gate", () => {
    // R19-H4-04.
    //
    // `scripts/smoke/bun.mjs` is one of exactly two paths dropped from the 100
    // percent threshold, and the config's own comment gives the reason: CI
    // executes it under Bun, so coverage "is measured there or not at all".
    // Delete the job and the file is excluded from the gate AND executed by
    // nothing, in a repository whose entire coverage workstream rests on the
    // exclusion list being exactly two paths that CI still runs. The release
    // path is affected too: `release.yml` calls `ci.yml` as a reusable
    // workflow and `package` cannot start unless every job in it passes, so a
    // deleted job is a deleted release gate.
    expect(
      rosterGateExit(dropJob("bun-smoke")),
      "vitest.config.ts excludes `scripts/smoke/bun.mjs` from the 100 percent threshold " +
        "because CI executes it under Bun; deleting the entire bun-smoke job from " +
        ".github/workflows/ci.yml leaves every roster gate in this repository green, while the " +
        "identical premise for `scripts/smoke/deno.ts` is red under the same mutation",
    ).not.toBe(0);
  });

  test("EVIDENCE: the two jobs are named asymmetrically by the specs that read ci.yml", () => {
    // The static half, and the reason the mutation above survives. Among the
    // specs that read `.github/workflows/ci.yml`, one names the `deno-smoke`
    // job and none names `bun-smoke`. The token `scripts/smoke/bun.mjs` does
    // appear in two specs, and both of them read `vitest.config.ts` — the
    // LIST — never a workflow.
    // The comparison is against the gate that OWNS the roster, so a later
    // round's own proof file cannot make this read true by accident.
    const gate = repoText("scripts/gate-properties.spec.mjs");
    expect(gate).toContain("deno-smoke");
    expect(gate).not.toContain("bun-smoke");

    const readsCi = everySpecFile().filter(
      (file) =>
        !OWN_PROOF_FILES.includes(file) && /\.github\/workflows\/ci\.yml/.test(repoText(file)),
    );
    expect(readsCi.filter((file) => repoText(file).includes("bun-smoke"))).toEqual([]);
  });
});
