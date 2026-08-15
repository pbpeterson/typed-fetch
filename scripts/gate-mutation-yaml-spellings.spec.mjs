// ═══════════════════════════════════════════════════════════════════════════
// ROUND 23, LANE H4 — round 22's repairs, and the two gates no round has run.
//
// Round 22 taught two readers a new question and drove two of the four gates
// for the first time. This file asks the same thing of ROUND 22's repairs and
// answers it twice, then finishes the job round 22 left open.
//
//  * `jobNeeds` says in its own doc comment that it reads `needs:` "in each of
//    the three spellings YAML accepts". YAML accepts more than three. A block
//    sequence written at the KEY's own indentation, and a flow sequence broken
//    across lines, are both read as NO dependency at all — so the transitive
//    closure R22-H4-01 added has nothing to close over, and the job that runs
//    the Bun smoke is skipped with every roster green. Fifteenth appearance.
//  * A disabling key is read with `/^([\w-]+):/`, which is the UNQUOTED
//    spelling only. `"if": false` is the same mapping key to YAML, so one pair
//    of quotation marks skips `pnpm verify-pack` in the job that runs
//    immediately before publish. R21-H4-01 restored by the smaller edit, for
//    the second round running.
//
// And the two gates round 22 called a BUDGET wall. They are not: on this
// machine `pnpm check-consumer` takes 5.8 s and `pnpm check-deno-consumer`
// 0.9 s. Both take the package directory to pack through `io.cwd`, so a
// MATERIALIZED package root — the round-22 lesson, because `npm pack` does not
// descend a symlink — drives each one against a package this repository does
// not ship, with `node_modules` linked in for the consumer's `tsc` alone.
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
import { defaultIo as consumerIo, main as consumerMain } from "./check-consumer.mjs";
import { defaultIo as denoIo, main as denoMain } from "./check-deno-consumer.mjs";

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round23-h4-")));
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

/** The exit status of `scripts/gate-properties.spec.mjs` over a mutated root. */
function gateExit(overrides) {
  const spec = "scripts/gate-properties.spec.mjs";
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
 * This repository ships and installs no YAML parser, on purpose. Bun's is built
 * in, and CI runs a Bun job, so every mutation below is read back as the
 * STRUCTURE GitHub Actions receives wherever a Bun binary exists, and asserted
 * as text everywhere else.
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
// 1. TWO MORE SPELLINGS OF `needs:`, AND THE CLOSURE HAS NOTHING TO CLOSE.
//
// R22-H4-01 taught `runningJobs` that a job skipped through its dependency
// chain supplies no roster. The closure is right. Its input is not: `jobNeeds`
// reads the `needs:` line and, when that line carries no inline names, walks
// the lines under it with `/^ {5,}- *(.+)$/`.
//
//   needs:            ← YAML block sequence at the KEY's own indentation.
//   - preflight         Four spaces, not five. The walk breaks on the first
//                       line and answers "no dependencies".
//
//   needs: [          ← YAML flow sequence broken across lines. The inline
//     preflight         read strips the bracket and finds nothing; the block
//   ]                   walk then breaks on a line that is not a `- ` item.
//
// Both are ordinary YAML, both are what GitHub Actions receives, and both put
// the Bun smoke job behind a job written `if: false` with `scripts/smoke/bun.mjs`
// still excluded from the 100 percent threshold and both runtime rosters green.
// R19-H4-04's own state, restored for the fifteenth time.
//
// NO JOB IS NAMED HERE, and the omission is round 21's, kept: a job is located
// by the COMMAND it runs, which `scripts/gate-mutation-ignore-ranges.spec.mjs` requires.
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

/** A job that never runs, written in front of every other job. */
const PREFLIGHT = [
  "  preflight:",
  "    if: false",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo preflight",
  "",
].join("\n");

/** `ci.yml` with the Bun smoke job made to wait on `preflight`, spelled `needs`. */
function skipBunThroughNeeds(ci, needs) {
  const withPreflight = edit(ci, "jobs:\n", `jobs:\n${PREFLIGHT}`);
  const job = jobCarrying(withPreflight, BUN_STEP);
  return `${withPreflight.slice(0, job.keys)}${needs}${withPreflight.slice(job.keys)}`;
}

/** The three spellings, each as its YAML text and what the roster must do. */
const NEEDS_SPELLINGS = {
  "a scalar": "    needs: preflight\n",
  "a block sequence at the key's own indentation": "    needs:\n    - preflight\n",
  "a flow sequence broken across lines": "    needs: [\n      preflight\n    ]\n",
};

describe("R23-H4-01 — two more spellings of `needs:` hand the roster a skipped job", () => {
  test("CONTROL: the spelling round 22 closed is still red", () => {
    expect(
      gateExit({ [CI]: skipBunThroughNeeds(repoText(CI), NEEDS_SPELLINGS["a scalar"]) }),
    ).not.toBe(0);
  }, 180_000);

  test.skipIf(!YAML)("EVIDENCE: all three spellings are one dependency to a YAML reader", () => {
    for (const needs of Object.values(NEEDS_SPELLINGS)) {
      const mutated = skipBunThroughNeeds(repoText(CI), needs);
      const jobs = parseYaml(mutated).jobs;
      const job = jobs[jobCarrying(mutated, BUN_STEP).name];
      expect(jobs.preflight.if).toBe(false);
      expect([job.needs].flat()).toEqual(["preflight"]);
      expect(job.if).toBeUndefined();
      expect(job.steps.at(-1).run).toBe("bun run scripts/smoke/bun.mjs");
    }
  });

  test("a `needs:` written as a block sequence at the key's own indentation fails some gate", () => {
    expect(
      gateExit({
        [CI]: skipBunThroughNeeds(
          repoText(CI),
          NEEDS_SPELLINGS["a block sequence at the key's own indentation"],
        ),
      }),
      "the job that runs the Bun smoke waits on a job written `if: false`, spelled as a YAML " +
        "block sequence at the key's own indentation — `needs:` then `- preflight` at four " +
        "spaces, which is ordinary YAML and is what GitHub Actions receives. `jobNeeds` in " +
        "scripts/gate-properties.spec.mjs walks the lines under the key with `/^ {5,}- *(.+)$/` " +
        "and answers NO dependencies, so R22-H4-01's transitive closure closes over nothing. " +
        "vitest.config.ts drops scripts/smoke/bun.mjs from the 100 percent threshold because CI " +
        "executes it under Bun, and both contributor rosters name Bun among the runtimes CI " +
        "smokes, so the file is excluded from the threshold, executed by nothing, and read by " +
        "no gate. CONTRIBUTING.md tells a contributor that a `needs:` on a job written " +
        "`if: false` fails the roster",
    ).not.toBe(0);
  }, 180_000);

  test("a `needs:` written as a flow sequence broken across lines fails some gate", () => {
    expect(
      gateExit({
        [CI]: skipBunThroughNeeds(
          repoText(CI),
          NEEDS_SPELLINGS["a flow sequence broken across lines"],
        ),
      }),
      "the same skip, spelled as a YAML flow sequence broken across lines. `jobNeeds` reads the " +
        "`needs:` line alone for inline names, strips the bracket, finds nothing, and then walks " +
        "for `- ` items that a flow sequence does not have — so the job reads as depending on " +
        "nothing while GitHub Actions skips it behind `preflight`",
    ).not.toBe(0);
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A QUOTED DISABLING KEY IS NO KEY AT ALL TO THE ROSTER.
//
// Both readers spell a mapping key as `/^([\w-]+):/`:
//
//     const key = /^([\w-]+):/.exec(line.slice(open.indent + 2));   // steps
//     [...body.matchAll(/^ {4}([\w-]+):/gm)]                        // jobs
//
// YAML lets any key be quoted, and `"if"` and `if` are the same key. So
// `"if": false` under `- run: pnpm verify-pack` skips the gate that refuses a
// code-less tarball, in the job that runs immediately before `npm publish`,
// with the release roster green — and `"if": false` on the job that runs the
// Bun smoke restores R19-H4-04 one level out.
//
// That is R21-H4-01 and R21-ORCH-01 at a spelling neither closed. The family
// reaches sixteen.
// ═══════════════════════════════════════════════════════════════════════════

const VERIFY_STEP = "      - run: pnpm verify-pack\n";
const DISABLED = `${VERIFY_STEP}        if: false\n`;
const DISABLED_QUOTED = `${VERIFY_STEP}        "if": false\n`;

describe("R23-H4-02 — a quoted disabling key is invisible to every roster", () => {
  test("CONTROL: the same key unquoted is red", () => {
    expect(gateExit({ [RELEASE]: edit(repoText(RELEASE), VERIFY_STEP, DISABLED) })).not.toBe(0);
  }, 180_000);

  test.skipIf(!YAML)("EVIDENCE: quoted and bare are the same step mapping to a YAML reader", () => {
    const step = (block) => parseYaml(`steps:\n${block}`).steps[0];
    expect(step(DISABLED)).toEqual({ run: "pnpm verify-pack", if: false });
    expect(step(DISABLED_QUOTED)).toEqual({ run: "pnpm verify-pack", if: false });
  });

  test('`"if": false` under `- run: pnpm verify-pack` fails some gate', () => {
    expect(
      gateExit({ [RELEASE]: edit(repoText(RELEASE), VERIFY_STEP, DISABLED_QUOTED) }),
      "`pnpm verify-pack` is the gate that refuses a code-less tarball, and it is disabled with " +
        'a quoted `"if": false` in the `package` job of .github/workflows/release.yml — the job ' +
        "that runs immediately before publish. `stepBlocks` in " +
        "scripts/gate-properties.spec.mjs reads a step's keys with `/^([\\w-]+):/`, which is the " +
        "unquoted spelling only, so one pair of quotation marks hides the condition from every " +
        "roster while GitHub Actions reads the identical step mapping and skips it. " +
        "CONTRIBUTING.md tells a contributor that an `if: false` under a run line fails the " +
        "roster. R21-H4-01, restored by a smaller edit again",
    ).not.toBe(0);
  }, 180_000);

  test('`"if": false` on the JOB that runs the Bun smoke fails some gate', () => {
    const ci = repoText(CI);
    const job = jobCarrying(ci, BUN_STEP);
    expect(
      gateExit({ [CI]: `${ci.slice(0, job.keys)}    "if": false\n${ci.slice(job.keys)}` }),
      'the job that executes scripts/smoke/bun.mjs carries a quoted `"if": false` at its own ' +
        "key indentation. `workflowJobs` collects a job's disabling keys with " +
        "`/^ {4}([\\w-]+):/gm`, which reads the unquoted spelling only, so `runningJobs` reports " +
        "the job as running. vitest.config.ts drops that file from the 100 percent threshold " +
        "because CI executes it under Bun, and both contributor rosters name Bun. R21-ORCH-01, " +
        "restored by a pair of quotation marks",
    ).not.toBe(0);
  }, 180_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE LAST TWO GATES, DRIVEN.
//
// Round 22 drove `verify-pack` and `validate-release` and called
// `check-consumer` and `check-deno-consumer` a BUDGET wall, because each packs
// a tarball and runs a real install. Measured, they are the two CHEAPEST gates
// this repository has: 5.8 s and 0.9 s on this machine, because the package
// declares no runtime dependency, so the install resolves nothing over the
// network.
//
// Neither needs a scratch REPOSITORY at all. Each takes the directory to pack
// through `io.cwd`, so a materialized package root — `package.json`, the two
// documents npm always packs, `dist/`, and the `errors/package.json` stub — is
// a complete world. It is MATERIALIZED and not mirrored, because `npm pack`
// does not descend a symlinked directory, which is the lesson round 22 paid
// three rounds for. `node_modules` is the one link, and it is never packed:
// `check-consumer` resolves the consumer's own `tsc` under `io.cwd`, and npm
// excludes `node_modules` from every tarball.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A package root holding exactly what `files` ships, with `package.json`
 * rewritten by `mutate`. Materialized; `node_modules` is linked for `tsc`.
 */
function materializedPackage(mutate = (manifest) => manifest) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tf-round23-h4-pkg-")));
  for (const file of ["README.md", "LICENSE"]) cpSync(join(REPO_ROOT, file), join(root, file));
  cpSync(join(REPO_ROOT, "dist"), join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "errors"));
  cpSync(join(REPO_ROOT, "errors/package.json"), join(root, "errors/package.json"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  const manifest = mutate(JSON.parse(repoText("package.json")));
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

/** Run `main` over a materialized package root, answering its exit and output. */
function driveGate(main, root) {
  const lines = [];
  let status = 0;
  main({
    argv: [process.execPath, "gate"],
    cwd: root,
    env: { ...process.env },
    out: (message) => lines.push(message),
    err: (message) => lines.push(message),
    exit: (code) => {
      status = code;
    },
  });
  return { status, out: lines.join("\n") };
}

/** The same, over a package root built and thrown away for one call. */
function gateOverPackage(main, mutate) {
  const root = materializedPackage(mutate);
  try {
    return driveGate(main, root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** `manifest` with one subpath removed from the `exports` map. */
const withoutSubpath = (subpath) => (manifest) => {
  const exports = { ...manifest.exports };
  expect(exports, `package.json must export ${subpath}`).toHaveProperty([subpath]);
  delete exports[subpath];
  return { ...manifest, exports };
};

describe("EVIDENCE — `check-consumer`, driven over a materialized package", () => {
  test("the control passes, and both exports-map deletions are refused", () => {
    const control = gateOverPackage(consumerMain);
    expect(
      control.out,
      "the materialized package must carry a real build for the control to mean anything",
    ).toContain("✔ check-consumer: OK");
    expect(control.status).toBe(0);

    const noErrors = gateOverPackage(consumerMain, withoutSubpath("./errors"));
    expect(noErrors.out).toContain("subpath:probe");
    expect(noErrors.status).toBe(1);

    const noManifest = gateOverPackage(consumerMain, withoutSubpath("./package.json"));
    expect(noManifest.out).toContain("resolve:package-json-subpath");
    expect(noManifest.status).toBe(1);
  }, 180_000);

  test("EVIDENCE: the gate packs `io.cwd`, so the control never reads this repository", () => {
    // The whole harness rests on this: `defaultIo.cwd` is the repository root,
    // and the drive above replaces it. A gate that ignored `cwd` would have
    // been measuring the tree the audit is standing in.
    expect(consumerIo.cwd).toBe(REPO_ROOT);
    expect(denoIo.cwd).toBe(REPO_ROOT);
  });
});

/** Whether a Deno 2 binary this gate can use is installed. */
const DENO = (() => {
  const child = spawnSync("deno", ["--version"], { encoding: "utf8" });
  return child.status === 0 && /(?:^|\n)deno [2-9]/.test(child.stdout);
})();

describe("EVIDENCE — `check-deno-consumer`, driven over the same root", () => {
  test.skipIf(!DENO)(
    "the control passes and a deleted `./errors` subpath is refused",
    () => {
      const control = gateOverPackage(denoMain);
      expect(control.out).toContain("deno consumer: OK");
      expect(control.status).toBe(0);

      const mutated = gateOverPackage(denoMain, withoutSubpath("./errors"));
      expect(mutated.out).toContain("deno consumer: FAILED");
      expect(mutated.status).toBe(1);
    },
    180_000,
  );
});
