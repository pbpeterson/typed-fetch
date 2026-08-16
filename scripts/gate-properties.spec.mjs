// Round 7, lane 3 — do the gate specs test the gates, or a mock of them?
//
// Every test here was written because a mutation survived: the defence it names
// could be removed and `vitest run scripts/` stayed green. Each one is the
// missing pin, and each was checked to fail against the mutation it describes.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { findVocabularyViolations } from "./check-doc-style.mjs";
import { validateRelease } from "./validate-release.mjs";
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

/**
 * A `- run:` step CI actually runs: the sequence must START the line, so a step
 * commented OUT with YAML's `#` is not read back as a step (R20-H4-01). An
 * unanchored read let `      # - run: pnpm coverage` yield `pnpm coverage`, and
 * five gates below rest on this reader and on `ciCommands`.
 */
const RUN_STEP = /^\s*- run: (.+)$/;

/**
 * The sibling keys that stop a step from being a gate. `if:` decides whether the
 * step runs at all, and `continue-on-error:` decides whether its failure fails
 * the job; a step carrying either one is not a step the roster may count.
 */
const DISABLING_KEYS = new Set(["if", "continue-on-error"]);

/**
 * The name of the mapping key `line` opens, or null where it opens none.
 *
 * ONE READER FOR BOTH ROSTERS, which is R23-H4-02. A step's keys were read with
 * `const key = /^([\w-]+):/.exec(line.slice(open.indent + 2));` and a job's with
 * `/^ {4}([\w-]+):/gm`, and both spell a mapping key as a BARE word. YAML lets
 * any key be quoted, and `"if"` and `if` are the same key, so one pair of
 * quotation marks hid the condition from every roster while GitHub Actions read
 * the identical mapping and skipped the step — under `- run: pnpm verify-pack`
 * in the `package` job of `release.yml`, the job that runs immediately before
 * `npm publish`, and on the job that executes the Bun smoke one level out. That
 * is R21-H4-01 and R21-ORCH-01 at a spelling neither closed, and the family's
 * sixteenth appearance. Both readers now ask this one function, so a spelling
 * taught here is a spelling both rosters read.
 */
function mappingKey(line) {
  const key = /^(?:"([\w-]+)"|'([\w-]+)'|([\w-]+))\s*:/.exec(line);
  return key === null ? null : (key[1] ?? key[2] ?? key[3]);
}

/**
 * The steps of `region`, each as the line it OPENS on plus the keys written
 * under it at the step's own key indentation.
 *
 * A step is a YAML BLOCK, not a line. R21-H4-01: an anchored line read answers
 * what a step WOULD run and never whether it runs, so one appended `if: false`
 * under `- run: pnpm verify-pack` skipped the gate that refuses a code-less
 * tarball with the release roster green — the smaller edit that `#` used to be.
 *
 * R22-H4-02: a YAML COMMENT is not structure, so it does not close the block
 * either. The reader closed a step at the first line short of the step's key
 * indentation, and a `#` line is such a line, so one comment written between
 * `- run: pnpm verify-pack` and the `if: false` under it hid that condition
 * from every roster while GitHub Actions read the same one step mapping and
 * skipped it. A comment is skipped exactly as a blank line already was.
 */
function stepBlocks(region) {
  const blocks = [];
  let open = null;
  for (const line of region.split("\n")) {
    const item = /^( *)- /.exec(line);
    if (item !== null && (open === null || item[1].length <= open.indent)) {
      open = { indent: item[1].length, opener: line, keys: [] };
      blocks.push(open);
      continue;
    }
    if (open === null || line.trim() === "" || line.trim().startsWith("#")) continue;
    // Anything indented past the dash belongs to the step; the next key of the
    // job, written at a shallower indentation, closes it.
    if (!line.startsWith(" ".repeat(open.indent + 2))) {
      open = null;
      continue;
    }
    const key = mappingKey(line.slice(open.indent + 2));
    if (key !== null) open.keys.push(key);
  }
  return blocks;
}

/**
 * The commands of the `- run:` steps `region` runs unconditionally and whose
 * failure fails the job, in order. The command is still read from the anchored
 * opening line; the block around it is what says the step runs at all.
 */
function runCommands(region) {
  return stepBlocks(region).flatMap((step) => {
    const command = RUN_STEP.exec(step.opener);
    if (command === null || step.keys.some((key) => DISABLING_KEYS.has(key))) return [];
    return [command[1].trim()];
  });
}

/**
 * The jobs `body` declares it `needs:`, in every spelling YAML accepts. There
 * are four: a scalar (`needs: one`), a flow sequence closed on the key's own
 * line (`needs: [one, two]`), a flow sequence broken across lines, and a block
 * sequence written under the key — whose items may sit at the KEY's own
 * indentation or at any deeper one, both being the same sequence. Read at the
 * JOB's own key indentation, as `disabling` is.
 *
 * R23-H4-01: this comment used to say the reader read `needs:`
 * "in each of the three spellings YAML accepts", and YAML accepts more than
 * three. The block walk was `const item = /^ {5,}- *(.+)$/.exec(line);` — five
 * spaces, one past the four the key itself is written at — so `needs:` followed by
 * `    - preflight` broke on its first line and answered NO dependencies, and a
 * flow sequence broken across lines lost its names to that same walk after the
 * inline read stripped the bracket and found nothing. Both are ordinary YAML
 * and both are what GitHub Actions receives, so R22-H4-01's transitive closure
 * closed over nothing and the job that runs the Bun smoke was skipped behind a
 * job written `if: false` with every roster green. The family's fifteenth
 * appearance.
 *
 * A flow sequence is read to its closing bracket rather than by indentation,
 * because a flow sequence is not indentation-structured; an unclosed one yields
 * the rest of the job as names, which name no declared job, so `runningJobs`
 * refuses the job rather than reading a roster out of it.
 */
function jobNeeds(body) {
  const names = (value) =>
    value
      .replace(/\s+#.*$/, "")
      .replaceAll(/[[\]"']/g, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  const lines = body.split("\n");
  const at = lines.findIndex((line) => /^ {4}needs:/.test(line));
  if (at === -1) return [];
  const opener = lines[at].slice(lines[at].indexOf(":") + 1);
  if (opener.includes("[") && !opener.includes("]")) {
    const flow = [opener];
    for (const line of lines.slice(at + 1)) {
      flow.push(line);
      if (line.includes("]")) break;
    }
    return names(flow.join(" "));
  }
  const inline = names(opener);
  if (inline.length > 0) return inline;
  const sequence = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const item = /^ {4,}- *(.+)$/.exec(line);
    if (item === null) break;
    sequence.push(...names(item[1]));
  }
  return sequence;
}

/**
 * The jobs of `workflow`, in order, each as its name, its body, the jobs it
 * `needs:`, and the disabling keys written at the JOB's own key indentation.
 *
 * ASKED OF EVERY JOB, WHICH IS R21-ORCH-01. `if:` on a job skips every step in
 * it and `continue-on-error:` on a job discards every failure those steps
 * report, so a roster read out of such a job is a roster of steps that need not
 * run. Round 21 taught {@link runCommands} to ask that of a STEP, and taught
 * `jobRunSteps` to ask it of the jobs it is handed a NAME for — but the
 * coverage-exclusion premise and the runtime roster read the workflow whole,
 * with no job-level question anywhere in them. One `if: false` on the job that
 * runs the Bun smoke therefore left every gate here green with the smoke never
 * executing, which is R19-H4-04's own state restored one level out. The
 * question is asked ONCE, of every job, rather than by whichever reader happens
 * to name one.
 */
function workflowJobs(workflow) {
  const region = workflow.slice(workflow.indexOf("\njobs:\n") + 1);
  const opens = [...region.matchAll(/^ {2}([A-Za-z][\w-]*):$/gm)];
  return opens.map((open, index) => {
    const body = region.slice(open.index, opens[index + 1]?.index);
    return {
      name: open[1],
      body,
      needs: jobNeeds(body),
      disabling: body
        .split("\n")
        .filter((line) => /^ {4}\S/.test(line))
        .map((line) => mappingKey(line.slice(4)))
        .filter((key) => key !== null && DISABLING_KEYS.has(key)),
    };
  });
}

/**
 * The jobs of `workflow` that RUN — the only ones a roster may read out of.
 *
 * TRANSITIVELY, which is R22-H4-01. A job runs when it carries no disabling key
 * AND every job it `needs:` runs, because GitHub Actions skips a job whose
 * dependency was skipped. Round 21 taught this reader to ask a job for its OWN
 * `if:` and `continue-on-error:`, and nothing asked about the chain: one
 * `if: false` on an added job, plus one `needs:` line on the job that executes
 * `scripts/smoke/bun.mjs`, skipped that smoke with the coverage-exclusion
 * premise and both runtime rosters green. R19-H4-04's own state, two levels out
 * and the family's fourteenth appearance.
 *
 * A `needs:` naming a job the workflow does not declare is not a dependency
 * that runs, and neither is a cycle: GitHub refuses both workflows outright, so
 * neither may hand a roster a command.
 */
function runningJobs(workflow) {
  const jobs = workflowJobs(workflow);
  const declared = new Map(jobs.map((job) => [job.name, job]));
  const answers = new Map();
  const runs = (job) => {
    const answered = answers.get(job.name);
    if (answered !== undefined) return answered;
    answers.set(job.name, false);
    const answer =
      job.disabling.length === 0 &&
      job.needs.every((name) => declared.has(name) && runs(declared.get(name)));
    answers.set(job.name, answer);
    return answer;
  };
  return jobs.filter((job) => runs(job));
}

/** The `- run:` commands of one job, in order, refusing a job that need not run. */
function jobRunSteps(workflow, jobName) {
  const job = workflowJobs(workflow).find((candidate) => candidate.name === jobName);
  expect(job, `${jobName} must exist in the workflow`).toBeDefined();
  expect(
    runningJobs(workflow).map((candidate) => candidate.name),
    `the ${jobName} job need not run — it carries a condition of its own, or it \`needs:\` a job ` +
      "that need not run — so every gate this roster reads out of it may be skipped or may fail " +
      "without failing the job",
  ).toContain(jobName);
  return runCommands(job.body);
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

/**
 * A two-job workflow whose `downstream` job carries `keys` above its `runs-on:`.
 *
 * The job names here are the fixture's own, and deliberately not a real job's:
 * `scripts/gate-mutation-ignore-ranges.spec.mjs` reads every spec that names a job of
 * `ci.yml`, so a fixture that borrowed a real name would answer that read.
 */
const workflowWith = (...keys) =>
  [
    "name: CI",
    "",
    "jobs:",
    "  preflight:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo preflight",
    "",
    "  downstream:",
    ...keys,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo downstream",
    "",
  ].join("\n");

/** Whether `downstream` is a job the rosters above may read a command out of. */
const downstreamRuns = (workflow) => runningJobs(workflow).some((job) => job.name === "downstream");

/** Every spelling of `needs: preflight` YAML accepts, as the lines it is written on. */
const NEEDS_SPELLINGS = {
  "a scalar": ["    needs: preflight"],
  "a flow sequence on the key's own line": ["    needs: [preflight]"],
  "a flow sequence broken across lines": ["    needs: [", "      preflight", "    ]"],
  "a block sequence at the key's own indentation": ["    needs:", "    - preflight"],
  "a block sequence indented under the key": ["    needs:", "      - preflight"],
};

/** Every spelling of a disabling key YAML accepts, at a job's key indentation. */
const DISABLING_SPELLINGS = [
  "    if: false",
  '    "if": false',
  "    'if': false",
  "    continue-on-error: true",
  '    "continue-on-error": true',
];

describe("the workflow readers, at every spelling YAML accepts", () => {
  // R23-H4-01 and R23-H4-02. `scripts/gate-mutation-yaml-spellings.spec.mjs` drives both
  // through mutated copies of the real workflows, and that is the proof that
  // matters. These rows name the spelling itself, so a reader that loses one
  // fails here with the spelling in the message instead of as an exit code.

  test("CONTROL: with neither key nor dependency, the job supplies a roster", () => {
    expect(downstreamRuns(workflowWith())).toBe(true);
  });

  test.each(Object.keys(NEEDS_SPELLINGS))(
    "`needs:` written as %s is one dependency",
    (spelling) => {
      expect(workflowJobs(workflowWith(...NEEDS_SPELLINGS[spelling])).at(-1).needs).toEqual([
        "preflight",
      ]);
    },
  );

  test.each(Object.keys(NEEDS_SPELLINGS))("and a skipped dependency stops it: %s", (spelling) => {
    const workflow = workflowWith(...NEEDS_SPELLINGS[spelling]);
    expect(downstreamRuns(workflow)).toBe(true);
    expect(
      downstreamRuns(workflow.replace("  preflight:\n", "  preflight:\n    if: false\n")),
    ).toBe(false);
  });

  test.each(DISABLING_SPELLINGS)("a job carrying `%s` supplies no roster", (key) => {
    expect(downstreamRuns(workflowWith(key))).toBe(false);
  });

  test.each(DISABLING_SPELLINGS)("and the same key under a step drops that step: `%s`", (key) => {
    const region = ["      - run: pnpm verify-pack", `    ${key}`, "      - run: pnpm build"].join(
      "\n",
    );
    expect(runCommands(region)).toEqual(["pnpm build"]);
  });
});

describe("the gate roster reaches CI", () => {
  test("CONTRIBUTING lists exactly the twelve gates this lane audited", () => {
    // `pnpm coverage` joined the roster in round 17, finding R17-H4-03: the
    // repository holds 100 percent on src, scripts and fixtures with a
    // threshold that enforces it, and no workflow ran that threshold, so a
    // commit that lowered coverage passed every check and published.
    //
    // `build` moved AHEAD of `typecheck` after run 31920651241 failed on all
    // three Node versions with eight TS2307s. Two surface specs name the
    // package in a type position, which TypeScript resolves by SELF-REFERENCE
    // through this package's own `exports` map to `dist/*.d.ts`, so `typecheck`
    // needs the build the roster used to run after it. This list is the
    // canonical order the other rows in this describe read, so the four
    // documents that carry the roster move with it, in one commit.
    expect(contributingGates()).toEqual([
      "pnpm lint",
      "pnpm format:check",
      "pnpm check-doc-style",
      "pnpm build",
      "pnpm typecheck",
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
      for (const m of workflow.matchAll(/^\s*- run: pnpm (?:run )?([\w:-]+)$/gm)) invoked.add(m[1]);
    }
    invoked.delete("install");

    for (const name of invoked)
      expect(scripts, `package.json must define ${name}`).toHaveProperty(name);
  });
});

// ---------------------------------------------------------------------------
// 5. The coverage exclusion list's PREMISE, and the runtime roster it rests on.
//
// `vitest.config.ts` drops two files from the 100 percent threshold and states
// its reason in its own comment: "CI executes it under that runtime. Coverage
// for the two files is measured there or not at all." Two committed tests pin
// that LIST. The PREMISE was pinned for the Deno half only — section 4 above
// asserts the Deno job runs its smoke — so deleting the OTHER smoke job left
// every roster gate here green, with the excluded file measured by nothing and
// executed by nothing (R19-H4-04). The release path inherits it: `release.yml`
// calls `ci.yml` as a reusable workflow, so a deleted job is a deleted gate.
//
// The runtime roster is the same defect one layer out (R19-H4-02): CI declares
// three runtime smokes, CONTRIBUTING.md named two, RELEASING.md named three,
// and no gate read either list.
// ---------------------------------------------------------------------------

/**
 * The paths `vitest.config.ts` drops from the coverage threshold.
 *
 * Read out of the COVERAGE block, not out of the file. The config carries more
 * than one `exclude:` array — the project split has its own — and a reader that
 * takes the first match answers about whichever array is written higher up. It
 * then reports a coverage exclusion that is not one, which is the R16-ORCH-01
 * shape: a check whose assertion reads something other than what it guards.
 */
function coverageExclusions() {
  const config = readRepoFile("vitest.config.ts");
  const coverageAt = config.indexOf("coverage: {");
  expect(coverageAt, "vitest.config.ts must keep a `coverage` block").toBeGreaterThan(-1);
  const list = /exclude:\s*\[([^\]]*)\]/.exec(config.slice(coverageAt));
  expect(list, "vitest.config.ts must keep a coverage `exclude` list").not.toBe(null);
  return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Every command CI runs, each `pnpm <script>` also expanded to the body it runs.
 *
 * READ OUT OF THE JOBS THAT RUN, never out of the file. A command in a job
 * `if: false` skips is a command CI does not run, and this is the list the
 * coverage-exclusion premise below rests on.
 */
function ciCommands() {
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  return runningJobs(readRepoFile(".github/workflows/ci.yml"))
    .flatMap((job) => runCommands(job.body))
    .flatMap((command) => {
      const invoked = /^pnpm (?:run )?([\w:-]+)$/.exec(command);
      const body = invoked ? scripts[invoked[1]] : undefined;
      return body === undefined ? [command] : [command, body];
    });
}

/**
 * The runtime each `…-smoke` job in `ci.yml` exercises, by the job's prefix.
 *
 * A DECLARED JOB IS NOT A JOB THAT RUNS, which is the other half of
 * R21-ORCH-01. Both contributor rosters are read against this list, so a job
 * disabled at the job level had every document still telling a reader that CI
 * smokes a runtime nothing executes.
 */
function ciSmokeRuntimes() {
  return runningJobs(readRepoFile(".github/workflows/ci.yml")).flatMap((job) => {
    const smoke = /^([\w-]+)-smoke$/.exec(job.name);
    return smoke === null ? [] : [smoke[1]];
  });
}

/**
 * How the two contributor documents spell each runtime CI smokes, keyed by the
 * job prefix read from `ci.yml`. A smoke job added without a spelling here
 * fails the first test below rather than passing it unread.
 */
const RUNTIME_SPELLING = { bun: "Bun", deno: "Deno", "node-min": "Node-floor" };

/**
 * The one sentence in each contributor document that tells a reader which
 * runtimes CI smokes.
 *
 * R20-H4-02: reading the WHOLE document for the word `Bun` passes on any stray
 * mention — CONTRIBUTING.md spells it again in a paragraph about which runtime
 * locks a stream on `getReader()` — so the roster sentence itself could be
 * deleted with every gate green. The sentence is the roster; the word is not.
 * A document that loses its sentence fails here rather than reading as a
 * document that never claimed anything.
 */
const RUNTIME_ROSTER_SENTENCE = {
  "CONTRIBUTING.md": /CI additionally runs\b[\s\S]*?runtime smokes\./,
  "RELEASING.md": /Its Node 20\/22\/24,[\s\S]*?must all pass before the package job can start\./,
};

/** That sentence, on one line, or a failure naming the document that lost it. */
function runtimeRoster(file) {
  const found = RUNTIME_ROSTER_SENTENCE[file].exec(readRepoFile(file));
  expect(
    found,
    `${file} must keep the sentence that tells a reader which runtimes CI smokes. Reading the ` +
      "whole document for a runtime's name passes on an unrelated mention of it, so the roster " +
      "is read as a sentence and deleting the sentence is the failure",
  ).not.toBe(null);
  return found[0].replaceAll(/\s+/g, " ");
}

/**
 * The runtime binary each excluded path must be INVOKED by. The exclusion's own
 * premise in `vitest.config.ts` is that each smoke "runs under a runtime a Node
 * worker cannot host, and CI executes it under that runtime", so the gate must
 * read an execution BY that runtime. R20-H4-05: asking whether some `- run:`
 * line merely CONTAINS the path is satisfied by `node scripts/smoke/bun.mjs`
 * and by `echo "skipping scripts/smoke/bun.mjs"`, and both leave the file
 * excluded from the threshold and executed by no Bun.
 *
 * R21-H4-02: an invocation is not an execution either, unless the step carrying
 * it runs. `ciCommands` reads a step as a block for that reason, so a step
 * disabled with `if: false` contributes no command here.
 */
const EXCLUSION_RUNTIME = {
  "scripts/smoke/bun.mjs": "bun",
  "scripts/smoke/deno.ts": "deno",
};

/** Whether `command` runs `binary` with `path` as one of its arguments. */
function invokesUnder(command, binary, path) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .some((tokens) => tokens[0] === binary && tokens.slice(1).includes(path));
}

describe("the runtime jobs the coverage exclusion list rests on", () => {
  test("every file dropped from the coverage threshold is run by the runtime that premise names", () => {
    const commands = ciCommands();
    for (const path of coverageExclusions()) {
      const binary = EXCLUSION_RUNTIME[path];
      expect(
        binary,
        `no runtime binary is pinned for ${path}, so nothing states which runtime the exclusion ` +
          "premise rests on",
      ).toBeDefined();
      expect(
        commands.some((command) => invokesUnder(command, binary, path)),
        `vitest.config.ts drops ${path} from the 100 percent threshold because CI executes it ` +
          `under ${binary}, so coverage for it is measured there or not at all; no step in ` +
          `.github/workflows/ci.yml passes that path to \`${binary}\`, which leaves it measured ` +
          "by nothing and executed by nothing. Naming the path in a step is not running it: " +
          "this reads the invocation",
      ).toBe(true);
    }
  });

  test("both contributor rosters name every runtime CI smokes", () => {
    const contributing = runtimeRoster("CONTRIBUTING.md");
    const releasing = runtimeRoster("RELEASING.md");
    for (const runtime of ciSmokeRuntimes()) {
      const word = RUNTIME_SPELLING[runtime];
      expect(word, `no document spelling is recorded for the ${runtime} smoke job`).toBeDefined();
      expect(
        contributing,
        `CONTRIBUTING.md's runtime roster sentence must name the ${runtime} smoke`,
      ).toContain(word);
      expect(
        releasing,
        `RELEASING.md's runtime roster sentence must name the ${runtime} smoke`,
      ).toContain(word);
    }
  });

  test("and neither roster names a runtime CI no longer smokes", () => {
    // The other direction, and the one a deleted job needs: dropping a smoke
    // job from `ci.yml` leaves both documents telling a reader that CI runs it.
    const runtimes = ciSmokeRuntimes();
    const rosters = `${runtimeRoster("CONTRIBUTING.md")}\n${runtimeRoster("RELEASING.md")}`;
    for (const [runtime, word] of Object.entries(RUNTIME_SPELLING)) {
      expect(
        rosters.includes(word),
        `CONTRIBUTING.md or RELEASING.md names the ${runtime} runtime smoke and ` +
          ".github/workflows/ci.yml declares no job that runs it",
      ).toBe(runtimes.includes(runtime));
    }
  });
});

// ---------------------------------------------------------------------------
// 6. `v8 ignore` — protocol section 8.6 acceptance item 4, read by a check.
//
// A `v8 ignore` range removes its lines from the DENOMINATOR of the same 100
// percent threshold the release gate enforces, so a range that states no
// condition takes a wholly untested `if` from 75 percent statements and 50
// percent branches to 100 on all four axes, with `pnpm coverage` exiting 0.
// `scripts/gate-mutation-ignore-ranges.spec.mjs` drives that in a throwaway project.
//
// Item 4 requires every remaining range to carry a written justification, and
// until R19-H4-03 no spec, no gate script and no workflow step read a range at
// all. This reads PRESENCE, never truth: round 5 of this audit found a
// justification that was FALSE and no pattern can tell. The site pin is what
// makes a NEW range a reviewable diff instead of a silent widening.
// ---------------------------------------------------------------------------

/**
 * How the instrumenter spells an ignore hint, in the instrumenter's OWN words.
 *
 * R21-H4-03: vitest's v8 provider remaps through `ast-v8-to-istanbul`, whose
 * hint patterns are
 *
 *   /^\s*(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(if|else|next|file)(?=\W|$)/
 *   /\s*(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(start|stop)(?=\W|$)/
 *
 * so `c8 ignore`, `istanbul ignore` and `node:coverage ignore` take their lines
 * out of the SAME denominator the release gate enforces. Reading the four
 * characters `v8 i` read one spelling of four, and the other three bought a
 * false 100 on all axes with this whole section blind to them.
 */
const IGNORE_HINT = String.raw`(?:istanbul|[cv]8|node:coverage)\s+ignore`;

/** An ignore hint in any spelling, opening or closing. */
const IGNORE_ANY = new RegExp(IGNORE_HINT);

/** An ignore directive that OPENS a range, never the one that closes it. */
const IGNORE_DIRECTIVE = new RegExp(String.raw`${IGNORE_HINT}(?!\s+stop\b)`);

/**
 * The directive that CLOSES a range — the end of what leaves the denominator.
 *
 * `stop`, and nothing else. R21-H4-04: the instrumenter accepts `start|stop`,
 * so a range closed with `end` is an UNCLOSED range whose lines run to the end
 * of the file. Accepting `end` here computed the one-line span its author wrote
 * for a range that had swallowed everything below it, and the pin written to
 * refuse `a silent widening` reported no widening at all. An `end` line now
 * reads as what the instrumenter reads it as: not a close, and — carrying a
 * hint that is not `stop` — the opening of a further unclosed range.
 */
const IGNORE_STOP = new RegExp(String.raw`${IGNORE_HINT}\s+stop\b`);

/** The shortest justification this check accepts, in characters of prose. */
const JUSTIFICATION_FLOOR = 40;

/**
 * The `v8 ignore` sites under measurement, each as
 * `file → the first line it guards (how many lines the range spans, in which
 * spelling)`.
 *
 * R21-H4-03: the SPELLING is pinned beside the span, because `c8 ignore`,
 * `istanbul ignore` and `node:coverage ignore` remove the same lines from the
 * same denominator. Rewriting a range into one of them is then a reviewable
 * diff here rather than an edit no gate reads.
 *
 * R20-H4-03: the span is pinned because a range can be widened without moving
 * anything else. `IGNORE_DIRECTIVE` skips the `stop` marker by design, so
 * pushing that marker down took a range from one line to three — three lines
 * out of the denominator instead of one — with the file, the opening line, the
 * guarded line, and the justification all byte-identical. The pin exists to
 * make a range edit a reviewable diff instead of a silent widening, and a
 * widening it cannot see is exactly the silent one.
 */
const IGNORE_SITES = [
  'fixtures/channels.ts → "1 JSON.stringify in a log envelope": (2-line `v8 ignore` range)',
  'fixtures/http-server.ts → res.setHeader("X-Echo-Method", req.method ?? ""); (1-line `v8 ignore` range)',
  "src/errors/base-http-error.ts → const revokeLoan = identity ? lendIdentity(teed.branch, identity) : undefined; (1-line `v8 ignore` range)",
  "src/errors/response-identity.ts → const code = character.codePointAt(0) ?? 0; (1-line `v8 ignore` range)",
  "src/response-verdict.ts → if (!validatedResponseStructures.has(response)) return false; (1-line `v8 ignore` range)",
  "src/response-verdict.ts → if (refusedTheValue) rollbackRefusal(); (1-line `v8 ignore` range)",
];

/**
 * Every extension the v8 coverage provider instruments. R20-H4-04: the walker
 * accepted `.ts` and `.mjs` only, while `vitest.config.ts` includes `src/**`,
 * `scripts/**` and `fixtures/**` with no extension filter — so a range in a
 * measured `.mts`, `.cts`, `.js`, `.cjs`, `.tsx` or `.jsx` file left lines out
 * of the same denominator and was read by nothing here.
 */
const MEASURED_EXTENSION = /\.[cm]?[jt]sx?$/;

/** Every measured source file under `rel`. Spec files are not measured. */
function measuredSources(rel, found = []) {
  for (const name of readdirSync(join(repoRoot, rel))) {
    const next = `${rel}/${name}`;
    if (statSync(join(repoRoot, next)).isDirectory()) measuredSources(next, found);
    else if (MEASURED_EXTENSION.test(name) && !/\.spec\.[cm]?[jt]sx?$/.test(name)) found.push(next);
  }
  return found;
}

/**
 * Every ignore range in `source`: the line it opens on, the first line it
 * guards, how many lines it spans, the spelling of the hint that opens it, and
 * the comment block written directly above it.
 */
function ignoreRanges(source) {
  const lines = source.split("\n");
  const ranges = [];
  for (const [index, line] of lines.entries()) {
    if (!IGNORE_DIRECTIVE.test(line)) continue;
    let above = index - 1;
    let justification = "";
    while (
      above >= 0 &&
      /^\s*(?:\/\/|\/?\*)/.test(lines[above]) &&
      !IGNORE_ANY.test(lines[above])
    ) {
      justification = `${lines[above].replace(/^\s*(?:\/\/+|\/?\*+\/?)\s*/, "")} ${justification}`;
      above -= 1;
    }
    ranges.push({
      line: index + 1,
      guards: (lines[index + 1] ?? "").trim(),
      span: ignoreSpan(lines, index),
      spelling: IGNORE_ANY.exec(line)[0].replaceAll(/\s+/g, " "),
      justification: justification.trim(),
    });
  }
  return ranges;
}

/**
 * How many lines the range opened on `lines[index]` takes out of the coverage
 * denominator: the count between the directive and its `stop`, or the count a
 * `next` directive states, or `"unclosed"` when no `stop` follows it.
 */
function ignoreSpan(lines, index) {
  const next = new RegExp(String.raw`${IGNORE_HINT}\s+next\s*(\d*)`).exec(lines[index]);
  if (next) return next[1] === "" ? 1 : Number(next[1]);
  const closesAt = lines.findIndex((line, at) => at > index && IGNORE_STOP.test(line));
  return closesAt === -1 ? "unclosed" : closesAt - index - 1;
}

describe("every `v8 ignore` range acceptance item 4 covers", () => {
  /** Every range in the trees the coverage `include` names. */
  const sites = () =>
    ["src", "fixtures", "scripts"]
      .flatMap((tree) => measuredSources(tree))
      .flatMap((file) => ignoreRanges(readRepoFile(file)).map((range) => ({ file, ...range })));

  test("the measured trees hold exactly the sites this round read", () => {
    expect(
      sites()
        .map(
          (site) => `${site.file} → ${site.guards} (${site.span}-line \`${site.spelling}\` range)`,
        )
        .toSorted(),
      "an ignore range was added, moved, removed, WIDENED, or RESPELLED. Every range removes its " +
        "lines from the denominator of the 100 percent threshold, so the list is pinned by site, " +
        "by how many lines the range spans, and by which of the four spellings the instrumenter " +
        "accepts opens it, and an edit to any of them belongs in the diff a reviewer reads",
    ).toEqual(IGNORE_SITES.toSorted());
  });

  test("each one carries a written justification directly above it", () => {
    for (const site of sites()) {
      expect(
        site.justification.length,
        `${site.file}:${site.line} opens a \`${site.spelling}\` range with no reason above it. ` +
          "Acceptance item 4 requires a written justification naming the exact condition that " +
          "makes the line unreachable. This check proves the sentence is THERE, never that it " +
          "is true — round 5 found one that was false",
      ).toBeGreaterThanOrEqual(JUSTIFICATION_FLOOR);
    }
  });

  test("BREAKING IT: the bare range that buys a false 100 percent is refused", () => {
    // The mutation, in the exact shape `scripts/gate-mutation-ignore-ranges.spec.mjs` runs
    // through a project carrying this repository's own four thresholds: the
    // untested arm reports 100/100/100/100 and the coverage gate exits 0.
    const bare = [
      "export function pick(flag: boolean): string {",
      '  const label = "x";',
      "  /* v8 ignore start */",
      '  if (flag) return "yes-" + label;',
      "  /* v8 ignore stop */",
      '  return "no-" + label;',
      "}",
    ].join("\n");

    expect(ignoreRanges(bare)).toEqual([
      {
        line: 3,
        guards: 'if (flag) return "yes-" + label;',
        span: 1,
        spelling: "v8 ignore",
        justification: "",
      },
    ]);
    expect(ignoreRanges(bare)[0].justification.length).toBeLessThan(JUSTIFICATION_FLOOR);

    // R21-H4-03. The same range in a spelling the instrumenter accepts and the
    // reader did not: `c8 ignore` takes the same line out of the same
    // denominator, and reading `v8 i` read one spelling of four.
    expect(ignoreRanges(bare.replaceAll("v8 ignore", "c8 ignore"))).toEqual([
      {
        line: 3,
        guards: 'if (flag) return "yes-" + label;',
        span: 1,
        spelling: "c8 ignore",
        justification: "",
      },
    ]);

    // R21-H4-04. `stop` is the only keyword that closes a range. Spelled `end`,
    // the range never closes and runs to the end of the file, and the `end`
    // line — a hint that is not `stop` — opens a second unclosed range.
    expect(
      ignoreRanges(bare.replace("v8 ignore stop", "v8 ignore end")).map((range) => ({
        line: range.line,
        span: range.span,
      })),
    ).toEqual([
      { line: 3, span: "unclosed" },
      { line: 5, span: "unclosed" },
    ]);

    // R20-H4-03. The same range with its `stop` one line lower is a DIFFERENT
    // range: two lines leave the denominator instead of one. The directive, the
    // guarded line, and the justification do not move, so the span is the only
    // thing that says so, and the site pin above reads it.
    const widened = bare.replace(
      '  /* v8 ignore stop */\n  return "no-" + label;',
      '  return "no-" + label;\n  /* v8 ignore stop */',
    );
    expect(ignoreRanges(widened)[0]).toMatchObject({
      line: 3,
      guards: 'if (flag) return "yes-" + label;',
      span: 2,
    });

    // The same range with a stated condition above it passes the same read, so
    // the check refuses the omission and not the directive.
    const justified = bare.replace(
      "  /* v8 ignore start */",
      "  // UNREACHABLE: every call site in this module passes `false` for `flag`.\n" +
        "  /* v8 ignore start */",
    );
    expect(ignoreRanges(justified)[0].justification).toBe(
      "UNREACHABLE: every call site in this module passes `false` for `flag`.",
    );
  });
});

// ---------------------------------------------------------------------------
// 7. validate-release — the DESTINATION half of RELEASING.md step 1.
//
// R22-H4-03. Step 1 tells a maintainer to MOVE the pending entries into
// `## [X.Y.Z] - YYYY-MM-DD` and leave `[Unreleased]` empty. The only gate
// between a git tag and `npm publish` enforced the SOURCE half and asked the
// destination for a dated heading alone, so a release that DELETED the block
// instead of moving it published a section describing nothing — with semver
// rule 8's direction obligation resting on a differential that reads
// `[Unreleased]`, which the same gate has just required to be empty.
//
// Both rows below run the refusal in this process. The end-to-end proof is
// `scripts/gate-mutation-skipped-jobs.spec.mjs`, which drives the gate as a subprocess
// inside a scratch git repository, and no subprocess reaches the v8 instrument.
// ---------------------------------------------------------------------------

const COMPARE = "https://github.com/pbpeterson/typed-fetch/compare";

/** A release of 1.0.0 whose dated section holds `body`, and nothing else wrong. */
const releaseCandidate = (body) => ({
  tag: "v1.0.0",
  refType: "tag",
  packageName: "@pbpeterson/typed-fetch",
  version: "1.0.0",
  repositoryUrl: "git+https://github.com/pbpeterson/typed-fetch.git",
  publishAccess: "public",
  provenance: true,
  changelog:
    `# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-07-17\n${body}\n` +
    `[Unreleased]: ${COMPARE}/v1.0.0...HEAD\n[1.0.0]: ${COMPARE}/v0.8.1...v1.0.0\n`,
  headCommit: "a".repeat(40),
  tagCommit: "a".repeat(40),
  mainCommit: "a".repeat(40),
});

/** The direction declaration step 1 moves into the dated section with the block. */
const DIRECTION = "<!-- redaction-directions: none -->";

/** One real entry, under the declaration semver rule 8 obliges the section to carry. */
const MOVED_BLOCK = `\n${DIRECTION}\n\n### Fixed\n\n- A real entry a reader can act on.\n`;

describe("validate-release reads the destination of RELEASING.md step 1", () => {
  test("a dated section carrying nothing but the footer links is refused", () => {
    // The footer sits UNDER that heading whenever the released section is the
    // last one in the file, so a reader that stops at the next `## ` sees text
    // where the release says nothing. The link definitions come out first.
    expect(() => validateRelease(releaseCandidate("\n"))).toThrow(
      "The CHANGELOG [1.0.0] section is empty",
    );
  });

  test("the same release with the whole block moved into it is accepted", () => {
    expect(validateRelease(releaseCandidate(MOVED_BLOCK))).toEqual({ distTag: "latest" });
  });

  test("and the same block with the direction declaration dropped on the way is refused", () => {
    // R23-H4-03. Step 1 moves the pending entries into the dated section, and
    // the `<!-- redaction-directions: … -->` declaration is one of them. A
    // release that carried the prose across and left the declaration behind
    // states no direction where semver rule 8 obliges it to state each one, and
    // every other reader of that declaration slices `[Unreleased]` — which this
    // same gate has required to be empty two rules earlier.
    expect(() =>
      validateRelease(releaseCandidate(MOVED_BLOCK.replace(`${DIRECTION}\n\n`, ""))),
    ).toThrow("semver rule 8 needs exactly one, naming each direction toJSON().url moved");
  });
});
