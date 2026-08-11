// ═══════════════════════════════════════════════════════════════════════════
// ROUND 20, LANE H4 — round 19's four new gates, driven against a mutation.
//
// Round 19 answered R19-H4-01 … R19-H4-04 by adding four gates to
// `scripts/gate-properties.spec.mjs`: a runtime roster read in both directions,
// a `v8 ignore` justification requirement with six site pins, a
// coverage-exclusion premise gate, and a rewritten `[Unreleased]` direction
// test. Round 19's own harness proved each one RED against exactly the mutation
// it was written for. None of them was driven against a NEIGHBOURING mutation.
//
// This file is that drive. Sections 1 to 6 run one of the repository's real
// gate specs over a scratch root in which exactly one input file differs, and
// the only evidence accepted is the child's exit code. Section 7 is the one
// gate that does not exist yet.
//
// The result: the roster gates and the exclusion-premise gate read `- run:`
// with an unanchored pattern, so a COMMENTED-OUT step still counts as a step;
// the roster gate reads a bare word anywhere in a document rather than the
// roster sentence; the `v8 ignore` pin reads where a range OPENS and never
// where it CLOSES; the exclusion premise is satisfied by any run line that
// merely NAMES the excluded path; and the direction test collects a claim by
// matching four fixed phrases.
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

/** A vitest child, run over `root`, answering its exit status. */
function runVitest(root, argv) {
  // The same clean environment round 19's harness states its reasons for: this
  // runs INSIDE a vitest worker, and the child must not inherit the parent
  // run's pool bookkeeping or its `NODE_V8_COVERAGE` directory.
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

/**
 * A scratch root that mirrors this repository by SYMLINK, with each path in
 * `overrides` materialized as a real file holding the given text.
 *
 * A symlink for everything else, because the gate under test reads a dozen
 * documents and two workflows and must read the repository's own. A real file
 * for the overrides, and real directories on the way to each one, because a
 * symlinked directory would hand the mutation straight back to the original.
 *
 * A spec file must be a real file too even when it is not mutated: Vite
 * resolves a symlinked module to its target, and `gate-properties.spec.mjs`
 * finds every document it reads relative to its own location.
 */
function scratchRepo(overrides) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round20-h4-")));
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
  for (const [rel, text] of Object.entries(overrides)) {
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/**
 * The exit status of the repository's own `scripts/gate-properties.spec.mjs`,
 * run over a scratch root carrying `overrides`.
 *
 * The spec is always copied verbatim — it is the subject, never the mutation.
 */
function gateExit(overrides) {
  return specExit("scripts/gate-properties.spec.mjs", overrides);
}

/** The same, for any spec file, with an optional `-t` name filter. */
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

/** `text` with `find` replaced once, refusing a mutation that matched nothing. */
function edit(text, find, replacement) {
  expect(text.includes(find), `the mutation target is gone: ${JSON.stringify(find)}`).toBe(true);
  return text.replace(find, replacement);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The `- run:` pattern every roster gate reads is unanchored, so a step
//    commented OUT of a workflow is still counted as a step CI runs.
//
// `jobRunSteps` and `ciCommands` in `scripts/gate-properties.spec.mjs` both
// collect steps with `matchAll(/- run: (.+)/g)`. Neither anchors the match to
// the start of the line, and `#` is YAML's comment mark, so
// `      # - run: pnpm coverage` yields the command `pnpm coverage`.
//
// Five committed tests rest on those two readers: the CONTRIBUTING roster, the
// release-job roster, the CI roster, the Deno-job order, and the
// coverage-exclusion premise. Round 19 drove them against a DELETED step and
// against a DELETED job, and both are red. A commented-out step is the smaller
// edit, the one a bisect or a "temporarily disable this" commit actually makes,
// and it is green everywhere.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-01 — a commented-out workflow step still counts as a step", () => {
  const CI = ".github/workflows/ci.yml";
  const RELEASE = ".github/workflows/release.yml";

  test("EVIDENCE: the harness is live — a step DELETED from ci.yml is red", () => {
    expect(gateExit({ [CI]: edit(repoText(CI), "      - run: pnpm coverage\n", "") })).not.toBe(0);
  });

  test("EVIDENCE: the reader itself yields a command from a commented line", () => {
    const commented = "      # - run: pnpm coverage\n      - run: pnpm test\n";
    expect([...commented.matchAll(/- run: (.+)/g)].map((m) => m[1])).toEqual([
      "pnpm coverage",
      "pnpm test",
    ]);
  });

  test("commenting the same step OUT of ci.yml fails some gate", () => {
    expect(
      gateExit({
        [CI]: edit(repoText(CI), "      - run: pnpm coverage", "      # - run: pnpm coverage"),
      }),
      "`pnpm coverage` is the gate that enforces the four 100 percent thresholds, and it is " +
        "commented out of .github/workflows/ci.yml here. Every roster gate in " +
        "scripts/gate-properties.spec.mjs collects steps with an unanchored /- run: (.+)/, so " +
        "the disabled step is still read as a step CI runs and every gate stays green",
    ).not.toBe(0);
  });

  test("and commenting a gate out of the RELEASE job fails some gate", () => {
    // The same hole where it publishes. `release.yml`'s `package` job is the
    // roster that runs before `npm publish`, and `verify-pack` is the gate that
    // refuses a code-less tarball.
    expect(
      gateExit({
        [RELEASE]: edit(
          repoText(RELEASE),
          "      - run: pnpm verify-pack",
          "      # - run: pnpm verify-pack",
        ),
      }),
      "`pnpm verify-pack` is commented out of the `package` job of " +
        ".github/workflows/release.yml — the job that runs immediately before publish — and " +
        "the roster gate that asserts the release job runs every gate in CONTRIBUTING's order " +
        "reads the commented line as a step and stays green",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The runtime roster gate reads a WORD anywhere in a document, so the
//    roster sentence itself can be deleted.
//
// `both contributor rosters name every runtime CI smokes` asserts
// `contributing.includes("Bun")`. CONTRIBUTING.md spells `Bun` twice: once in
// the roster sentence round 19 wrote, and once in an unrelated paragraph about
// which runtime locks a stream on `getReader()`. Deleting the roster sentence
// leaves the second one, so the document stops telling a contributor that CI
// smokes Bun and the gate reads no change at all.
//
// This is R19-H4-02 restored by a smaller edit than the one that opened it.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-02 — the roster gate reads a word, not the roster", () => {
  const DOC = "CONTRIBUTING.md";
  const SENTENCE = "CI additionally runs Bun, Deno, and Node-floor runtime smokes.";

  test("EVIDENCE: the word survives the sentence, in an unrelated paragraph", () => {
    const withoutSentence = edit(repoText(DOC), SENTENCE, "");
    expect(withoutSentence).toContain("Bun");
    expect(withoutSentence).not.toContain(SENTENCE);
  });

  test("deleting CONTRIBUTING's runtime roster sentence fails some gate", () => {
    expect(
      gateExit({ [DOC]: edit(repoText(DOC), SENTENCE, "") }),
      "the only sentence in CONTRIBUTING.md that tells a contributor which runtimes CI smokes " +
        "is deleted here, which is the document half of R19-H4-02. The gate round 19 added " +
        "asks whether the whole document contains the word `Bun`, and an unrelated paragraph " +
        "about stream locking contains it, so the roster can go with every gate green",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The `v8 ignore` site pin reads where a range OPENS and never where it
//    CLOSES, so an existing range can be widened over any number of lines.
//
// The pin's own message says it exists so that an edit to a range "belongs in
// the diff a reviewer reads" and is "a reviewable diff instead of a silent
// widening". It records each site as `file → the line the directive guards`,
// and `IGNORE_DIRECTIVE` excludes the `stop` marker by design. Moving that
// marker down changes neither the opening line, nor the guarded line, nor the
// justification above it — and every line it newly swallows leaves the
// denominator of the same 100 percent threshold.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-03 — a `v8 ignore` range can be widened without moving its pin", () => {
  const SOURCE = "src/response-verdict.ts";
  const NARROW = [
    "  if (!validatedResponseStructures.has(response)) return false;",
    "  /* v8 ignore stop */",
    "  if (!hasCompatibleForeignHeaders(headersOf(response))) return false;",
    "  if (!hasTypedResponseIdentityScalars(response)) return false;",
  ].join("\n");
  const WIDENED = [
    "  if (!validatedResponseStructures.has(response)) return false;",
    "  if (!hasCompatibleForeignHeaders(headersOf(response))) return false;",
    "  if (!hasTypedResponseIdentityScalars(response)) return false;",
    "  /* v8 ignore stop */",
  ].join("\n");

  test("EVIDENCE: the widened range keeps the pinned site word for word", () => {
    // What the pin records is `file → the line the directive guards`, and the
    // widening moves neither the directive nor the line under it.
    const widened = edit(repoText(SOURCE), NARROW, WIDENED);
    const openLine = (text) => {
      const lines = text.split("\n");
      const at = lines.findIndex((line) => /v8 ignore(?!\s+(?:stop|end)\b)/.test(line));
      return { open: lines[at].trim(), guards: lines[at + 1].trim() };
    };
    expect(openLine(widened)).toEqual(openLine(repoText(SOURCE)));
    expect(widened).toContain("  // UNREACHABLE, kept as this function's statement of its own");
  });

  test("widening an existing `v8 ignore` range fails some gate", () => {
    expect(
      gateExit({ [SOURCE]: edit(repoText(SOURCE), NARROW, WIDENED) }),
      "the `v8 ignore` range in src/response-verdict.ts is widened here from one line to " +
        "three, so two tested branches leave the denominator of the 100 percent threshold. " +
        "The site pin round 19 added records where a range OPENS and what it guards, and " +
        "`IGNORE_DIRECTIVE` skips the `stop` marker, so the list of six sites is unchanged and " +
        "the gate that exists to refuse `a silent widening` reads no widening at all",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The `v8 ignore` site pin walks `.ts` and `.mjs` only, and the coverage
//    `include` measures every extension the v8 provider instruments.
//
// `measuredSources` accepts a file when `/\.(?:ts|mjs)$/` matches its name.
// `vitest.config.ts` includes `src/**`, `scripts/**` and `fixtures/**` with no
// extension filter, and the v8 provider's own default extension list carries
// `.mts`, `.cts`, `.js`, `.cjs`, `.tsx` and `.jsx` besides. A range in any of
// those is measured by the threshold and read by no gate.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-04 — a `v8 ignore` range in a measured file the walker skips", () => {
  const PROBE = "src/round20-h4-probe.mts";
  const BARE = [
    "export function pick(flag: boolean): string {",
    '  const label = "x";',
    "  /* v8 ignore start */",
    '  if (flag) return "yes-" + label;',
    "  /* v8 ignore stop */",
    '  return "no-" + label;',
    "}",
    "",
  ].join("\n");

  test("EVIDENCE: an `.mts` module under a measured tree reports 100 behind a bare range", () => {
    // The control and the mutation in one project pair, in the shape round 19's
    // own harness runs: the same four thresholds, one uncovered arm.
    const bare = coverageProject("m.mts", BARE);
    const plain = coverageProject(
      "m.mts",
      BARE.replace(/ *\/\* v8 ignore (?:start|stop) \*\/\n/g, ""),
    );
    try {
      const uncovered = runVitest(plain, [
        "--coverage.enabled",
        "--coverage.provider=v8",
        "--coverage.reporter=text",
        // Named, never inherited: vitest adds `text-summary` on its own only
        // where `std-env` reports an AI agent, and the reads below quote the
        // summary lines that reporter prints.
        "--coverage.reporter=text-summary",
      ]);
      expect(uncovered.stdout + uncovered.stderr).toContain("does not meet global threshold");

      const hidden = runVitest(bare, [
        "--coverage.enabled",
        "--coverage.provider=v8",
        "--coverage.reporter=text",
        // Named, never inherited: vitest adds `text-summary` on its own only
        // where `std-env` reports an AI agent, and the reads below quote the
        // summary lines that reporter prints.
        "--coverage.reporter=text-summary",
      ]);
      expect(hidden.stdout + hidden.stderr).not.toContain("does not meet global threshold");
      expect(hidden.stdout).toContain("Statements   : 100%");
      expect(hidden.stdout).toContain("Branches     : 100%");
      expect(hidden.status).toBe(0);
    } finally {
      rmSync(bare, { force: true, recursive: true });
      rmSync(plain, { force: true, recursive: true });
    }
  });

  test("an unjustified range in a measured `.mts` file fails some gate", () => {
    expect(
      gateExit({ [PROBE]: BARE }),
      "src/round20-h4-probe.mts holds a `v8 ignore` range with no justification above it, in a " +
        "tree the coverage `include` measures and at an extension the v8 provider instruments. " +
        "`measuredSources` in scripts/gate-properties.spec.mjs accepts `.ts` and `.mjs` only, " +
        "so neither the six-site pin nor the justification requirement sees the range, and the " +
        "acceptance item 4 gate round 19 added stays green",
    ).not.toBe(0);
  });
});

/**
 * A throwaway vitest project with the repository's own four thresholds, one
 * measured module named `name` holding `source`, and one spec covering half of
 * it. Nothing in the repository is read or written; `node_modules` is borrowed
 * by symlink.
 */
function coverageProject(name, source) {
  // `realpathSync`, because macOS `tmpdir()` is a symlink and vitest's
  // uncovered-file scan would then report the same module under two paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round20-h4-cov-")));
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
  writeFileSync(join(root, `src/${name}`), source);
  writeFileSync(
    join(root, "t/m.spec.ts"),
    [
      'import { expect, test } from "vitest";',
      `import { pick } from "../src/${name}";`,
      'test("covers one arm", () => {',
      '  expect(pick(false)).toBe("no-x");',
      "});",
      "",
    ].join("\n"),
  );
  return root;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. The coverage-exclusion PREMISE gate reads a mention, never an execution
//    under the runtime the premise names.
//
// `vitest.config.ts` drops `scripts/smoke/bun.mjs` and `scripts/smoke/deno.ts`
// from the threshold with a stated reason: "Each smoke runs under a runtime a
// Node worker cannot host, and CI executes it under that runtime. Coverage for
// the two files is measured there or not at all."
//
// The gate round 19 added asks whether SOME `- run:` line in `ci.yml` contains
// the path as a substring. Running the Bun smoke under `node` satisfies it, and
// so does echoing the path. Either leaves the file excluded from the threshold
// and never executed by the runtime whose absence is the whole reason it is
// excluded.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-05 — the exclusion premise is satisfied by naming the path", () => {
  const CI = ".github/workflows/ci.yml";

  test("EVIDENCE: deleting the Bun smoke run step is red", () => {
    // The gate does fire when the path stops being NAMED, which is what round
    // 19 measured. The two mutations below keep the name and drop the premise.
    expect(
      gateExit({ [CI]: edit(repoText(CI), "      - run: bun run scripts/smoke/bun.mjs\n", "") }),
    ).not.toBe(0);
  });

  test("running the Bun smoke under `node` instead fails some gate", () => {
    expect(
      gateExit({
        [CI]: edit(
          repoText(CI),
          "      - run: bun run scripts/smoke/bun.mjs",
          "      - run: node scripts/smoke/bun.mjs",
        ),
      }),
      "the Bun smoke job now runs scripts/smoke/bun.mjs under `node`. The file is excluded " +
        "from the 100 percent threshold precisely because `CI executes it under that runtime`, " +
        "and Bun now executes nothing, so the premise the exclusion rests on is false while " +
        "the gate round 19 added — which asks only whether a `- run:` line contains the path — " +
        "stays green",
    ).not.toBe(0);
  });

  test("and a step that only ECHOES the path fails some gate", () => {
    expect(
      gateExit({
        [CI]: edit(
          repoText(CI),
          "      - run: bun run scripts/smoke/bun.mjs",
          '      - run: echo "skipping scripts/smoke/bun.mjs for now"',
        ),
      }),
      "the Bun smoke job now echoes the path of scripts/smoke/bun.mjs and runs nothing. The " +
        "file is excluded from the 100 percent threshold and executed by no runtime, which is " +
        "the exact state R19-H4-04 was filed for, and the gate that closed R19-H4-04 reads the " +
        "path in the echo and stays green",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. The `[Unreleased]` direction test names the wordings it expects.
//
// Round 19 rewrote the direction rule as a test that reads the block and asks
// the 2.0.1 differential for a witness of each direction the block CLAIMS. What
// it reads the claims with is a fixed list of four phrases — "removed where it
// used to survive", "kept where it used to be deleted", and "moved in both
// directions" twice. A block that states the same direction in any other words
// yields no claim at all, and a test that collects no claim can only pass.
//
// This is R17-H4-02's shape — a pin whose pattern names what it expects, so it
// cannot see what it does not expect — inside the test round 19 wrote to close
// a direction defect.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-06 — the direction test reads four phrases, not the block", () => {
  const CHANGELOG = "CHANGELOG.md";
  const DIRECTION_TEST = "every direction the block names is a direction some input actually took";
  /** A keeps-more claim about the published release, in words the list misses. */
  const UNWITNESSED =
    "The record this release emits also gives back a byte the published 2.0.1 removed. ";
  const ANCHOR =
    "- **`redactUrl`'s output moved for an ordinary input, not only for an\n  attack shape.** ";

  test("EVIDENCE: the mutated block states a direction and holds none of the four phrases", () => {
    const mutated = edit(repoText(CHANGELOG), ANCHOR, ANCHOR + UNWITNESSED);
    const block = mutated.slice(mutated.indexOf("## [Unreleased]")).replaceAll(/\s+/g, " ");
    expect(block).toContain(UNWITNESSED.trim());
    for (const phrase of ["kept where it used to be deleted", "moved in both directions"]) {
      expect(block.slice(0, block.indexOf("## [2."))).not.toContain(phrase);
    }
  });

  test("EVIDENCE: the direction test is live and green on the block as committed", () => {
    expect(specExit("tests/surface/round19-h4-surface.spec.ts", {}, DIRECTION_TEST)).toBe(0);
  });

  test("EVIDENCE: the same claim IN one of the four phrases is red", () => {
    // The positive control. `keepsMore` is empty over round 19's corpus, so the
    // direction test refuses this block — and the only difference between this
    // mutation and the one below is the wording of the sentence.
    expect(
      specExit(
        "tests/surface/round19-h4-surface.spec.ts",
        {
          [CHANGELOG]: edit(
            repoText(CHANGELOG),
            ANCHOR,
            `${ANCHOR}A byte is kept where it used to be deleted. `,
          ),
        },
        DIRECTION_TEST,
      ),
    ).not.toBe(0);
  });

  test("a keeps-more claim in other words fails the direction test", () => {
    expect(
      specExit(
        "tests/surface/round19-h4-surface.spec.ts",
        { [CHANGELOG]: edit(repoText(CHANGELOG), ANCHOR, ANCHOR + UNWITNESSED) },
        DIRECTION_TEST,
      ),
      "the `[Unreleased]` block now says the record gives back a byte the published 2.0.1 " +
        "removed. That is the keeps-more direction, and round 19 measured it over the same " +
        "corpus at zero witnesses — the exact state R19-H4-01 was filed for. The test round 19 " +
        "wrote to close R19-H4-01 collects claims by matching four fixed phrases, none of " +
        "which this sentence uses, so it reads no claim and passes",
    ).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. The abort-in-prologue assertion, still landed in one smoke of three.
//
// `scripts/smoke/node-min.mjs` step 4 aborts a controller BEFORE the call and
// asserts the returned error is an `AbortedError` — the classification of a
// signal that was already aborted when `typedFetch` was entered. The behavior
// is measured true on Node, Bun and Deno, and `.audit-state.json` has carried
// the gap as an unlanded item since round 19 because no lane owned
// `scripts/smoke/**`.
//
// A state-file entry is not a gate. the Bun and Deno smoke jobs are two of the
// three runtime jobs `release.yml` inherits, and neither can fail on a runtime
// that classifies an already-aborted signal as anything else.
// ═══════════════════════════════════════════════════════════════════════════

describe("R20-H4-07 — every runtime smoke asserts the abort-in-prologue classification", () => {
  const SMOKES = ["scripts/smoke/node-min.mjs", "scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"];

  // ORCHESTRATOR REPAIR, round 20. As written, this test asserted that
  // `node-min.mjs` was the ONLY carrier — the literal negation of what the two
  // cases below demand — so the describe block was unsatisfiable as a whole and
  // landing the fix necessarily turned this row red. That is the third time
  // this round's own instruments could not survive their own fix, after
  // R19-H1-02 and R19-H4-01. An EVIDENCE row states the invariant that must
  // hold AFTER the fix, and carries the pre-fix state as history in prose.
  //
  // Pre-fix state, for the record: only `scripts/smoke/node-min.mjs` carried
  // the assertion, and the Bun and Deno smokes constructed no `AbortController`
  // at all, while `release.yml` inherits all three runtime jobs.
  test("EVIDENCE: every smoke carries it, and each aborts a controller to do so", () => {
    const carriers = SMOKES.filter((file) => repoText(file).includes("AbortedError"));
    expect(carriers).toEqual(SMOKES);
    for (const file of SMOKES) {
      expect(
        repoText(file),
        `${file} must abort a controller, not merely name the class`,
      ).toContain("controller.abort(");
    }
  });

  test.each(SMOKES)("%s aborts before the call and asserts AbortedError", (file) => {
    const source = repoText(file);
    expect(
      source.includes("AbortController") && source.includes("AbortedError"),
      `${file} is one of the three runtime smokes .github/workflows/ci.yml runs and ` +
        "release.yml inherits, and it never passes an already-aborted signal to `typedFetch`. " +
        "scripts/smoke/node-min.mjs step 4 does, the classification is measured true on Node, " +
        "Bun and Deno, and the gap has sat in .audit-state.json as an unlanded item instead of " +
        "in a file that can fail",
    ).toBe(true);
  });
});
