// Round 7, lane 3 — do the gate specs test the gates, or a mock of them?
//
// Every test here was written because a mutation survived: the defence it names
// could be removed and `vitest run scripts/` stayed green. Each one is the
// missing pin, and each was checked to fail against the mutation it describes.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { findVocabularyViolations } from "./check-doc-style.mjs";
import { readPackManifest, verifyPackManifest } from "./verify-pack.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (rel) => readFileSync(join(repoRoot, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. verify-pack — npm's entryCount is the number the count guard must read.
//
// `readPackManifest` is documented to prefer npm's own `entryCount` over the
// length of the file list, and `verify-pack.spec.mjs` says so in a comment
// ("npm reports entryCount separately; the two can disagree, and the count
// guard must trust npm"). Every fixture in that spec gives the two the SAME
// value, so replacing the whole expression with `files.length` left all 53
// tests passing. These two cases separate them.
// ---------------------------------------------------------------------------

describe("readPackManifest — npm's entryCount is the authority", () => {
  test("keeps npm's entryCount when it disagrees with the file list", () => {
    expect(readPackManifest({ files: [{ path: "LICENSE" }], entryCount: 14 })).toEqual({
      files: ["LICENSE"],
      fileCount: 14,
    });
  });

  test("the count guard then judges npm's number, not the list length", () => {
    // A 14-path list npm counted as 15. The list alone passes the ceiling; the
    // number npm reported does not, and that is the one that must decide.
    const parsed = {
      files: [
        "package.json",
        "LICENSE",
        "README.md",
        "dist/index.js",
        "dist/index.mjs",
        "dist/index.d.ts",
        "dist/index.d.mts",
        "dist/errors/index.js",
        "dist/errors/index.mjs",
        "dist/errors/index.d.ts",
        "dist/errors/index.d.mts",
        "dist/chunk-AAAA1111.mjs",
        "dist/chunk-BBBB2222.js",
        "errors/package.json",
      ].map((path) => ({ path })),
      entryCount: 15,
    };
    const manifest = readPackManifest(parsed);

    expect(manifest.files).toHaveLength(14);
    expect(manifest.fileCount).toBe(15);
    expect(() => verifyPackManifest(manifest.files, manifest.fileCount)).toThrow(
      "expected at most 14",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. check-doc-style — the LEXICAL limit, pinned.
//
// `CONTRIBUTING.md` and the gate's own header both say two limits are
// deliberate and "both pinned by a test in scripts/check-doc-style.spec.mjs".
// The "documented limits" block there pins the LINE-BY-LINE limit three times
// and the lexical one never: adding a rule that reaches the "calls" phrasing
// left all 83 tests in that spec passing. This is the missing half.
// ---------------------------------------------------------------------------

describe("the lexical limit of check-doc-style, pinned", () => {
  const doc = (source) => [{ file: "D.md", format: "markdown", source }];

  test("both orderings ARE caught when the sentence says 'request'", () => {
    expect(findVocabularyViolations(doc("It reissues requests the caller canceled."))).toEqual([
      { file: "D.md", line: 1, rule: "request-canceled", match: "requests the caller canceled" },
    ]);
    expect(findVocabularyViolations(doc("You can cancel the request."))).toEqual([
      { file: "D.md", line: 1, rule: "cancel-request", match: "cancel the request" },
    ]);
  });

  test("the same two sentences about a 'call' reach no rule at all", () => {
    // This is the limit the header names: the noun, not the meaning, is what a
    // regular expression can see. Closing it is allowed — it must arrive as a
    // deliberate edit to this test, not as a silent widening of a pattern.
    expect(findVocabularyViolations(doc("It reissues calls the caller canceled."))).toEqual([]);
    expect(findVocabularyViolations(doc("You can cancel the call."))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Importing a gate must do nothing — on BOTH streams.
//
// `check-deno-consumer.spec.mjs` has one test titled "importing the gate
// performs no pack, install, typecheck, or output". It reads stdout only, so a
// module-scope `console.error`, a module-scope scratch directory, and a
// module-scope subprocess all left it green. Widened here, and applied to every
// gate rather than to one.
// ---------------------------------------------------------------------------

const GATES = [
  "verify-pack",
  "validate-release",
  "check-docs",
  "check-doc-style",
  "check-consumer",
  "check-deno-consumer",
];

describe("importing a gate is silent on stdout AND stderr", () => {
  test.each(GATES)("scripts/%s.mjs", (gate) => {
    const url = pathToFileURL(join(repoRoot, "scripts", `${gate}.mjs`)).href;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(url)});`],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    expect(child.stdout).toBe("");
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The gates CONTRIBUTING lists are the gates CI runs, in that order — and
//    the gates RELEASING.md tells a maintainer to run, in the same order.
//
// Four rosters name the package-job gates: CONTRIBUTING.md, ci.yml,
// release.yml, and RELEASING.md. RELEASING.md carries the roster twice — once
// as "the package job … then runs:" and once as release-checklist step 2,
// "Run the exact package-job gates locally, in order". Nothing else reads all
// four together. A gate deleted from a workflow, or reordered so it runs
// before the build it needs, is invisible to every spec in this repository —
// and so is a gate RELEASING.md's rosters forgot to add.
// ---------------------------------------------------------------------------

/** The `pnpm …` lines of CONTRIBUTING's "The gates" block, in order. */
function contributingGates() {
  const block = /## The gates[\s\S]*?```bash\n([\s\S]*?)```/.exec(readRepoFile("CONTRIBUTING.md"));
  expect(block, "CONTRIBUTING.md must keep a bash block under `## The gates`").not.toBe(null);
  return block[1]
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/** The `- run:` commands of one job, in order. */
function jobRunSteps(workflow, jobName) {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  expect(start, `${jobName} must exist in the workflow`).not.toBe(-1);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n {2}[A-Za-z][\w-]*:\n/);
  const job = end === -1 ? rest : rest.slice(0, end);
  return [...job.matchAll(/- run: (.+)/g)].map((m) => m[1].trim());
}

/**
 * The numbered roster of RELEASING.md's "How publishing actually works" —
 * its description of what the release workflow's package job runs.
 */
function releasingNumberedGates() {
  return [...readRepoFile("RELEASING.md").matchAll(/^\s*\d+\. `(pnpm[^`]*)`\s*$/gm)].map(
    (m) => m[1],
  );
}

/** The bash block of RELEASING.md's release-checklist step 2, the one a maintainer types. */
function releasingLocalGates() {
  const doc = readRepoFile("RELEASING.md");
  const anchor = doc.indexOf("Run the exact package-job gates locally, in order:");
  expect(anchor, "RELEASING.md must keep the step-2 local-gate instruction").not.toBe(-1);
  const block = /```bash\n([\s\S]*?)```/.exec(doc.slice(anchor));
  expect(block, "RELEASING.md step 2 must keep a bash block").not.toBe(null);
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("the gate roster reaches CI", () => {
  test("CONTRIBUTING lists exactly the twelve gates this lane audited", () => {
    // `pnpm coverage` joined the roster in round 17, finding R17-H4-03: the
    // repository holds 100 percent on src, scripts and fixtures with a
    // threshold that enforces it, and no workflow ran that threshold, so a
    // commit that lowered coverage passed every check and published.
    expect(contributingGates()).toEqual([
      "pnpm lint",
      "pnpm format:check",
      "pnpm check-doc-style",
      "pnpm typecheck",
      "pnpm build",
      "pnpm test",
      "pnpm coverage",
      "pnpm check-docs",
      "pnpm verify-pack",
      "pnpm check-consumer",
      "pnpm audit:prod",
      "pnpm run audit:ci",
    ]);
  });

  test("the release job runs every one of them, in CONTRIBUTING's order", () => {
    const steps = jobRunSteps(readRepoFile(".github/workflows/release.yml"), "package");
    expect(steps.filter((step) => contributingGates().includes(step))).toEqual(contributingGates());
  });

  test("CI runs the same gates, with the two audits in their own job", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    const audits = ["pnpm audit:prod", "pnpm run audit:ci"];
    const expected = contributingGates().filter((gate) => !audits.includes(gate));

    expect(jobRunSteps(ci, "test").filter((step) => expected.includes(step))).toEqual(expected);
    expect(jobRunSteps(ci, "security").filter((step) => audits.includes(step))).toEqual(audits);
  });

  test("the Deno job runs the consumer gate and the runtime smoke after the build", () => {
    const steps = jobRunSteps(readRepoFile(".github/workflows/ci.yml"), "deno-smoke");
    expect(steps.indexOf("pnpm build")).toBeLessThan(steps.indexOf("pnpm check-deno-consumer"));
    expect(steps).toContain("pnpm smoke:deno");
  });

  test("RELEASING's two rosters carry the same twelve gates, in the same order", () => {
    // R18-H4-01, second half. `scripts/gate-properties.spec.mjs` reads
    // CONTRIBUTING.md, ci.yml, and release.yml together, and its own section
    // header said "the three lists" — but RELEASING.md is a FOURTH roster,
    // read nowhere. Round 17 added `pnpm coverage` to the other three and left
    // both of RELEASING.md's lists a gate short, so this test alone would have
    // caught it.
    const roster = contributingGates();

    expect(releasingNumberedGates()).toEqual(roster);
    expect(releasingLocalGates()).toEqual(roster);
  });

  test("every gate CI invokes is a real package script", () => {
    const scripts = JSON.parse(readRepoFile("package.json")).scripts;
    const ci = readRepoFile(".github/workflows/ci.yml");
    const release = readRepoFile(".github/workflows/release.yml");
    const invoked = new Set();
    for (const workflow of [ci, release]) {
      for (const m of workflow.matchAll(/- run: pnpm (?:run )?([\w:-]+)$/gm)) invoked.add(m[1]);
    }
    invoked.delete("install");

    for (const name of invoked)
      expect(scripts, `package.json must define ${name}`).toHaveProperty(name);
  });
});
