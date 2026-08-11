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
const RUN_STEP = /^\s*- run: (.+)$/gm;

/** The `- run:` commands of one job, in order. */
function jobRunSteps(workflow, jobName) {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  expect(start, `${jobName} must exist in the workflow`).not.toBe(-1);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n {2}[A-Za-z][\w-]*:\n/);
  const job = end === -1 ? rest : rest.slice(0, end);
  return [...job.matchAll(RUN_STEP)].map((m) => m[1].trim());
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

/** The paths `vitest.config.ts` drops from the coverage threshold. */
function coverageExclusions() {
  const list = /exclude:\s*\[([^\]]*)\]/.exec(readRepoFile("vitest.config.ts"));
  expect(list, "vitest.config.ts must keep a coverage `exclude` list").not.toBe(null);
  return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Every command CI runs, each `pnpm <script>` also expanded to the body it runs. */
function ciCommands() {
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  return [...readRepoFile(".github/workflows/ci.yml").matchAll(RUN_STEP)].flatMap((m) => {
    const command = m[1].trim();
    const invoked = /^pnpm (?:run )?([\w:-]+)$/.exec(command);
    const body = invoked ? scripts[invoked[1]] : undefined;
    return body === undefined ? [command] : [command, body];
  });
}

/** The runtime each `…-smoke` job in `ci.yml` exercises, by the job's prefix. */
function ciSmokeRuntimes() {
  const ci = readRepoFile(".github/workflows/ci.yml");
  const jobs = ci.slice(ci.indexOf("\njobs:\n"));
  return [...jobs.matchAll(/\n {2}([\w-]+)-smoke:\n/g)].map((m) => m[1]);
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
// `scripts/round19-h4-gate.spec.mjs` drives that in a throwaway project.
//
// Item 4 requires every remaining range to carry a written justification, and
// until R19-H4-03 no spec, no gate script and no workflow step read a range at
// all. This reads PRESENCE, never truth: round 5 of this audit found a
// justification that was FALSE and no pattern can tell. The site pin is what
// makes a NEW range a reviewable diff instead of a silent widening.
// ---------------------------------------------------------------------------

/** A `v8 ignore` directive that OPENS a range, never the one that closes it. */
const IGNORE_DIRECTIVE = /v8 ignore(?!\s+(?:stop|end)\b)/;

/** The directive that CLOSES a range — the end of what leaves the denominator. */
const IGNORE_STOP = /v8 ignore\s+(?:stop|end)\b/;

/** The shortest justification this check accepts, in characters of prose. */
const JUSTIFICATION_FLOOR = 40;

/**
 * The `v8 ignore` sites under measurement, each as
 * `file → the first line it guards (how many lines the range spans)`.
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
  'fixtures/channels.ts → "1 JSON.stringify in a log envelope": (2-line range)',
  'fixtures/http-server.ts → res.setHeader("X-Echo-Method", req.method ?? ""); (1-line range)',
  "src/errors/base-http-error.ts → const revokeLoan = identity ? lendIdentity(teed.branch, identity) : undefined; (1-line range)",
  "src/errors/response-identity.ts → const code = character.codePointAt(0) ?? 0; (1-line range)",
  "src/response-verdict.ts → if (!validatedResponseStructures.has(response)) return false; (1-line range)",
  "src/response-verdict.ts → if (refusedTheValue) rollbackRefusal(); (1-line range)",
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
 * Every `v8 ignore` range in `source`: the line it opens on, the first line it
 * guards, how many lines it spans, and the comment block written directly
 * above it.
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
      !lines[above].includes("v8 ignore")
    ) {
      justification = `${lines[above].replace(/^\s*(?:\/\/+|\/?\*+\/?)\s*/, "")} ${justification}`;
      above -= 1;
    }
    ranges.push({
      line: index + 1,
      guards: (lines[index + 1] ?? "").trim(),
      span: ignoreSpan(lines, index),
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
  const next = /v8 ignore\s+next\s*(\d*)/.exec(lines[index]);
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
        .map((site) => `${site.file} → ${site.guards} (${site.span}-line range)`)
        .toSorted(),
      "a `v8 ignore` range was added, moved, removed, or WIDENED. Every range removes its lines " +
        "from the denominator of the 100 percent threshold, so the list is pinned by site AND " +
        "by how many lines the range spans, and an edit to either belongs in the diff a " +
        "reviewer reads",
    ).toEqual(IGNORE_SITES.toSorted());
  });

  test("each one carries a written justification directly above it", () => {
    for (const site of sites()) {
      expect(
        site.justification.length,
        `${site.file}:${site.line} opens a \`v8 ignore\` range with no reason above it. ` +
          "Acceptance item 4 requires a written justification naming the exact condition that " +
          "makes the line unreachable. This check proves the sentence is THERE, never that it " +
          "is true — round 5 found one that was false",
      ).toBeGreaterThanOrEqual(JUSTIFICATION_FLOOR);
    }
  });

  test("BREAKING IT: the bare range that buys a false 100 percent is refused", () => {
    // The mutation, in the exact shape `scripts/round19-h4-gate.spec.mjs` runs
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
      { line: 3, guards: 'if (flag) return "yes-" + label;', span: 1, justification: "" },
    ]);
    expect(ignoreRanges(bare)[0].justification.length).toBeLessThan(JUSTIFICATION_FLOOR);

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
