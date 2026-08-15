// ═══════════════════════════════════════════════════════════════════════════
// ROUND 22, LANE H4 — round 21's repairs, and the two gates no round has driven.
//
// Round 19 added four gates. Round 20 proved all four defective and repaired
// them. Round 21 proved the repairs defective in five more ways. This file asks
// the same question of ROUND 21's repairs, and answers it twice more.
//
//  * The step reader now asks a STEP whether it runs, and `runningJobs` asks a
//    JOB about ITS OWN keys. Neither asks whether the jobs a job `needs:` run.
//    One `if: false` on a job nothing reads, plus one `needs:` line, and the
//    job that executes `scripts/smoke/bun.mjs` is skipped with the coverage
//    exclusion premise and both runtime rosters green. Fourteenth appearance.
//  * A step is read as a BLOCK that ends at the first line indented less than
//    its keys — and a YAML comment is such a line. A `# …` between the `- run:`
//    line and the `if: false` under it hides the condition from the reader
//    while YAML still parses the two into one step mapping. That is R21-H4-01
//    restored by the smaller edit again.
//
// And the harness round 21 could not find. Round 21's H4 reported that
// `verify-pack`'s CONTROL exits 1 inside the symlink-mirrored scratch root, so
// no mutation there carried signal. The cause is the mirroring, not the gate:
// npm's packlist does not walk a symlinked directory, so `dist/` is empty to
// `npm pack --dry-run` however good the build is. A MATERIALIZED tree, with
// `node_modules` the only symlink, runs both remaining gates for real —
// `validate-release` against a scratch git repository carrying its own tag and
// `origin/main` ref, and `verify-pack` against a real dry-run manifest.
//
// Every finding below is one `expect` that FAILS on HEAD. The rows marked
// EVIDENCE and CONTROL pass, and exist to prove the harness is live and the
// mutation real.
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";
import {
  cpSync,
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
const repoText = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Never mirrored into a scratch root: vitest's own coverage output. */
const NOT_MIRRORED = new Set(["coverage", "node_modules/.cache"]);

/** A vitest child, run over `root`, answering its result. */
function runVitest(root, argv) {
  // And `NO_COLOR`, for the reason round 19's harness states: vitest turns its
  // colors off only where `std-env` reports an AI agent, so every read of this
  // child's output as text passed under an agent and failed in a terminal.
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

/** Round 20's scratch root: symlink for everything, a real file per override. */
function scratchRepo(overrides) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round22-h4-")));
  const realDirs = new Set();
  for (const rel of Object.keys(overrides)) {
    const parts = rel.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      realDirs.add(parts.slice(0, index).join("/"));
    }
  }
  const mirror = (rel) => {
    for (const entry of readdirSync(join(REPO_ROOT, rel || "."))) {
      const next = rel ? `${rel}/${entry}` : entry;
      if (NOT_MIRRORED.has(next)) continue;
      if (realDirs.has(next)) {
        mkdirSync(join(root, next));
        mirror(next);
      } else if (!(next in overrides)) {
        symlinkSync(join(REPO_ROOT, next), join(root, next));
      }
    }
  };
  mirror("");
  for (const [rel, text] of Object.entries(overrides)) writeFileSync(join(root, rel), text);
  return root;
}

/** The exit status of one of the repository's own specs over a mutated root. */
function specExit(spec, overrides) {
  const root = scratchRepo({ [spec]: repoText(spec), ...overrides });
  try {
    const child = runVitest(root, [spec]);
    expect(
      child.stdout,
      `the gate did not run in the scratch root:\n${child.stdout}\n${child.stderr}`,
    ).toMatch(/Tests {2}\d+ (?:passed|failed)/);
    return child.status ?? 1;
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** The same, for `scripts/gate-properties.spec.mjs`, which is never mutated. */
const gateExit = (overrides) => specExit("scripts/gate-properties.spec.mjs", overrides);

/** `text` with `find` replaced once, refusing a mutation that matched nothing. */
function edit(text, find, replacement) {
  expect(text.includes(find), `the mutation target is gone: ${JSON.stringify(find)}`).toBe(true);
  return text.replace(find, replacement);
}

const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/release.yml";

/**
 * A YAML reading of `text`, or null where no runtime here can parse YAML.
 *
 * This repository ships and installs no YAML parser, on purpose. Bun's is
 * built in, and CI runs a Bun job, so the two mutations below are read back as
 * the STRUCTURE GitHub Actions receives wherever a Bun binary exists, and are
 * asserted as text everywhere else.
 */
function parseYaml(text) {
  const child = spawnSync(
    "bun",
    ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))"],
    { encoding: "utf8", input: text },
  );
  return child.status === 0 ? JSON.parse(child.stdout) : null;
}

const YAML = parseYaml("a: 1")?.a === 1;

// ═══════════════════════════════════════════════════════════════════════════
// 1. A JOB SKIPPED THROUGH ITS `needs:` STILL SUPPLIES THE ROSTER.
//
// R21-ORCH-01 taught `workflowJobs` to ask each job for `if:` and
// `continue-on-error:` at the JOB's own indentation, and `runningJobs` drops
// the ones that carry either. That reads one job at a time. GitHub Actions
// skips a job whose dependency was skipped, so the question "does this job
// run" is not answerable from the job's own keys at all.
//
// The mutation is two lines: a job that does not run, and a `needs:` on the
// job that runs the Bun smoke pointing at it. That job keeps every key it has,
// every step block in the file stays byte-identical, and `scripts/smoke/bun.mjs`
// stays excluded from the 100 percent threshold while nothing executes it —
// R19-H4-04's own state, restored two levels out.
//
// NO JOB IS NAMED HERE, and the omission is round 21's, kept.
// `scripts/gate-mutation-ignore-ranges.spec.mjs` pins that no spec outside its own two
// proof files reads `ci.yml` and spells the Bun job's name. A job is located by
// the COMMAND it runs instead, which is the honest identifier anyway.
// ═══════════════════════════════════════════════════════════════════════════

/** The step whose command the coverage exclusion for the Bun smoke rests on. */
const BUN_STEP = "      - run: bun run scripts/smoke/bun.mjs";

/** Where the job whose steps run `command` opens, and where its keys start. */
function jobCarrying(ci, command) {
  const step = ci.indexOf(`${command}\n`);
  expect(step, `no step of ci.yml runs \`${command}\``).not.toBe(-1);
  const open = [...ci.matchAll(/^ {2}[A-Za-z][\w-]*:$/gm)].filter((m) => m.index < step).at(-1);
  expect(open, "no job opens in front of that step").toBeDefined();
  return { name: open[0].trim().slice(0, -1), keys: open.index + open[0].length + 1 };
}

/** A job that never runs, and the `needs:` that hands its skip to that job. */
function skipBunThroughNeeds(ci) {
  const preflight = [
    "  preflight:",
    "    if: false",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo preflight",
    "",
  ].join("\n");
  const withPreflight = edit(ci, "jobs:\n", `jobs:\n${preflight}`);
  const job = jobCarrying(withPreflight, BUN_STEP);
  return `${withPreflight.slice(0, job.keys)}    needs: preflight\n${withPreflight.slice(job.keys)}`;
}

describe("R22-H4-01 — a job skipped through `needs:` still supplies the roster", () => {
  test("CONTROL: deleting the Bun smoke step from the same job is red", () => {
    expect(gateExit({ [CI]: edit(repoText(CI), `${BUN_STEP}\n`, "") })).not.toBe(0);
  }, 180_000);

  test.skipIf(!YAML)("EVIDENCE: GitHub receives a smoke job that waits on a skipped job", () => {
    const mutated = skipBunThroughNeeds(repoText(CI));
    const jobs = parseYaml(mutated).jobs;
    const job = jobs[jobCarrying(mutated, BUN_STEP).name];
    expect(jobs.preflight.if).toBe(false);
    expect(job.needs).toBe("preflight");
    expect(job.if).toBeUndefined();
    expect(job["continue-on-error"]).toBeUndefined();
    expect(job.steps.at(-1).run).toBe("bun run scripts/smoke/bun.mjs");
  });

  test("skipping the Bun smoke JOB through its `needs:` fails some gate", () => {
    expect(
      gateExit({ [CI]: skipBunThroughNeeds(repoText(CI)) }),
      "the job that runs the Bun smoke now waits on a job written `if: false`, and GitHub " +
        "Actions skips a job whose dependency was skipped, so no Bun binary runs. " +
        "vitest.config.ts drops " +
        "scripts/smoke/bun.mjs from the 100 percent threshold because `CI executes it under " +
        "that runtime`, and both contributor rosters name Bun among the runtimes CI smokes. " +
        "R21-ORCH-01 taught `runningJobs` in scripts/gate-properties.spec.mjs to ask a job for " +
        "its OWN `if:` and `continue-on-error:`; nothing asks whether the jobs it `needs:` run, " +
        "so the file is excluded from the threshold, executed by nothing, and read by no gate",
    ).not.toBe(0);
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A COMMENT INSIDE A STEP HIDES THE KEY THAT DISABLES IT.
//
// `stepBlocks` collects a step's keys until it meets a line that does not start
// with the step's key indentation, and then closes the block:
//
//     if (!line.startsWith(" ".repeat(open.indent + 2))) { open = null; continue; }
//
// A YAML comment is such a line at any column short of that, and YAML does not
// treat a comment as part of the structure at all. So the reader closes the
// step at the comment and never reaches the `if: false` under it, while GitHub
// Actions reads exactly the step mapping R21-H4-01 was filed for.
//
// CONTRIBUTING.md tells a contributor the opposite in the sentence round 21
// wrote: `scripts/gate-properties.spec.mjs` reads a step as a BLOCK — its
// `- run:` line, read line-anchored, plus the keys written under it — so a `#`
// in front of that run line, an `if: false` under it, and a
// `continue-on-error: true` under it each fail the roster.
// ═══════════════════════════════════════════════════════════════════════════

const VERIFY_STEP = "      - run: pnpm verify-pack\n";
const DISABLED = `${VERIFY_STEP}        if: false\n`;
const DISABLED_BEHIND_COMMENT = `${VERIFY_STEP}      # Skipped: the registry mirror is down.\n        if: false\n`;

describe("R22-H4-02 — a comment inside a step hides the key that disables it", () => {
  test("CONTROL: the same two lines with no comment between them are red", () => {
    expect(gateExit({ [RELEASE]: edit(repoText(RELEASE), VERIFY_STEP, DISABLED) })).not.toBe(0);
  }, 180_000);

  test.skipIf(!YAML)("EVIDENCE: both spellings are the same step to a YAML reader", () => {
    const step = (block) => parseYaml(`steps:\n${block}`).steps[0];
    expect(step(DISABLED)).toEqual({ run: "pnpm verify-pack", if: false });
    expect(step(DISABLED_BEHIND_COMMENT)).toEqual({ run: "pnpm verify-pack", if: false });
  });

  test("a comment between `- run: pnpm verify-pack` and its `if: false` fails some gate", () => {
    expect(
      gateExit({ [RELEASE]: edit(repoText(RELEASE), VERIFY_STEP, DISABLED_BEHIND_COMMENT) }),
      "`pnpm verify-pack` is the gate that refuses a code-less tarball, and it is disabled with " +
        "`if: false` in the `package` job of .github/workflows/release.yml — the job that runs " +
        "immediately before publish. Round 21 closed the same edit by reading a step as a " +
        "BLOCK, and `stepBlocks` in scripts/gate-properties.spec.mjs closes that block at the " +
        "first line indented less than the step's keys. A YAML comment is such a line and is " +
        "not structure at all, so one `#` line between the two makes the condition unreadable " +
        "to every roster gate while GitHub Actions still skips the step. CONTRIBUTING.md tells " +
        "a contributor that an `if: false` under a run line fails the roster",
    ).not.toBe(0);
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. `validate-release`, DRIVEN. THE HARNESS ROUND 21 COULD NOT FIND.
//
// The gate reads `package.json` and `CHANGELOG.md` from the directory ABOVE
// its own file and shells `git` in the process working directory, so a
// MATERIALIZED copy of those three files inside a scratch git repository is a
// complete world for it: a tag it names, a HEAD it points at, and an
// `origin/main` ref, all built in milliseconds and none of them this
// repository's.
//
// What it finds: RELEASING.md step 1 tells a maintainer to `move all pending
// changelog entries from [Unreleased] into ## [X.Y.Z] - YYYY-MM-DD, and leave
// [Unreleased] empty`. The gate enforces the SOURCE half — `[Unreleased]` must
// be empty — and asks the destination only for a dated heading. A release that
// DELETED the block instead of moving it satisfies both halves, and semver
// rule 8, `CHANGELOG.md states each direction the output moved`, is enforced
// nowhere at the release boundary: the whole differential round 19 built reads
// `[Unreleased]`, which is empty by then by construction.
// ═══════════════════════════════════════════════════════════════════════════

/** `git`, run inside `root`, refusing a failure. */
function git(root, ...argv) {
  const result = spawnSync("git", argv, { cwd: root, encoding: "utf8" });
  expect(result.status, `git ${argv.join(" ")} failed: ${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

/** The footer of every changelog fixture below. */
const FOOTER = [
  "[Unreleased]: https://github.com/pbpeterson/typed-fetch/compare/v2.0.1...HEAD",
  "[2.0.1]: https://github.com/pbpeterson/typed-fetch/compare/v2.0.0...v2.0.1",
].join("\n");

/**
 * The exit code `node scripts/validate-release.mjs` answers for `changelog`,
 * inside a scratch repository whose `v2.0.1` tag, `HEAD` and `origin/main` all
 * name one commit. `package.json` is this repository's own, unedited.
 */
function validateReleaseExit(changelog) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round22-h4-vr-")));
  try {
    mkdirSync(join(root, "scripts/lib"), { recursive: true });
    cpSync(
      join(REPO_ROOT, "scripts/validate-release.mjs"),
      join(root, "scripts/validate-release.mjs"),
    );
    cpSync(join(REPO_ROOT, "scripts/lib"), join(root, "scripts/lib"), { recursive: true });
    cpSync(join(REPO_ROOT, "package.json"), join(root, "package.json"));
    writeFileSync(join(root, "CHANGELOG.md"), changelog);

    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "-c", "user.email=a@b.test", "-c", "user.name=a", "commit", "-qm", "release");
    git(root, "tag", "v2.0.1");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");

    const child = spawnSync(process.execPath, ["scripts/validate-release.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF_NAME: "v2.0.1", GITHUB_REF_TYPE: "tag", GITHUB_OUTPUT: "" },
    });
    return { status: child.status ?? 1, out: `${child.stdout}${child.stderr}` };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** The direction declaration RELEASING.md step 1 moves in with the block. */
const DIRECTION = "<!-- redaction-directions: none -->";

const RELEASED_SECTION = [
  DIRECTION,
  "",
  "### Fixed",
  "",
  "- A real entry a reader can act on.",
  "",
].join("\n");

/** A changelog whose 2.0.1 section holds `body`. */
const changelogWith = (body) =>
  ["# Changelog", "", "## [Unreleased]", "", "## [2.0.1] - 2026-08-11", "", body, FOOTER, ""].join(
    "\n",
  );

describe("R22-H4-03 — the gate between a tag and `npm publish`, driven", () => {
  test("EVIDENCE: the harness is a live world — a well-formed release passes", () => {
    const run = validateReleaseExit(changelogWith(RELEASED_SECTION));
    expect(run.out).toContain("npm dist-tag=latest");
    expect(run.status).toBe(0);
  }, 60_000);

  test("CONTROL: a footer link that does not end at the tag is refused", () => {
    const run = validateReleaseExit(
      changelogWith(RELEASED_SECTION).replace("v2.0.0...v2.0.1", "v2.0.0...v2.0.0"),
    );
    expect(run.out).toContain("✖ validate-release");
    expect(run.status).toBe(1);
  }, 60_000);

  test("a release whose new dated section is EMPTY is refused", () => {
    const run = validateReleaseExit(changelogWith(""));
    expect(
      run.status,
      "the changelog names `## [2.0.1] - 2026-08-11` and puts nothing under it. RELEASING.md " +
        "step 1 says to MOVE the pending entries into that section and leave `[Unreleased]` " +
        "empty; scripts/validate-release.mjs enforces the source half and asks the destination " +
        "only for a dated heading, so a release that deleted the block instead of moving it " +
        "publishes with a changelog section that describes nothing. Semver rule 8 obliges that " +
        "section to state each direction `toJSON().url` moved, and the differential that reads " +
        "directions reads `[Unreleased]`, which this gate has just required to be empty",
    ).not.toBe(0);
  }, 60_000);

  // R23-H4-03, driven in the same live world. The section says something and
  // still fails semver rule 8's direction obligation, in the three ways the
  // declaration can be wrong. Each is a real `node scripts/validate-release.mjs`
  // inside a scratch git repository, so nothing here rests on an import.
  test.each([
    ["carries no direction declaration", `${DIRECTION}\n`, ""],
    ["carries two", DIRECTION, `${DIRECTION}\n\n<!-- redaction-directions: keeps-more -->`],
    ["names a direction outside the vocabulary", DIRECTION, "<!-- redaction-directions: wider -->"],
  ])(
    "a release whose new dated section %s is refused",
    (_name, find, put) => {
      const run = validateReleaseExit(changelogWith(RELEASED_SECTION.replace(find, put)));
      expect(
        run.status,
        "the dated section says something, so the rule round 22 added accepts it. Semver rule 8 " +
          "obliges that section to state each direction `toJSON().url` moved, and RELEASING.md " +
          "step 1 copies the declaration there with the block. Every other reader of it slices " +
          "`## [Unreleased]`, which scripts/validate-release.mjs requires to be EMPTY before the " +
          "workflow may publish, so this gate is the only one that can read the obligation at the " +
          "moment it applies",
      ).not.toBe(0);
      expect(run.out).toContain("✖ validate-release");
    },
    60_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. `verify-pack`, DRIVEN, AND WHY THE MIRROR DEFEATED IT.
//
// Round 21's H4 reported that `verify-pack`'s CONTROL exits 1 inside the
// symlink-mirrored scratch root, so mutation there carried no signal. It is
// the mirror: `npm pack` builds its manifest from a packlist walk that does
// not descend a symlinked directory, so `dist/` is empty to the dry run and
// the gate correctly reports every required entry point missing. Materialize
// the tree instead — `node_modules` is the only link — and the control passes,
// which makes the two fixtures below real mutations for the first time.
// ═══════════════════════════════════════════════════════════════════════════

/** This repository, materialized, with `node_modules` symlinked. */
function materializedRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round22-h4-pack-")));
  cpSync(REPO_ROOT, root, {
    recursive: true,
    filter: (source) => !/\/(?:node_modules|\.git|coverage)$/.test(source),
  });
  rmSync(join(root, "node_modules"), { force: true, recursive: true });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  return root;
}

/** The exit code `node scripts/verify-pack.mjs` answers over `root`. */
function verifyPackExit(root) {
  const child = spawnSync(process.execPath, ["scripts/verify-pack.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: child.status ?? 1, out: `${child.stdout}${child.stderr}` };
}

describe("R22-H4-04 — EVIDENCE: `verify-pack` runs for real in a materialized tree", () => {
  test("the control passes, a dist leak is refused, and a missing entry point is refused", () => {
    const root = materializedRepo();
    try {
      const control = verifyPackExit(root);
      expect(
        control.out,
        "the tree must carry a real build for the control to mean anything",
      ).toContain("dry-run manifest OK");
      expect(control.status).toBe(0);

      writeFileSync(join(root, "dist/.env"), "TOKEN=1\n");
      expect(verifyPackExit(root).status).toBe(1);
      rmSync(join(root, "dist/.env"));

      rmSync(join(root, "dist/errors/index.d.mts"));
      const missing = verifyPackExit(root);
      expect(missing.out).toContain("dist/errors/index.d.mts");
      expect(missing.status).toBe(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});
