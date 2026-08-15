// ═══════════════════════════════════════════════════════════════════════════
// ROUND 21, LANE H4 — round 20's repairs, driven against the NEIGHBOURING
// mutation, exactly as round 20 drove round 19's.
//
// Round 19 added four gates. Round 20 proved all four defective, each in the
// shape of the defect it was written to close, and then repaired them:
// the `- run:` readers were ANCHORED, the `v8 ignore` site pin gained a SPAN,
// the exclusion premise gained an INVOCATION read, and the direction test
// gained a machine-readable DECLARATION. This file asks the same question of
// the repairs, and the answer is the same one for the twelfth time.
//
//  * The anchored reader reads a step's COMMAND and never its CONDITION, so
//    `if: false` under a step is the smaller edit that `#` used to be.
//  * The `v8 ignore` reader knows one spelling of four and one closing keyword
//    that the instrumenter does not accept at all.
//  * The direction declaration is read with `exec`, so the SECOND declaration
//    in the block is never read.
//
// Every finding below is one `expect` that FAILS on HEAD. The rows marked
// EVIDENCE pass, and exist to prove the harness is live and the mutation real.
//
// The scratch-root harness is round 20's, unchanged in behavior: it mirrors the
// repository by symlink, materializes the mutated files, and accepts nothing
// but the child's exit code as evidence.
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";
import {
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round21-h4-")));
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
function specExit(spec, overrides, nameFilter) {
  const root = scratchRepo({ [spec]: repoText(spec), ...overrides });
  try {
    const child = runVitest(root, nameFilter === undefined ? [spec] : [spec, "-t", nameFilter]);
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

// ═══════════════════════════════════════════════════════════════════════════
// 1 and 2. The anchored `- run:` reader reads a step's COMMAND and never its
//    CONDITION, so a step disabled with `if: false` is still a step CI runs.
//
// R20-H4-01 found that `/- run: (.+)/` yielded a command from a line YAML had
// commented out, and round 20 anchored the pattern to the start of the line.
// CONTRIBUTING.md now tells a contributor the consequence: "A workflow step
// commented out is a step deleted; `scripts/gate-properties.spec.mjs` reads the
// run lines line-anchored, so a `#` in front of one fails the roster."
//
// `#` is not how a step is disabled. `if: false` is — one appended line, under
// the step, at the step's own key indentation, which GitHub Actions evaluates
// to a skipped step and which every reader here still reads as `- run: <cmd>`
// because the command is on the anchored line and the condition is not.
// `continue-on-error: true` is the same edit with the step still executing and
// its failure discarded.
//
// Five gates rest on `jobRunSteps` and `ciCommands`, and the two mutations
// below are the release half and the coverage-premise half of the same hole.
// ═══════════════════════════════════════════════════════════════════════════

describe("R21-H4-01 — a step disabled with `if: false` still counts as a step", () => {
  test("EVIDENCE: the harness is live — the same step DELETED from release.yml is red", () => {
    expect(
      gateExit({ [RELEASE]: edit(repoText(RELEASE), "      - run: pnpm verify-pack\n", "") }),
    ).not.toBe(0);
  });

  test("EVIDENCE: the anchored reader still yields the command of a disabled step", () => {
    const disabled = "      - run: pnpm verify-pack\n        if: false\n";
    expect([...disabled.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1].trim())).toEqual([
      "pnpm verify-pack",
    ]);
  });

  test("disabling `pnpm verify-pack` in the RELEASE job fails some gate", () => {
    expect(
      gateExit({
        [RELEASE]: edit(
          repoText(RELEASE),
          "      - run: pnpm verify-pack\n",
          "      - run: pnpm verify-pack\n        if: false\n",
        ),
      }),
      "`pnpm verify-pack` is the gate that refuses a code-less tarball, and it is disabled " +
        "with `if: false` in the `package` job of .github/workflows/release.yml — the job that " +
        "runs immediately before publish. Round 20 anchored the `- run:` readers so that a `#` " +
        "in front of a step fails the roster, and CONTRIBUTING.md now states that rule. The " +
        "condition sits on the NEXT line, so `jobRunSteps` reads the command and every roster " +
        "gate stays green while the step never executes",
    ).not.toBe(0);
  });
});

describe("R21-H4-02 — the exclusion premise reads an invocation, not whether it runs", () => {
  const BUN_STEP = "      - run: bun run scripts/smoke/bun.mjs";

  test("EVIDENCE: running the Bun smoke under `node` is red, so the round-20 repair is live", () => {
    expect(
      gateExit({ [CI]: edit(repoText(CI), BUN_STEP, "      - run: node scripts/smoke/bun.mjs") }),
    ).not.toBe(0);
  });

  test("disabling the Bun smoke step with `if: false` fails some gate", () => {
    expect(
      gateExit({ [CI]: edit(repoText(CI), `${BUN_STEP}\n`, `${BUN_STEP}\n        if: false\n`) }),
      "vitest.config.ts drops scripts/smoke/bun.mjs from the 100 percent threshold because " +
        "`CI executes it under that runtime`, and the step that executes it is disabled here " +
        "with `if: false`. Round 20 closed R19-H4-04 by reading the INVOCATION rather than a " +
        "mention of the path, and the invocation it reads is a string in a step GitHub Actions " +
        "skips, so the file is excluded from the threshold, executed by nothing, and read by " +
        "no gate — the exact state R19-H4-04 was filed for",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 and 4. The `v8 ignore` reader knows one spelling of four, and one closing
//    keyword the instrumenter does not accept.
//
// The gate reads a range with `/v8 ignore(?!\s+(?:stop|end)\b)/` and closes it
// with `/v8 ignore\s+(?:stop|end)\b/`. The coverage provider does neither.
// `ast-v8-to-istanbul`, which vitest's v8 provider remaps through, reads
//
//   /^\s*(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(if|else|next|file)/
//   /\s*(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(start|stop)/
//
// so `c8 ignore`, `istanbul ignore` and `node:coverage ignore` remove lines
// from the SAME denominator the release gate enforces and match nothing the
// gate reads — and `stop` is the ONLY closing keyword, so a range closed with
// `end` is an UNCLOSED range whose lines run to the end of the file, while the
// span the round-20 pin computes for it is the small one the author wrote.
//
// R20-H4-03 filed the widening of a range by two lines as a defect the pin must
// see. This is the same widening to the end of the file, and the pin reports
// no change at all.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A throwaway vitest project carrying this repository's own four thresholds,
 * one measured module holding `source`, and a spec that covers `pick(false)`
 * and never calls `neverCalled`.
 */
function coverageProject(source) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round21-h4-cov-")));
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
  writeFileSync(join(root, "src/m.ts"), source);
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

/** The module round 19's harness measures: one function, one untested arm. */
const ONE_ARM = [
  "export function pick(flag: boolean): string {",
  '  const label = "x";',
  "  /* MARK-OPEN */",
  '  if (flag) return "yes-" + label;',
  "  /* MARK-CLOSE */",
  '  return "no-" + label;',
  "}",
  "",
].join("\n");

/** The same, plus a wholly untested function BELOW the range's close. */
const WITH_TAIL = ONE_ARM.replace(
  /\n$/,
  [
    "export function neverCalled(flag: boolean): number {",
    "  if (flag) return 1;",
    "  return 2;",
    "}",
    "",
  ].join("\n"),
);

const withMarks = (source, open, close) =>
  source.replace("/* MARK-OPEN */", open).replace("/* MARK-CLOSE */", close);

/** Whether a project reports 100 on every axis and exits 0 under the threshold. */
function reportsFullCoverage(source) {
  const root = coverageProject(source);
  try {
    const run = runVitest(root, [
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reporter=text",
      // Named, never inherited: vitest adds `text-summary` on its own only
      // where `std-env` reports an AI agent, and the `Statements` read below
      // quotes the summary line that reporter prints.
      "--coverage.reporter=text-summary",
    ]);
    return {
      exit: run.status,
      belowThreshold: (run.stdout + run.stderr).includes("does not meet global threshold"),
      statements: /Statements {3}: (\S+)/.exec(run.stdout)?.[1],
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("R21-H4-03 — `c8 ignore` buys the same false 100 and no gate reads it", () => {
  const PROBE = "src/round21-h4-probe.ts";
  const BARE = withMarks(ONE_ARM, "/* c8 ignore start */", "/* c8 ignore stop */");

  test("EVIDENCE: an unignored module is refused, and the `c8` spelling reports 100", () => {
    expect(reportsFullCoverage(withMarks(ONE_ARM, "", ""))).toMatchObject({ belowThreshold: true });
    expect(reportsFullCoverage(BARE)).toEqual({
      exit: 0,
      belowThreshold: false,
      statements: "100%",
    });
  });

  test("an unjustified `c8 ignore` range in a measured file fails some gate", () => {
    expect(
      gateExit({ [PROBE]: BARE }),
      "src/round21-h4-probe.ts holds a `c8 ignore` range with no justification above it. " +
        "vitest's v8 provider remaps through ast-v8-to-istanbul, whose ignore-hint pattern is " +
        "/(?:istanbul|[cv]8|node:coverage)\\s+ignore\\s+(start|stop)/, so this range takes its " +
        "lines out of the denominator of the same 100 percent threshold the release gate " +
        "enforces. `IGNORE_DIRECTIVE` in scripts/gate-properties.spec.mjs reads the four " +
        "characters `v8 i`, so neither the six-site pin nor the justification requirement " +
        "acceptance item 4 rests on sees the range at all",
    ).not.toBe(0);
  });
});

describe("R21-H4-04 — a range closed with `end` runs to the end of the file", () => {
  const SOURCE = "src/response-verdict.ts";
  const REAL_STOP = [
    "  if (!validatedResponseStructures.has(response)) return false;",
    "  /* v8 ignore stop */",
  ].join("\n");
  const AS_END = [
    "  if (!validatedResponseStructures.has(response)) return false;",
    "  /* v8 ignore end */",
  ].join("\n");

  test("EVIDENCE: `stop` closes the range and `end` does not, so `end` swallows the file", () => {
    // The same module twice. With `stop`, `neverCalled` is uncovered and the
    // four thresholds refuse it. With `end`, the range never closes, every line
    // below it leaves the denominator, and the untested function reports 100.
    expect(
      reportsFullCoverage(withMarks(WITH_TAIL, "/* v8 ignore start */", "/* v8 ignore stop */")),
    ).toMatchObject({ belowThreshold: true });
    expect(
      reportsFullCoverage(withMarks(WITH_TAIL, "/* v8 ignore start */", "/* v8 ignore end */")),
    ).toEqual({ exit: 0, belowThreshold: false, statements: "100%" });
  });

  test("EVIDENCE: the gate's own closing pattern accepts the keyword that closes nothing", () => {
    expect(/v8 ignore\s+(?:stop|end)\b/.test("  /* v8 ignore end */")).toBe(true);
  });

  test("rewriting a range's `stop` as `end` fails some gate", () => {
    expect(
      gateExit({ [SOURCE]: edit(repoText(SOURCE), REAL_STOP, AS_END) }),
      "the one-line `v8 ignore` range in src/response-verdict.ts is closed with `end` here. " +
        "ast-v8-to-istanbul accepts `stop` and nothing else, so the range never closes and " +
        "every line from it to the end of the file — including the second range's guarded " +
        "line and every branch of `hasCompatibleForeignHeaders` below it — leaves the " +
        "denominator of the 100 percent threshold. `IGNORE_STOP` in " +
        "scripts/gate-properties.spec.mjs accepts `stop|end`, so the span the round-20 pin " +
        "computes is still 1 and the pin written to refuse `a silent widening` sees none",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The direction declaration is read with `exec`, so only the FIRST one in
//    the `[Unreleased]` block is ever read.
//
// R20-H4-06 replaced a four-phrase reader with a machine-readable declaration,
// `<!-- redaction-directions: … -->`, "so this test reads a closed vocabulary
// rather than guessing at prose". The reader is `/<!--\s*redaction-directions:
// \s*([^>]*?)\s*-->/.exec(rawBlock)` — one match, the first. A block carrying
// two declarations claims two things and is read for one, which is the same
// unwitnessed-claim state R19-H4-01 was filed for, restored by an edit that
// uses the machine-readable channel the repair introduced.
// ═══════════════════════════════════════════════════════════════════════════

describe("R21-H4-05 — the second `redaction-directions` declaration is never read", () => {
  const CHANGELOG = "CHANGELOG.md";
  const FIRST = "<!-- redaction-directions: removes-more -->";
  const SECOND = "<!-- redaction-directions: keeps-more -->";
  const DIRECTION_TEST = "every direction the block names is a direction some input actually took";

  test("EVIDENCE: `exec` reads the first declaration and stops", () => {
    const both = `${FIRST}\n${SECOND}\n`;
    expect(/<!--\s*redaction-directions:\s*([^>]*?)\s*-->/.exec(both)?.[1]).toBe("removes-more");
  });

  test("EVIDENCE: the same claim as the ONLY declaration is red", () => {
    // The positive control: `keeps-more` has no witness over the 2.0.1
    // differential, so the direction test refuses it when it is the one it reads.
    expect(
      specExit(
        "tests/surface/surface-changelog-direction-witnesses.spec.ts",
        { [CHANGELOG]: edit(repoText(CHANGELOG), FIRST, SECOND) },
        DIRECTION_TEST,
      ),
    ).not.toBe(0);
  }, 180_000);

  test("a SECOND declaration claiming a witnessless direction fails the direction test", () => {
    expect(
      specExit(
        "tests/surface/surface-changelog-direction-witnesses.spec.ts",
        { [CHANGELOG]: edit(repoText(CHANGELOG), FIRST, `${FIRST}\n${SECOND}`) },
        DIRECTION_TEST,
      ),
      "the `[Unreleased]` block now carries two `redaction-directions` declarations, and the " +
        "second claims `keeps-more`, which round 19 measured at zero witnesses over the 2.0.1 " +
        "differential. RELEASING.md step 1 copies this block verbatim into the published " +
        "section. The declaration round 20 added to close R20-H4-06 is read with a single " +
        "`exec`, so the first declaration answers for the block and the second states a " +
        "direction no input took with every gate green",
    ).not.toBe(0);
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. The reader asks a STEP whether it runs. Nothing asks the JOB.
//
// R21-H4-01 above was repaired by reading a step as a BLOCK: `stepBlocks` reads
// the keys written under a `- run:` line, `runCommands` drops a step whose block
// carries `if:` or `continue-on-error:`, and `jobRunSteps` refuses those keys on
// the jobs it is handed a NAME for. `ciCommands` is handed no name. It reads
// `.github/workflows/ci.yml` whole, so the two gates that rest on it — the
// coverage-exclusion premise and both contributor runtime rosters — take
// commands and job declarations out of jobs that need not run at all.
//
// One key, at the job's own indentation, one line under the job's name, and
// GitHub Actions skips every step in it. The step blocks below are BYTE
// IDENTICAL to the repository's own, so every reader repaired this round still
// reads exactly what it read before.
//
// CONTRIBUTING.md already tells a contributor the opposite: "Either key on a
// JOB the roster reads out of fails it too, because the key takes every step in
// that job with it." That sentence is what this section measures.
//
// This is R19-H4-04's class one level out, and the twelfth appearance of the
// family: a reader widened to the question it was caught missing, with the same
// question one layer up still unasked.
//
// NO JOB IS NAMED HERE, and the omission is deliberate.
// `scripts/gate-mutation-ignore-ranges.spec.mjs` pins that no spec outside its own two
// proof files reads `ci.yml` and spells the Bun job's name, and that pin is not
// in this lane. A job is located by the COMMAND it runs instead, which is the
// honest identifier anyway: a roster reads a command out of a job, and the job
// is whichever one carries that command.
// ═══════════════════════════════════════════════════════════════════════════

/** Every job declaration of `ci.yml`, as a match on the line that opens it. */
function jobOpeners(ci) {
  const jobs = ci.indexOf("\njobs:\n");
  expect(jobs, "ci.yml must declare jobs").not.toBe(-1);
  return [...ci.matchAll(/^ {2}[A-Za-z][\w-]*:$/gm)].filter((open) => open.index > jobs);
}

/** Where the job whose steps run `command` starts, where its keys start, and where it ends. */
function jobCarrying(ci, command) {
  const step = ci.indexOf(`      - run: ${command}\n`);
  expect(step, `no step of ci.yml runs \`${command}\``).not.toBe(-1);
  const openers = jobOpeners(ci);
  const open = openers.filter((opener) => opener.index < step).at(-1);
  expect(open, `no job opens in front of the step that runs \`${command}\``).toBeDefined();
  const next = openers.find((opener) => opener.index > step);
  return {
    start: open.index,
    keys: open.index + open[0].length + 1,
    end: next === undefined ? ci.length : next.index,
  };
}

/** `ci.yml` with `key` written as a JOB-level key of the job that runs `command`. */
function disableJobRunning(ci, command, key) {
  const job = jobCarrying(ci, command);
  return `${ci.slice(0, job.keys)}    ${key}\n${ci.slice(job.keys)}`;
}

/** `ci.yml` with the whole job that runs `command` deleted. */
function deleteJobRunning(ci, command) {
  const job = jobCarrying(ci, command);
  return ci.slice(0, job.start) + ci.slice(job.end);
}

describe("R21-ORCH-01 — a JOB that need not run still supplies the roster its commands", () => {
  /** The step the coverage exclusion for `scripts/smoke/bun.mjs` rests on. */
  const BUN = "bun run scripts/smoke/bun.mjs";
  /** The step the `Node-floor` half of both runtime rosters rests on. */
  const NODE_FLOOR = "node scripts/smoke/node-min.mjs";

  test("CONTROL: deleting the job that runs the Bun smoke is red", () => {
    expect(gateExit({ [CI]: deleteJobRunning(repoText(CI), BUN) })).not.toBe(0);
  });

  test("CONTROL: deleting the job that runs the Node-floor smoke is red", () => {
    expect(gateExit({ [CI]: deleteJobRunning(repoText(CI), NODE_FLOOR) })).not.toBe(0);
  });

  test("EVIDENCE: a job-level key leaves every step block byte-identical", () => {
    // The repair this round made to the STEP reader cannot see this mutation:
    // the step keeps its anchored `- run:` line and gains no key of its own.
    const disabled = disableJobRunning(repoText(CI), BUN, "if: false");
    expect(disabled).toContain(`      - run: ${BUN}\n`);
    expect(disabled).not.toContain(`      - run: ${BUN}\n        if:`);
    expect([...disabled.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1].trim())).toContain(BUN);
  });

  test("disabling the JOB that runs the Bun smoke with `if: false` fails some gate", () => {
    expect(
      gateExit({ [CI]: disableJobRunning(repoText(CI), BUN, "if: false") }),
      "vitest.config.ts drops scripts/smoke/bun.mjs from the 100 percent threshold because CI " +
        "executes it under Bun, and the JOB that executes it is disabled here with one " +
        "`if: false` at the job's own indentation. Every step in that job is skipped, so the " +
        "file is excluded from the threshold, executed by nothing, and named by both " +
        "contributor rosters as a runtime CI smokes. `ciCommands` in " +
        "scripts/gate-properties.spec.mjs reads the workflow whole and asks each STEP whether " +
        "it runs; nothing asks the job. CONTRIBUTING.md already states the rule this breaks",
    ).not.toBe(0);
  });

  test("discarding that job's failures with `continue-on-error: true` fails some gate", () => {
    expect(
      gateExit({ [CI]: disableJobRunning(repoText(CI), BUN, "continue-on-error: true") }),
      "the same job, with its failures discarded instead of its steps skipped. The smoke runs " +
        "and CI is green whatever it reports, so the runtime that measures the excluded file " +
        "can no longer fail the build. `runCommands` refuses this key on a STEP and no reader " +
        "refuses it on the JOB",
    ).not.toBe(0);
  });

  test("disabling the JOB that runs the Node-floor smoke with `if: false` fails some gate", () => {
    expect(
      gateExit({ [CI]: disableJobRunning(repoText(CI), NODE_FLOOR, "if: false") }),
      "the SECOND job, because the defect is the missing QUESTION and not the one job that " +
        "exposed it. CONTRIBUTING.md and RELEASING.md each carry a sentence naming the " +
        "Node-floor smoke among the runtimes CI runs, and scripts/gate-properties.spec.mjs " +
        "reads that sentence against the smoke jobs `.github/workflows/ci.yml` DECLARES. A " +
        "declared job is not a job that runs: the floor this package publishes an `engines` " +
        "claim about is executed by nothing here, and both documents still tell a reader it is",
    ).not.toBe(0);
  });
});
