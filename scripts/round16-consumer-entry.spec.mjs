// Round 16, coverage sub-lane C1 — the two consumer gates as PROCESSES.
//
// `check-consumer.spec.mjs` and `check-deno-consumer.spec.mjs` cover every
// exported decision these two files hold, and between them they cover 52 of the
// 193 statements. Everything left uncovered sits behind `main()`, which neither
// file exports, so no spec can call it. Section 8.5 option (b) is the way in and
// a FIXER performs it; a hunter reports the blocker.
//
// What a spec CAN reach today is the entry point as the shell reaches it, and
// section 8.7 names the outcome set that is worth asserting there. The sibling
// specs assert one of the four — "it reaches main()". This file asserts the
// other three, for the failure classes that are cheap to drive:
//
//   - the exit code, per failure class;
//   - the substring a reader looks for in the output;
//   - the side effects on disk, and their ABSENCE.
//
// Both gates are driven with a PATH that resolves only what each test wants
// them to find, and with a TMPDIR this file owns, so "the gate left nothing
// behind" is a measurement over one directory rather than a scan of the shared
// system temp directory that every other worker also writes to.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import {
  consumerTsconfig,
  cjsAssertions,
  crossCopyAssertions,
  crossformatAssertions,
  defaultIo as checkConsumerDefaultIo,
  esmAssertions,
  indent,
  judgeConsumer,
  KNOWN_FAILING,
  main as checkConsumerMain,
  printConsumerReport,
  resolutionAssertions,
  subpathAssertions,
  typecheckAssertion,
  TYPECHECK_PASSES,
} from "./check-consumer.mjs";
import {
  DENO_CONSUMER_SOURCE,
  defaultIo as checkDenoConsumerDefaultIo,
  judgeDenoVersion,
  main as checkDenoConsumerMain,
} from "./check-deno-consumer.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const CHECK_CONSUMER = join(SCRIPT_DIR, "check-consumer.mjs");
const CHECK_DENO_CONSUMER = join(SCRIPT_DIR, "check-deno-consumer.mjs");

const scratch = createScratchDir("tf-round16-c1-");
afterAll(() => scratch.dispose());

/** A bin directory holding only what a test puts in it. */
function binDir(name) {
  const path = join(scratch.path, `bin-${name}`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** Install a fake executable that prints `stdout` and exits with `code`. */
function fakeExecutable(dir, name, stdout, code = 0) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(stdout)}\nexit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * Run a gate with a PATH holding only `bin`, and a temp directory this file
 * owns, so a leaked scratch directory is visible and attributable.
 *
 * @returns {{ status: number, output: string, tempEntries: string[] }}
 */
function runGate(entry, bin) {
  const temp = join(scratch.path, `tmp-${Math.random().toString(36).slice(2)}`);
  mkdirSync(temp, { recursive: true });
  const result = spawnSync(process.execPath, [entry], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: bin,
      Path: bin,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
    },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    tempEntries: readdirSync(temp),
  };
}

/** Every tarball sitting in the repository root. The gates must add none. */
function repoTarballs() {
  return readdirSync(REPO_ROOT).filter((name) => name.endsWith(".tgz"));
}

const onPosix = process.platform !== "win32";

describe.skipIf(!onPosix)("check-consumer — the entry point's failure classes", () => {
  let tarballsBefore;
  let run;

  beforeAll(() => {
    tarballsBefore = repoTarballs();
    // `packTarball` is main()'s first real act. With nothing on PATH, `npm` is
    // an ENOENT, which is the cheapest way to drive the gate's first documented
    // failure class without paying for a pack and an install.
    run = runGate(CHECK_CONSUMER, binDir("empty"));
  }, 60000);

  test("a failed pack exits 1", () => {
    expect(run.status).toBe(1);
  });

  test("a failed pack names the step a reader has to fix", () => {
    // The substring a reader greps for, never the whole rendered block: the
    // banner proves main() ran, and the error line names which of main()'s five
    // steps stopped it.
    expect(run.output).toContain("Packing @pbpeterson/typed-fetch");
    expect(run.output).toContain("npm pack failed");
    // The report footer belongs to a run that got as far as judging something.
    // A gate that printed it here would be claiming a verdict it never reached.
    expect(run.output).not.toContain("Consumer contract report");
    expect(run.output).not.toContain("check-consumer: OK");
  });

  test("a failed pack leaves no scratch directory and writes nothing into the repository", () => {
    // `createScratchDir` installs an `exit` handler, and `process.exit(1)` from
    // the pack branch is exactly the early exit that handler exists for. The
    // gate is a release gate, so a run that fails must not seed the next run
    // with a stale tarball either.
    expect(run.tempEntries).toEqual([]);
    expect(repoTarballs()).toEqual(tarballsBefore);
  });
});

describe.skipIf(!onPosix)("check-deno-consumer — the entry point's failure classes", () => {
  test("a Deno older than 2 is refused with the requirement, exit 1, and no scratch directory", () => {
    // The one decision this gate makes before it spends anything, driven through
    // the entry point rather than through `judgeDenoVersion` directly. The gate
    // exists because Deno 1 cannot resolve an unpublished local tarball from
    // node_modules, so a Deno 1 that ran anyway would report a green typecheck
    // of nothing at all.
    const bin = binDir("deno1");
    fakeExecutable(bin, "deno", "deno 1.46.3");
    const tarballsBefore = repoTarballs();

    const run = runGate(CHECK_DENO_CONSUMER, bin);

    expect(run.status).toBe(1);
    expect(run.output).toContain("deno consumer: FAILED");
    expect(run.output).toContain("requires Deno 2 or later");
    expect(run.output).not.toContain("deno consumer: OK");
    // The version check runs before the scratch directory exists, so the gate
    // must not have created one — and must not have packed into the repository.
    expect(run.tempEntries).toEqual([]);
    expect(repoTarballs()).toEqual(tarballsBefore);
  }, 60000);

  test("a Deno 2 passes the version gate and fails on the next step instead", () => {
    // Non-vacuity for the test above: the refusal has to come from the VERSION,
    // not from the gate failing for any reason at all. With a Deno 2 on PATH and
    // no `npm` beside it, the gate gets past `judgeDenoVersion` and dies in
    // `packTarball` — a different message, the same exit code.
    const bin = binDir("deno2");
    fakeExecutable(bin, "deno", "deno 2.4.1");

    const run = runGate(CHECK_DENO_CONSUMER, bin);

    expect(run.status).toBe(1);
    expect(run.output).toContain("deno consumer: FAILED");
    expect(run.output).not.toContain("requires Deno 2 or later");
  }, 60000);
});

describe("check-deno-consumer — what the gate actually typechecks", () => {
  test("every import in the consumer source resolves through the package name", () => {
    // The one behavior this gate exists for. It packs, installs, and asks Deno
    // to typecheck a BARE package import, because the runtime smoke imports the
    // built `.mjs` directly and therefore proves nothing about the exports map.
    // A specifier that reached into the repository — `../dist/index.d.mts`, or
    // an absolute path — would typecheck green while the exports map, the
    // `errors/package.json` stub, and the published declarations all went
    // unread. Nothing else in this repository asserts that.
    const specifiers = [...DENO_CONSUMER_SOURCE.matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("@pbpeterson/typed-fetch")).toBe(true);
    }
    // Both entry points, not just the main one: the subpath has its own exports
    // entry, its own declaration file, and its own stub.
    expect(new Set(specifiers)).toEqual(
      new Set(["@pbpeterson/typed-fetch", "@pbpeterson/typed-fetch/errors"]),
    );
  });

  test("the gate script it drives is on disk where the entry-point tests point", () => {
    // Guards the two describes above against silently skipping their subject: a
    // renamed gate would make every `runGate` call fail for ENOENT and the
    // substrings would stop matching for the wrong reason.
    expect(existsSync(CHECK_DENO_CONSUMER)).toBe(true);
    expect(existsSync(CHECK_CONSUMER)).toBe(true);
  });
});

// =============================================================================
// check-consumer.mjs — the exported pure decisions, called directly.
//
// This measurement command runs ONLY this file and round16-release-entry, so
// the coverage `check-consumer.spec.mjs` already holds for these functions
// does not count here. None of these functions branch internally except
// `judgeConsumer`, `typecheckAssertion`, and `consumerTsconfig` — the six
// probe mappers are straight-line object builders, so one real call each
// reaches every statement they hold.
// =============================================================================

describe("check-consumer.mjs — the probe mappers, reached directly", () => {
  const GREEN_ESM = {
    responseNull: true,
    isHttpError: true,
    isKnownHttpError: true,
    instanceofNotFound: true,
    status404: true,
    name: "NotFoundError",
    customIsHttp: true,
    customIsNotKnown: true,
    injectedCalled: true,
    injectedNotFound: true,
    abortIsAborted: true,
    abortReason: true,
    timeoutIsTimeout: true,
    timeoutName: "TimeoutError",
    requestPreAbortName: "AbortedError",
    requestPreAbortIsAborted: true,
  };

  test("esmAssertions builds 13 assertions from a probe record", () => {
    const verdict = esmAssertions(GREEN_ESM);
    expect(verdict.results).toHaveLength(13);
    expect(verdict.results.every((a) => a.ok)).toBe(true);
  });

  test("cjsAssertions builds 5 assertions from a probe record", () => {
    const verdict = cjsAssertions({
      responseNull: true,
      isHttpError: true,
      isKnownHttpError: true,
      instanceofNotFound: true,
      status404: true,
      name: "NotFoundError",
    });
    expect(verdict.results).toHaveLength(5);
    expect(verdict.results.every((a) => a.ok)).toBe(true);
  });

  test("subpathAssertions builds 3 assertions from a probe record", () => {
    const verdict = subpathAssertions({
      name: "NotFoundError",
      instanceofSubpathNotFound: true,
      instanceofSubpathBase: true,
      mainGuardStillTrue: true,
    });
    expect(verdict.results).toHaveLength(3);
    expect(verdict.results.every((a) => a.ok)).toBe(true);
  });

  test("crossformatAssertions builds 2 assertions and 1 note", () => {
    const verdict = crossformatAssertions({
      name: "NotFoundError",
      cjsGuardOnEsmError: true,
      cjsKnownGuardOnEsmError: true,
      cjsInstanceofOnEsmError: false,
    });
    expect(verdict.results).toHaveLength(2);
    expect(verdict.notes).toHaveLength(1);
  });

  test("crossCopyAssertions builds 3 assertions from a probe record", () => {
    const verdict = crossCopyAssertions({
      acceptsCorrectBranch: true,
      bothCancelsSettle: true,
      refusesDifferentResponse: true,
      branchReleased: true,
      originalCancelSettles: true,
    });
    expect(verdict.results).toHaveLength(3);
    expect(verdict.results.every((a) => a.ok)).toBe(true);
  });

  test("resolutionAssertions builds 6 assertions from a probe record", () => {
    const verdict = resolutionAssertions({
      pkgJsonResolves: true,
      pkgJsonName: "@pbpeterson/typed-fetch",
      stubExists: true,
      stubFields: ["main", "module", "types"],
      stubTargetsExist: true,
      node10Loads: true,
      node10SameFileAsExports: true,
    });
    expect(verdict.results).toHaveLength(6);
    expect(verdict.results.every((a) => a.ok)).toBe(true);
  });

  test("indent prefixes every line, including blank ones", () => {
    expect(indent("a\n\nb")).toBe("      a\n      \n      b");
  });
});

describe("check-consumer.mjs — judgeConsumer, the KNOWN_FAILING bookkeeping", () => {
  const pass = (id) => ({ id, ok: true, detail: "" });
  const fail = (id, detail = "nope") => ({ id, ok: false, detail });

  test("an all-green run with an empty KNOWN_FAILING is ok", () => {
    const verdict = judgeConsumer({ results: [pass("a")], notes: [], knownFailing: new Set() });
    expect(verdict.ok).toBe(true);
    expect(verdict.counts).toEqual({
      total: 1,
      passed: 1,
      known: 0,
      informational: 0,
      unexpectedFail: 0,
      unexpectedPass: 0,
    });
  });

  test("an untracked failure fails the gate", () => {
    const verdict = judgeConsumer({
      results: [pass("a"), fail("b")],
      notes: [],
      knownFailing: new Set(),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unexpectedFailures.map((r) => r.id)).toEqual(["b"]);
  });

  test("a tracked failure does not fail the gate, but a stale pass does", () => {
    const tracked = judgeConsumer({
      results: [pass("a"), fail("b")],
      notes: [{ id: "n", detail: "informational" }],
      knownFailing: new Set(["b"]),
    });
    expect(tracked.ok).toBe(true);
    expect(tracked.knownFailures.map((r) => r.id)).toEqual(["b"]);
    expect(tracked.counts.informational).toBe(1);

    const stale = judgeConsumer({
      results: [pass("b")],
      notes: [],
      knownFailing: new Set(["b"]),
    });
    expect(stale.ok).toBe(false);
    expect(stale.unexpectedPasses.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("check-consumer.mjs — typecheckAssertion and consumerTsconfig", () => {
  test("typecheckAssertion carries the compiler output only on failure", () => {
    expect(typecheckAssertion({ id: "bundler" }, { ok: true, output: "" }).detail).toBe("");
    const failed = typecheckAssertion({ id: "nodenext" }, { ok: false, output: "boom" });
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain("tsc(nodenext) errors:");
  });

  test("consumerTsconfig covers every declared pass's module/lib/typeRoots shape", () => {
    // Iterating every TYPECHECK_PASSES entry exercises every conditional in
    // consumerTsconfig: the nodenext/node16 module-kind ternary (both arms and
    // the neither-arm default), exactOptionalPropertyTypes, ignoreDeprecations,
    // and typeRoots, each present on at least one pass and absent on another.
    const typeRoots = ["/repo/node_modules/@types"];
    for (const pass of TYPECHECK_PASSES) {
      const cfg = consumerTsconfig(pass, typeRoots);
      expect(cfg.files).toEqual(pass.files);
      expect(cfg.compilerOptions.moduleResolution).toBe(pass.moduleResolution);
    }
    const nodenext = consumerTsconfig(
      TYPECHECK_PASSES.find((p) => p.id === "nodenext"),
      typeRoots,
    );
    expect(nodenext.compilerOptions.module).toBe("nodenext");
    const bundler = consumerTsconfig(
      TYPECHECK_PASSES.find((p) => p.id === "bundler"),
      typeRoots,
    );
    expect(bundler.compilerOptions.module).toBe("esnext");
    const eopt = consumerTsconfig(
      TYPECHECK_PASSES.find((p) => p.id === "node-eopt"),
      typeRoots,
    );
    expect(eopt.compilerOptions.exactOptionalPropertyTypes).toBe(true);
    const node10 = consumerTsconfig(
      TYPECHECK_PASSES.find((p) => p.id === "node10"),
      typeRoots,
    );
    expect(node10.compilerOptions.ignoreDeprecations).toBe("6.0");
    const withTypes = consumerTsconfig(
      TYPECHECK_PASSES.find((p) => p.id === "node-without-dom"),
      typeRoots,
    );
    expect(withTypes.compilerOptions.typeRoots).toEqual(typeRoots);
  });
});

// =============================================================================
// check-consumer.mjs — main() and printConsumerReport(), driven in-process.
//
// Section 8.5 option (b): `main` now takes an `io` (argv, cwd, out, err, exit)
// and `io.cwd` is the package directory `main` packs AND the root its `tsc`
// lookup resolves under, so a test can redirect either without a real
// process.exit and without touching REPO_ROOT.
//
// No execFileSync seam exists for this gate (see the assignment: its io has
// no exec hook), so `main` shells out to the REAL npm/tsc exactly as
// production does — the fixtures below are real, tiny, offline packages
// pointed at by `io.cwd`, not a faked npm. This is the same shape
// check-consumer.spec.mjs's own "the gate runs" test already accepts.
// =============================================================================

/** A fresh scratch directory this file owns, named for the scenario. */
function fixtureDir(name) {
  const path = join(scratch.path, name);
  mkdirSync(path, { recursive: true });
  return path;
}

/** A directory `npm pack` cannot pack: no package.json at all. */
function packFailFixture() {
  return fixtureDir(`pack-fail-${Math.random().toString(36).slice(2)}`);
}

/** A package whose postinstall script fails, so `npm install` fails. */
function installFailFixture() {
  const dir = fixtureDir(`install-fail-${Math.random().toString(36).slice(2)}`);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@pbpeterson/typed-fetch",
        version: "0.0.0-install-fail",
        main: "index.js",
        scripts: { postinstall: "exit 1" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
  return dir;
}

/**
 * A package that packs and installs but exports nothing at all: no `exports`
 * map, no named exports, no `node_modules/.bin/tsc`. Every runtime probe
 * crashes trying to import a name this package does not have, and the
 * typecheck step never starts because `io.cwd` here has no tsc of its own.
 */
function emptyPackageFixture() {
  const dir = fixtureDir(`empty-pkg-${Math.random().toString(36).slice(2)}`);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@pbpeterson/typed-fetch",
        version: "0.0.0-empty",
        main: "index.js",
        module: "index.mjs",
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
  writeFileSync(join(dir, "index.mjs"), "export default {};\n");
  return dir;
}

/**
 * Like {@link emptyPackageFixture}, but with an `errors/package.json` stub
 * that EXISTS and is not valid JSON. The resolution probe is defensive about
 * every OTHER way its target can be missing — this is the one way it still
 * crashes outright: `JSON.parse` on the stub's content throws outside any
 * try/catch the probe script has.
 */
function brokenStubJsonFixture() {
  const dir = fixtureDir(`broken-stub-${Math.random().toString(36).slice(2)}`);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@pbpeterson/typed-fetch",
        version: "0.0.0-broken-stub",
        main: "index.js",
        module: "index.mjs",
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
  writeFileSync(join(dir, "index.mjs"), "export default {};\n");
  mkdirSync(join(dir, "errors"), { recursive: true });
  writeFileSync(join(dir, "errors", "package.json"), "{ not valid json");
  return dir;
}

/**
 * A package with its OWN `node_modules/.bin/tsc` — a fake one that always
 * fails writing only to stderr, never to stdout. Every real tsc failure this
 * repository ever produces writes its diagnostics to stdout, so nothing else
 * reaches the `err.stdout` empty-string fallback in `typecheckInConsumer`'s
 * catch.
 */
function fakeTscStderrOnlyFixture() {
  const dir = fixtureDir(`fake-tsc-${Math.random().toString(36).slice(2)}`);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@pbpeterson/typed-fetch",
        version: "0.0.0-fake-tsc",
        main: "index.js",
        module: "index.mjs",
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
  writeFileSync(join(dir, "index.mjs"), "export default {};\n");
  const nodeModulesBin = join(dir, "node_modules", ".bin");
  mkdirSync(nodeModulesBin, { recursive: true });
  const tscPath = join(nodeModulesBin, "tsc");
  writeFileSync(tscPath, '#!/bin/sh\necho "tsc crashed" >&2\nexit 1\n');
  chmodSync(tscPath, 0o755);
  return dir;
}

/**
 * A faithful copy of the REAL, currently-built package — `package.json`,
 * `LICENSE`, `README.md`, `dist/`, the `errors/` stub, and a symlink to the
 * real `node_modules` so `tsc` and `@types/node` resolve — with exactly one
 * file removed: the `./errors` subpath's ESM declaration. The runtime files
 * are untouched, so every probe passes for real; only the two typecheck
 * passes that reference `@pbpeterson/typed-fetch/errors` from an ESM
 * `import` fail, which is the fixture section 8.7 asks for: one that BREAKS
 * the gate's one behavior (does every declared entry point still typecheck?).
 */
let brokenSubpathTypesDirCache;
function brokenSubpathTypesFixture() {
  if (brokenSubpathTypesDirCache) return brokenSubpathTypesDirCache;
  const dir = fixtureDir("broken-subpath-types");
  for (const f of ["package.json", "LICENSE", "README.md"]) {
    cpSync(join(REPO_ROOT, f), join(dir, f));
  }
  cpSync(join(REPO_ROOT, "dist"), join(dir, "dist"), { recursive: true });
  cpSync(join(REPO_ROOT, "errors"), join(dir, "errors"), { recursive: true });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  rmSync(join(dir, "dist", "errors", "index.d.mts"), { force: true });
  brokenSubpathTypesDirCache = dir;
  return dir;
}

function consumerIo(overrides = {}) {
  const out = [];
  const err = [];
  let exitCode;
  const io = {
    argv: overrides.argv ?? [],
    cwd: overrides.cwd ?? REPO_ROOT,
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      exitCode = code;
    },
  };
  return { io, out, err, exitCode: () => exitCode };
}

describe("check-consumer main() — driven end to end through io", () => {
  test("a real pack + install + probes + typecheck run reports OK and exits 0", () => {
    const { io, out, err, exitCode } = consumerIo({ cwd: REPO_ROOT });

    checkConsumerMain(io);

    expect(exitCode()).toBe(0);
    expect(out.some((l) => l.includes("✔ check-consumer: OK"))).toBe(true);
    // The one informational note this gate ever emits, printed by the report.
    expect(out.some((l) => l.includes("crossformat:require-instanceof-on-esm-error"))).toBe(true);
    expect(err).toEqual([]);
  }, 60000);

  test("a pack failure exits 1 before any report prints, and cleans its scratch dir", () => {
    const { io, out, err, exitCode } = consumerIo({ cwd: packFailFixture() });

    checkConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("npm pack failed"))).toBe(true);
    expect(out.some((l) => l.includes("Consumer contract report"))).toBe(false);
  }, 30000);

  test("an install failure exits 1 and names the step", () => {
    const { io, err, exitCode } = consumerIo({ cwd: installFailFixture() });

    checkConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("npm install of tarball failed"))).toBe(true);
  }, 30000);

  test("a package with no exports crashes every runtime probe, then tsc-missing exits 1", () => {
    const { io, out, err, exitCode } = consumerIo({ cwd: emptyPackageFixture() });

    checkConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("tsc not found at"))).toBe(true);
    expect(err.some((l) => l.includes(join("node_modules", ".bin", "tsc")))).toBe(true);
    // esm, cjs, subpath, crossformat, and crosscopy each import a name this
    // fixture does not export, and each crashes the probe process. The
    // resolution probe is defensive and does not crash — it reports real
    // (failing) assertions instead, which is a distinct, already-covered path.
    const crashed = out.filter((l) => l.includes("probe crashed")).length;
    expect(crashed).toBe(5);
  }, 30000);

  test("an errors/package.json stub that exists but is not valid JSON crashes the resolution probe too", () => {
    const { io, out, exitCode } = consumerIo({ cwd: brokenStubJsonFixture() });

    checkConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(out.some((l) => l.includes("resolve:probe — resolution probe crashed"))).toBe(true);
  }, 30000);

  test("a tsc that fails writing only to stderr still reports the failure, with no stdout to show", () => {
    const { io, out, exitCode } = consumerIo({ cwd: fakeTscStderrOnlyFixture() });

    checkConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(out.some((l) => l.includes("tsc(bundler) errors:") && l.includes("tsc crashed"))).toBe(
      true,
    );
    expect(out.filter((l) => l.includes("✖ typecheck:")).length).toBe(TYPECHECK_PASSES.length);
  }, 30000);

  test("the same tsc lookup on a Windows platform looks for tsc.cmd instead", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const { io, err, exitCode } = consumerIo({ cwd: emptyPackageFixture() });

      checkConsumerMain(io);

      expect(exitCode()).toBe(1);
      expect(err.some((l) => l.includes("tsc.cmd"))).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }, 30000);

  test("a build missing the ./errors ESM declaration fails only that typecheck, reports it, and exits 1", () => {
    // Section 8.7's fixture-that-breaks-it, for the one behavior this gate
    // exists to guard: does every published entry point still typecheck for
    // a consumer? Everything ELSE about the package is real and correct, so
    // this is the first test in the repository to reach printConsumerReport
    // with a genuine, non-KNOWN_FAILING verdict of false.
    const { io, out, err, exitCode } = consumerIo({ cwd: brokenSubpathTypesFixture() });

    checkConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(err).toEqual([]);
    expect(out.some((l) => l.includes("✖ typecheck:bundler"))).toBe(true);
    expect(out.some((l) => l.includes("Unexpected failures"))).toBe(true);
    expect(out.some((l) => l.includes("✖ check-consumer: FAILED"))).toBe(true);
    expect(out.some((l) => l.includes("check-consumer: OK"))).toBe(false);
  }, 60000);
});

describe("check-consumer main() — printConsumerReport is a separately callable printer", () => {
  test("an empty run with no results or notes still renders a full report and exits 0", () => {
    // Exercises printConsumerReport() directly rather than through main(), and
    // with an empty `notes` array — the one branch a real gate run never takes,
    // because the crossformat probe always emits exactly one note when it runs.
    const { io, out, exitCode } = consumerIo();

    printConsumerReport({ results: [], notes: [], knownFailing: new Set() }, io);

    expect(exitCode()).toBe(0);
    expect(out.some((l) => l.includes("Consumer contract report"))).toBe(true);
    expect(out.some((l) => l.includes("total assertions : 0"))).toBe(true);
    expect(out.some((l) => l.includes("Informational"))).toBe(false);
  });
});

// =============================================================================
// check-deno-consumer.mjs — judgeDenoVersion and main(), driven in-process.
// =============================================================================

describe("check-deno-consumer.mjs — judgeDenoVersion", () => {
  test("accepts Deno 2 and a later major", () => {
    expect(judgeDenoVersion("deno 2.4.1\n")).toEqual({ major: 2 });
    expect(judgeDenoVersion("deno 3.0.0\n")).toEqual({ major: 3 });
  });

  test("rejects Deno 1 with the actionable requirement", () => {
    expect(() => judgeDenoVersion("deno 1.46.3")).toThrow(/requires Deno 2 or later/);
  });

  test("rejects output that does not identify a Deno version at all", () => {
    expect(() => judgeDenoVersion("not deno")).toThrow(/could not read the Deno major version/);
  });
});

function denoIo(overrides = {}) {
  const out = [];
  const err = [];
  let exitCode;
  const io = {
    argv: overrides.argv ?? [],
    cwd: overrides.cwd ?? REPO_ROOT,
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      exitCode = code;
    },
  };
  return { io, out, err, exitCode: () => exitCode };
}

describe.skipIf(!onPosix)("check-deno-consumer main() — driven end to end through io", () => {
  test("a real pack + install + deno check against the real package reports OK", () => {
    const { io, out, exitCode } = denoIo({ cwd: REPO_ROOT });

    checkDenoConsumerMain(io);

    expect(exitCode()).toBeUndefined();
    expect(out.some((l) => l.startsWith("deno consumer: OK with Deno "))).toBe(true);
    expect(out.some((l) => l.includes("@pbpeterson/typed-fetch@"))).toBe(true);
  }, 30000);

  test("a cwd with no package.json fails at the pack step and is reported", () => {
    const { io, err, exitCode } = denoIo({ cwd: packFailFixture() });

    checkDenoConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.startsWith("deno consumer: FAILED — "))).toBe(true);
  }, 30000);

  test("a non-Error thrown while reporting success is still stringified and refused", () => {
    // `error instanceof Error ? error.message : String(error)`, false arm.
    // Reached through a REAL successful pack + install + deno check (cwd is
    // the real repository, exactly like the OK test above) so that `io.out`
    // is the thing that misbehaves, not `gatherDenoConsumerFacts` itself —
    // a thrown Error from there would only exercise the TRUE arm again.
    const { io, err, exitCode } = denoIo({ cwd: REPO_ROOT });
    io.out = () => {
      throw "not an Error instance";
    };

    checkDenoConsumerMain(io);

    expect(exitCode()).toBe(1);
    expect(err).toEqual(["deno consumer: FAILED — not an Error instance"]);
  }, 30000);
});

// =============================================================================
// defaultIo — the real-world sinks, driven directly rather than through main().
//
// Each member is a VALUE, not something main() alone can reach. Every real
// sink is swapped for a spy for the duration of one call, asserted, and
// restored in a `finally` — the same shape F4a used for node-min.mjs's default
// io in scripts/round16-smoke-entry.spec.mjs.
// =============================================================================

describe("check-consumer.mjs — defaultIo, the real-world sinks", () => {
  test("out and err write through console.log/console.error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      checkConsumerDefaultIo.out("round16-defaultio-out");
      checkConsumerDefaultIo.err("round16-defaultio-err");
      expect(logSpy).toHaveBeenCalledWith("round16-defaultio-out");
      expect(errorSpy).toHaveBeenCalledWith("round16-defaultio-err");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("exit calls the real process.exit", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    try {
      checkConsumerDefaultIo.exit(0);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("cwd and argv are the real repository root and the real process.argv", () => {
    expect(checkConsumerDefaultIo.cwd).toBe(REPO_ROOT);
    expect(checkConsumerDefaultIo.argv).toBe(process.argv);
  });
});

describe("check-deno-consumer.mjs — defaultIo, the real-world sinks", () => {
  test("out and err write through console.log/console.error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      checkDenoConsumerDefaultIo.out("round16-defaultio-out");
      checkDenoConsumerDefaultIo.err("round16-defaultio-err");
      expect(logSpy).toHaveBeenCalledWith("round16-defaultio-out");
      expect(errorSpy).toHaveBeenCalledWith("round16-defaultio-err");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("exit sets the real process.exitCode without terminating the worker", () => {
    const previous = process.exitCode;
    try {
      checkDenoConsumerDefaultIo.exit(7);
      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = previous;
    }
  });
});

// =============================================================================
// KNOWN_FAILING — exercised for real, id added and removed around one call.
// =============================================================================

describe("check-consumer.mjs — KNOWN_FAILING, mutated for one call and restored", () => {
  test("an id that IS in KNOWN_FAILING takes the tracked-warning branch in record()", () => {
    expect(KNOWN_FAILING.has("esm:probe")).toBe(false);
    KNOWN_FAILING.add("esm:probe");
    try {
      const { io, out, exitCode } = consumerIo({ cwd: emptyPackageFixture() });

      checkConsumerMain(io);

      expect(exitCode()).toBe(1); // tsc-missing still refuses the run
      expect(
        out.some((l) => l.includes("⚠ esm:probe — FAILED (known, tracked in KNOWN_FAILING)")),
      ).toBe(true);
    } finally {
      KNOWN_FAILING.delete("esm:probe");
    }
    expect(KNOWN_FAILING.has("esm:probe")).toBe(false);
  }, 30000);
});

describe("check-consumer.mjs — printConsumerReport, the KNOWN_FAILING summary sections", () => {
  test("a tracked failure is listed under Known failures, and the OK line names the count", () => {
    const { io, out, exitCode } = consumerIo();

    printConsumerReport(
      {
        results: [{ id: "tracked:one", ok: false, detail: "boom" }],
        notes: [],
        knownFailing: new Set(["tracked:one"]),
      },
      io,
    );

    expect(exitCode()).toBe(0);
    expect(
      out.some((l) => l.includes("Known failures (tracked, will turn green when bugs are fixed)")),
    ).toBe(true);
    expect(out.some((l) => l.includes("⚠ tracked:one"))).toBe(true);
    expect(out.some((l) => l.includes("1 known-failing (tracked)"))).toBe(true);
  });

  test("a PASSING id still listed as known-failing is reported stale and exits 1", () => {
    const { io, out, exitCode } = consumerIo();

    printConsumerReport(
      {
        results: [{ id: "stale:one", ok: true, detail: "" }],
        notes: [],
        knownFailing: new Set(["stale:one"]),
      },
      io,
    );

    expect(exitCode()).toBe(1);
    expect(out.some((l) => l.includes("KNOWN_FAILING is stale"))).toBe(true);
    expect(out.some((l) => l.includes("- stale:one"))).toBe(true);
  });
});

// =============================================================================
// The isMainModule guard's true arm — run as the real entry point, in process.
//
// `isMainModule` compares `process.argv[1]` against the module's own
// `import.meta.url`. Spoofing `argv[1]` to the file's real path and
// re-importing it under a cache-busting query makes a FRESH module instance
// evaluate the guard as true for real, in this process — no subprocess, so it
// counts toward this file's own coverage. Same technique as
// scripts/round16-smoke-entry.spec.mjs's "the guard, run as the real entry
// point" describe.
// =============================================================================

describe("check-consumer.mjs — the guard, run as the real entry point", () => {
  test("isMainModule reports true and the default io runs the real pipeline", async () => {
    // Manual property reassignment, not vi.spyOn: the module below is
    // re-imported under a cache-busting query, and a fresh module instance
    // resolves its OWN reference to console.log/console.error/process.exit
    // at call time — a vi.spyOn mock installed through vitest's spy
    // machinery does not reliably observe a call made from that fresh
    // instance. Reassigning the property directly does, because every
    // module instance still reads the SAME global object.
    const entryPath = fileURLToPath(new URL("./check-consumer.mjs", import.meta.url));
    const previousArgv1 = process.argv[1];
    process.argv[1] = entryPath;
    const realExit = process.exit;
    const realLog = console.log;
    const realError = console.error;
    let exitCode;
    const printed = [];
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`stubbed process.exit(${code})`);
    };
    console.log = (...args) => {
      printed.push(String(args[0]));
    };
    console.error = () => {};
    let caught = null;
    try {
      await import("./check-consumer.mjs?round16-guard-check");
    } catch (error) {
      caught = error;
    } finally {
      process.exit = realExit;
      console.log = realLog;
      console.error = realError;
      process.argv[1] = previousArgv1;
    }

    expect(exitCode).toBe(0);
    expect(String(caught?.message)).toBe("stubbed process.exit(0)");
    expect(printed.some((l) => l.includes("✔ check-consumer: OK"))).toBe(true);
  }, 60000);
});

describe("check-deno-consumer.mjs — the guard, run as the real entry point", () => {
  test("isMainModule reports true and the default io runs the real gate", async () => {
    // Manual property reassignment — see the comment on the check-consumer
    // guard test above for why vi.spyOn cannot be trusted here.
    const entryPath = fileURLToPath(new URL("./check-deno-consumer.mjs", import.meta.url));
    const previousArgv1 = process.argv[1];
    const previousExitCode = process.exitCode;
    process.argv[1] = entryPath;
    const realLog = console.log;
    const realError = console.error;
    const printed = [];
    console.log = (...args) => {
      printed.push(String(args[0]));
    };
    console.error = () => {};
    try {
      await import("./check-deno-consumer.mjs?round16-guard-check");
    } finally {
      console.log = realLog;
      console.error = realError;
      process.argv[1] = previousArgv1;
      process.exitCode = previousExitCode;
    }

    expect(printed.some((l) => l.startsWith("deno consumer: OK with Deno "))).toBe(true);
  }, 30000);
});
