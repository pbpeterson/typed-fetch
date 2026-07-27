import { spawn } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import {
  cjsAssertions,
  consumerTsconfig,
  crossCopyAssertions,
  crossformatAssertions,
  esmAssertions,
  indent,
  judgeConsumer,
  resolutionAssertions,
  subpathAssertions,
  typecheckAssertion,
  TYPECHECK_PASSES,
} from "./check-consumer.mjs";

// ---------------------------------------------------------------------------
// Probe fixtures: the exact record shape a GREEN run produces. Copied from a
// real transcript (34 assertions + 1 note), so a mapper that stops matching the
// probes it is paired with shows up here.
// ---------------------------------------------------------------------------

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

const GREEN_CJS = {
  responseNull: true,
  isHttpError: true,
  isKnownHttpError: true,
  instanceofNotFound: true,
  status404: true,
  name: "NotFoundError",
};

const GREEN_SUBPATH = {
  name: "NotFoundError",
  instanceofSubpathNotFound: true,
  instanceofSubpathBase: true,
  mainGuardStillTrue: true,
};

const GREEN_CROSSFORMAT = {
  name: "NotFoundError",
  cjsGuardOnEsmError: true,
  cjsKnownGuardOnEsmError: true,
  // Genuinely false in a green run: cross-format instanceof cannot work.
  cjsInstanceofOnEsmError: false,
};

const GREEN_CROSSCOPY = {
  acceptsCorrectBranch: true,
  bothCancelsSettle: true,
  refusesDifferentResponse: true,
  branchReleased: true,
  originalCancelSettles: true,
};

const GREEN_RESOLUTION = {
  pkgJsonResolves: true,
  pkgJsonName: "@pbpeterson/typed-fetch",
  stubExists: true,
  stubFields: ["main", "module", "types"],
  stubTargetsExist: true,
  node10Loads: true,
  node10SameFileAsExports: true,
};

const ids = (verdict) => verdict.results.map((a) => a.id);
const failing = (verdict) => verdict.results.filter((a) => !a.ok).map((a) => a.id);

// ---------------------------------------------------------------------------
// A. Probe mappers — the id roster IS the contract, and so is its order:
//    record() prints as it accumulates, interleaved with the section headers,
//    so a reordered mapper silently changes the gate's stdout.
// ---------------------------------------------------------------------------

describe("esmAssertions", () => {
  test("emits 13 assertions in the printed order", () => {
    expect(ids(esmAssertions(GREEN_ESM))).toEqual([
      "esm:response-null",
      "esm:isHttpError",
      "esm:isKnownHttpError",
      "esm:custom-is-http",
      "esm:custom-is-not-known",
      "esm:instanceof-NotFoundError",
      "esm:status-404",
      "esm:injected-fetch-called",
      "esm:injected-fetch-NotFound",
      "esm:abort-reason-AbortedError",
      "esm:abort-reason-preserved",
      "esm:timeout-TimeoutError",
      "abort:request-first-arg-preaborted",
    ]);
  });

  test("a green probe record passes every assertion and emits no note", () => {
    const verdict = esmAssertions(GREEN_ESM);
    expect(failing(verdict)).toEqual([]);
    expect(verdict.notes).toEqual([]);
  });

  test("one false field fails exactly one assertion", () => {
    const verdict = esmAssertions({ ...GREEN_ESM, timeoutIsTimeout: false });
    expect(failing(verdict)).toEqual(["esm:timeout-TimeoutError"]);
  });

  test("the detail reports the OBSERVED value, not the expectation", () => {
    // A failure that does not say what it saw costs an extra debugging round.
    const verdict = esmAssertions({
      ...GREEN_ESM,
      requestPreAbortIsAborted: false,
      requestPreAbortName: "NetworkError",
    });
    const failed = verdict.results.find((a) => a.id === "abort:request-first-arg-preaborted");
    expect(failed.detail).toContain("surfaced as NetworkError");
    expect(failed.detail).toContain("expected AbortedError");
  });

  test("a TRUNCATED probe record fails all 13 loudly and never throws", () => {
    // A probe that dies mid-write leaves partial JSON. Reading `undefined` off
    // it used to produce a confusing report; it must produce 13 plain failures.
    const verdict = esmAssertions({});
    expect(verdict.results).toHaveLength(13);
    expect(failing(verdict)).toHaveLength(13);
    expect(verdict.results.every((a) => a.ok === false)).toBe(true);
  });
});

describe("cjsAssertions", () => {
  test("emits 5 assertions in the printed order", () => {
    expect(ids(cjsAssertions(GREEN_CJS))).toEqual([
      "cjs:response-null",
      "cjs:isHttpError",
      "cjs:isKnownHttpError",
      "cjs:instanceof-NotFoundError",
      "cjs:status-404",
    ]);
  });

  test("a green probe record passes every assertion", () => {
    expect(failing(cjsAssertions(GREEN_CJS))).toEqual([]);
  });

  test("one false field fails exactly one assertion, quoting the observed name", () => {
    const verdict = cjsAssertions({ ...GREEN_CJS, instanceofNotFound: false, name: "Error" });
    expect(failing(verdict)).toEqual(["cjs:instanceof-NotFoundError"]);
    expect(verdict.results.find((a) => !a.ok).detail).toBe("got name=Error");
  });

  test("a truncated probe record fails all 5 without throwing", () => {
    expect(failing(cjsAssertions({}))).toHaveLength(5);
  });
});

describe("subpathAssertions", () => {
  test("emits 3 assertions in the printed order", () => {
    expect(ids(subpathAssertions(GREEN_SUBPATH))).toEqual([
      "subpath:main-guard-true",
      "subpath:instanceof-across-entries",
      "subpath:instanceof-base-across-entries",
    ]);
  });

  test("a green probe record passes every assertion", () => {
    expect(failing(subpathAssertions(GREEN_SUBPATH))).toEqual([]);
  });

  test("the cross-entry failure explains why it must be true", () => {
    // This is the dual-package hazard the brand fix exists for; the message has
    // to carry that context because the symptom alone looks like a typo.
    const verdict = subpathAssertions({ ...GREEN_SUBPATH, instanceofSubpathNotFound: false });
    expect(failing(verdict)).toEqual(["subpath:instanceof-across-entries"]);
    expect(verdict.results[1].detail).toContain("must share one class identity within a format");
  });

  test("a truncated probe record fails all 3 without throwing", () => {
    expect(failing(subpathAssertions({}))).toHaveLength(3);
  });
});

describe("crossformatAssertions", () => {
  test("emits 2 assertions in the printed order", () => {
    expect(ids(crossformatAssertions(GREEN_CROSSFORMAT))).toEqual([
      "crossformat:require-guard-on-esm-error",
      "crossformat:require-known-guard-on-esm-error",
    ]);
  });

  test("cross-format `instanceof` is a NOTE and never an assertion", () => {
    // The library's whole branding design rests on "cross-format instanceof is
    // impossible, use isHttpError". Promoting this note to an assertion would
    // make the gate permanently red for a documented NON-contract.
    const verdict = crossformatAssertions(GREEN_CROSSFORMAT);
    expect(verdict.notes.map((n) => n.id)).toEqual(["crossformat:require-instanceof-on-esm-error"]);
    expect(ids(verdict)).not.toContain("crossformat:require-instanceof-on-esm-error");
  });

  test("a green run passes both assertions even though the note is false", () => {
    const verdict = crossformatAssertions(GREEN_CROSSFORMAT);
    expect(failing(verdict)).toEqual([]);
    expect(verdict.notes[0].detail).toContain("expected false across formats");
  });

  test("a broken brand fails the guard assertion", () => {
    const verdict = crossformatAssertions({ ...GREEN_CROSSFORMAT, cjsGuardOnEsmError: false });
    expect(failing(verdict)).toEqual(["crossformat:require-guard-on-esm-error"]);
  });

  test("a truncated probe record still yields exactly one note", () => {
    const verdict = crossformatAssertions({});
    expect(failing(verdict)).toHaveLength(2);
    expect(verdict.notes).toHaveLength(1);
  });
});

describe("crossCopyAssertions", () => {
  test("emits 3 assertions in the printed order", () => {
    expect(ids(crossCopyAssertions(GREEN_CROSSCOPY))).toEqual([
      "crosscopy:accepts-correct-branch",
      "crosscopy:refuses-different-response",
      "crosscopy:branch-released",
    ]);
    expect(failing(crossCopyAssertions(GREEN_CROSSCOPY))).toEqual([]);
    expect(crossCopyAssertions(GREEN_CROSSCOPY).notes).toEqual([]);
  });

  test("a truncated probe record fails all 3 without throwing", () => {
    // The probe clones a real teed body, so it can die mid-write in a way the
    // others cannot. Reading `undefined` off the partial JSON must produce three
    // plain failures, never a confusing report and never a throw.
    const verdict = crossCopyAssertions({});
    expect(verdict.results).toHaveLength(3);
    expect(failing(verdict)).toHaveLength(3);
    expect(verdict.results.every((a) => a.ok === false)).toBe(true);
  });
});

describe("resolutionAssertions", () => {
  test("emits 6 assertions in the printed order", () => {
    expect(ids(resolutionAssertions(GREEN_RESOLUTION))).toEqual([
      "resolve:package-json-subpath",
      "resolve:package-json-is-the-manifest",
      "resolve:node10-errors-stub-present",
      "resolve:node10-errors-targets-exist",
      "resolve:node10-errors-loads",
      "resolve:node10-errors-same-file-as-exports",
    ]);
  });

  test("a green probe record passes every assertion and emits no note", () => {
    const verdict = resolutionAssertions(GREEN_RESOLUTION);
    expect(failing(verdict)).toEqual([]);
    expect(verdict.notes).toEqual([]);
  });

  test("a missing ./package.json export names the resolver's own error code", () => {
    // The symptom a consumer reports is the code, so the detail has to carry it.
    const verdict = resolutionAssertions({
      ...GREEN_RESOLUTION,
      pkgJsonResolves: false,
      pkgJsonName: undefined,
      pkgJsonError: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
    expect(failing(verdict)).toEqual([
      "resolve:package-json-subpath",
      "resolve:package-json-is-the-manifest",
    ]);
    expect(verdict.results[0].detail).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
    expect(verdict.results[0].detail).toContain("exports map");
  });

  test("a manifest resolving to some OTHER package fails", () => {
    // A stray hoisted node_modules entry would resolve and look green.
    const verdict = resolutionAssertions({ ...GREEN_RESOLUTION, pkgJsonName: "typed-fetch" });
    expect(failing(verdict)).toEqual(["resolve:package-json-is-the-manifest"]);
  });

  test("a missing stub explains which resolvers break", () => {
    const verdict = resolutionAssertions({
      ...GREEN_RESOLUTION,
      stubExists: false,
      stubFields: undefined,
      stubTargetsExist: undefined,
      node10Loads: undefined,
      node10SameFileAsExports: undefined,
    });
    expect(failing(verdict)).toEqual([
      "resolve:node10-errors-stub-present",
      "resolve:node10-errors-targets-exist",
      "resolve:node10-errors-loads",
      "resolve:node10-errors-same-file-as-exports",
    ]);
    expect(verdict.results[2].detail).toContain("webpack 4");
  });

  test("a stub pointing at a file the tarball does not ship fails", () => {
    const verdict = resolutionAssertions({ ...GREEN_RESOLUTION, stubTargetsExist: false });
    expect(failing(verdict)).toEqual(["resolve:node10-errors-targets-exist"]);
  });

  test("a node10 redirect landing on a DIFFERENT file than exports fails", () => {
    // Two files means two copies of every error class for a node10 consumer,
    // which is the dual-package hazard this package already fought once.
    const verdict = resolutionAssertions({
      ...GREEN_RESOLUTION,
      node10SameFileAsExports: false,
    });
    expect(failing(verdict)).toEqual(["resolve:node10-errors-same-file-as-exports"]);
    expect(verdict.results[5].detail).toContain("second copy");
  });

  test("a truncated probe record fails all 6 without throwing", () => {
    const verdict = resolutionAssertions({});
    expect(verdict.results).toHaveLength(6);
    expect(failing(verdict)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// B. judgeConsumer — the KNOWN_FAILING bookkeeping and the exit rule.
// ---------------------------------------------------------------------------

const pass = (id) => ({ id, ok: true, detail: "" });
const fail = (id, detail = "nope") => ({ id, ok: false, detail });

describe("judgeConsumer", () => {
  test("all green with an empty KNOWN_FAILING is ok", () => {
    const verdict = judgeConsumer({
      results: [pass("a"), pass("b"), pass("c")],
      notes: [],
      knownFailing: new Set(),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.counts).toEqual({
      total: 3,
      passed: 3,
      known: 0,
      informational: 0,
      unexpectedFail: 0,
      unexpectedPass: 0,
    });
  });

  test("a failure that is NOT tracked fails the gate", () => {
    const verdict = judgeConsumer({
      results: [pass("a"), fail("b")],
      notes: [],
      knownFailing: new Set(),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unexpectedFailures.map((r) => r.id)).toEqual(["b"]);
    expect(verdict.knownFailures).toEqual([]);
  });

  test("a failure that IS tracked does not fail the gate", () => {
    const verdict = judgeConsumer({
      results: [pass("a"), fail("b")],
      notes: [],
      knownFailing: new Set(["b"]),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.knownFailures.map((r) => r.id)).toEqual(["b"]);
    expect(verdict.unexpectedFailures).toEqual([]);
    expect(verdict.counts.known).toBe(1);
  });

  test("a PASSING id still listed in KNOWN_FAILING fails the gate", () => {
    // The branch that has not executed since KNOWN_FAILING was emptied, and the
    // only one that ever runs during a future incident. A stale list is how a
    // fixed bug quietly stops being asserted.
    const verdict = judgeConsumer({
      results: [pass("a"), pass("b")],
      notes: [],
      knownFailing: new Set(["b"]),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unexpectedPasses.map((r) => r.id)).toEqual(["b"]);
    expect(verdict.counts.unexpectedPass).toBe(1);
  });

  test("an unexpected failure and a stale pass are reported together", () => {
    const verdict = judgeConsumer({
      results: [pass("stale"), fail("broken")],
      notes: [],
      knownFailing: new Set(["stale"]),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unexpectedFailures.map((r) => r.id)).toEqual(["broken"]);
    expect(verdict.unexpectedPasses.map((r) => r.id)).toEqual(["stale"]);
  });

  test("notes are counted as informational and never affect the verdict", () => {
    const verdict = judgeConsumer({
      results: [pass("a")],
      notes: [{ id: "n", detail: "a documented limitation" }],
      knownFailing: new Set(),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.counts.informational).toBe(1);
  });

  test("passed + known + unexpectedFail accounts for every assertion", () => {
    const verdict = judgeConsumer({
      results: [pass("a"), pass("b"), fail("tracked"), fail("broken")],
      notes: [],
      knownFailing: new Set(["tracked"]),
    });
    const { passed, known, unexpectedFail, total } = verdict.counts;
    expect(passed + known + unexpectedFail).toBe(total);
  });

  test("a duplicated id is counted twice", () => {
    // Pins current behaviour: nothing de-duplicates, so a probe emitted twice
    // would inflate the totals rather than being silently merged.
    const verdict = judgeConsumer({
      results: [pass("a"), pass("a")],
      notes: [],
      knownFailing: new Set(),
    });
    expect(verdict.counts.total).toBe(2);
    expect(verdict.counts.passed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C. consumerTsconfig — the typecheck policy.
// ---------------------------------------------------------------------------

const TYPE_ROOTS = ["/repo/node_modules/@types"];
const basePass = {
  moduleResolution: "bundler",
  lib: ["ES2022", "DOM"],
  types: [],
  files: ["consumer.api.ts"],
};

describe("consumerTsconfig", () => {
  test("nodenext resolution implies nodenext module", () => {
    const cfg = consumerTsconfig({ ...basePass, moduleResolution: "nodenext" }, TYPE_ROOTS);
    expect(cfg.compilerOptions.module).toBe("nodenext");
    expect(cfg.compilerOptions.moduleResolution).toBe("nodenext");
  });

  test("any other resolution implies esnext module", () => {
    expect(consumerTsconfig(basePass, TYPE_ROOTS).compilerOptions.module).toBe("esnext");
  });

  test("skipLibCheck is ALWAYS false", () => {
    // Turning it on would let a broken .d.ts inside the package through, which
    // is the single thing this pass exists to catch.
    for (const moduleResolution of ["bundler", "nodenext"]) {
      const cfg = consumerTsconfig({ ...basePass, moduleResolution }, TYPE_ROOTS);
      expect(cfg.compilerOptions.skipLibCheck).toBe(false);
    }
  });

  test("exactOptionalPropertyTypes appears only when the pass asks for it", () => {
    expect(consumerTsconfig(basePass, TYPE_ROOTS).compilerOptions).not.toHaveProperty(
      "exactOptionalPropertyTypes",
    );
    const eopt = consumerTsconfig({ ...basePass, exactOptionalPropertyTypes: true }, TYPE_ROOTS);
    expect(eopt.compilerOptions.exactOptionalPropertyTypes).toBe(true);
  });

  test("typeRoots appear only when types are requested", () => {
    expect(consumerTsconfig(basePass, TYPE_ROOTS).compilerOptions).not.toHaveProperty("typeRoots");
    const withTypes = consumerTsconfig({ ...basePass, types: ["node"] }, TYPE_ROOTS);
    expect(withTypes.compilerOptions.typeRoots).toEqual(TYPE_ROOTS);
  });

  test("strict is on and lib/files/types are passed straight through", () => {
    const cfg = consumerTsconfig(
      { ...basePass, lib: ["ES2023"], types: ["node"], files: ["a.ts", "b.ts"] },
      TYPE_ROOTS,
    );
    expect(cfg.compilerOptions.strict).toBe(true);
    expect(cfg.compilerOptions.noEmit).toBe(true);
    expect(cfg.compilerOptions.lib).toEqual(["ES2023"]);
    expect(cfg.compilerOptions.types).toEqual(["node"]);
    expect(cfg.files).toEqual(["a.ts", "b.ts"]);
  });
});

// ---------------------------------------------------------------------------
// D. TYPECHECK_PASSES + typecheckAssertion.
// ---------------------------------------------------------------------------

describe("TYPECHECK_PASSES", () => {
  test("covers the six consumer configurations", () => {
    expect(TYPECHECK_PASSES.map((p) => p.id)).toEqual([
      "bundler",
      "nodenext",
      "node-without-dom",
      "node-with-dom",
      "node-eopt",
      "cross-format-cjs-esm",
    ]);
  });

  test("the node-eopt pass really turns exactOptionalPropertyTypes on", () => {
    // That pass exists because an optional property that does not NAME
    // `undefined` rejects one under EOPT. With the flag off it compiles either
    // way and the pass proves nothing.
    const eopt = TYPECHECK_PASSES.find((p) => p.id === "node-eopt");
    expect(eopt.exactOptionalPropertyTypes).toBe(true);
  });

  test("the node-without-dom pass really has no DOM lib", () => {
    // That pass exists because HeadersInit lives only in lib.dom.d.ts. If DOM
    // crept into its lib list the pass would still be green and would prove
    // nothing at all.
    const noDom = TYPECHECK_PASSES.find((p) => p.id === "node-without-dom");
    expect(noDom.lib).not.toContain("DOM");
    expect(noDom.types).toEqual(["node"]);
  });
});

describe("typecheckAssertion", () => {
  test("a passing tsc run carries an empty detail", () => {
    expect(typecheckAssertion({ id: "bundler" }, { ok: true, output: "" })).toEqual({
      id: "typecheck:bundler",
      ok: true,
      detail: "",
    });
  });

  test("a failing run names the pass and indents the compiler output", () => {
    const assertion = typecheckAssertion(
      { id: "nodenext" },
      { ok: false, output: "consumer.api.ts(3,1): error TS2307: Cannot find module." },
    );
    expect(assertion.id).toBe("typecheck:nodenext");
    expect(assertion.ok).toBe(false);
    expect(assertion.detail).toContain("tsc(nodenext) errors:");
    expect(assertion.detail).toContain("      consumer.api.ts(3,1): error TS2307");
  });
});

describe("indent", () => {
  test("indents every line, including blank ones, by six spaces", () => {
    expect(indent("a\n\nb")).toBe("      a\n      \n      b");
  });
});

// ---------------------------------------------------------------------------
// E. Import hygiene. Only observable in a fresh process: by the time a test
//    runs, this file has already imported the module.
// ---------------------------------------------------------------------------

const MODULE_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "check-consumer.mjs"),
).href;

describe("import hygiene", () => {
  test("importing the gate creates no temp dir, installs no handlers, spawns no npm", async () => {
    // Before the refactor, WORK = mkdtempSync and three process.on calls ran at
    // module scope, so every vitest worker that touched this file made a temp
    // directory and started intercepting Ctrl-C.
    const report = await new Promise((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
          import { readdirSync } from "node:fs";
          import { tmpdir } from "node:os";
          const before = readdirSync(tmpdir()).filter((n) => n.startsWith("tf-consumer-")).length;
          // Deltas, not absolute counts: Node registers an \`exit\` listener of
          // its own on some versions, so an absolute 0 asserts something about
          // the runtime rather than about this module.
          const beforeExit = process.listenerCount("exit");
          const beforeSigint = process.listenerCount("SIGINT");
          const beforeSigterm = process.listenerCount("SIGTERM");
          await import(${JSON.stringify(MODULE_URL)});
          console.log(JSON.stringify({
            leaked: readdirSync(tmpdir()).filter((n) => n.startsWith("tf-consumer-")).length - before,
            exit: process.listenerCount("exit") - beforeExit,
            sigint: process.listenerCount("SIGINT") - beforeSigint,
            sigterm: process.listenerCount("SIGTERM") - beforeSigterm,
          }));
          `,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => (stdout += c));
      child.on("error", reject);
      child.on("close", () => resolvePromise(stdout.trim()));
    });
    expect(JSON.parse(report)).toEqual({ leaked: 0, exit: 0, sigint: 0, sigterm: 0 });
  }, 30000);
});

// ---------------------------------------------------------------------------
// The gate must RUN. Everything above is pure: it feeds recorded probe records
// to the mappers and judges. None of it proves that
// `node scripts/check-consumer.mjs` still reaches main().
//
// That distinction is not hypothetical here. A lexical isMain guard once made
// every gate in this repository print nothing and exit 0 through a symlink, and
// CI reads that as a pass (CHANGELOG.md:286-296). The fix added a shared helper
// AND a "the gate runs" test — but only to four of the six gates. This one and
// `check-deno-consumer` were left with the negative half only ("importing the
// gate does nothing"), which a guard that never fires also satisfies.
//
// check-consumer is the gate that packs the tarball, installs it, and exercises
// the exports map across formats. `ci.yml` and `release.yml` both invoke it, so
// a regression here publishes with packaging unverified.
// ---------------------------------------------------------------------------
const gateScriptDir = dirname(fileURLToPath(import.meta.url));
const gateRepoRoot = resolve(gateScriptDir, "..");
const CHECK_CONSUMER = join(gateScriptDir, "check-consumer.mjs");

const gateLinks = createScratchDir("tf-check-consumer-link-");
afterAll(() => gateLinks.dispose());

/** main()'s first act, printed before it packs anything. */
const REACHED_MAIN = /▸ Packing /;

/**
 * Start the gate and resolve as soon as it has PROVED it reached main(), then
 * kill it.
 *
 * A full run packs a tarball and npm-installs it. This test is about the entry
 * guard, not the probes, so it must not pay for them — and the marker it waits
 * for is printed before the first expensive call.
 *
 * @param {string} entry
 * @returns {Promise<boolean>}
 */
function reachesMain(entry) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: gateRepoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolvePromise(value);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (REACHED_MAIN.test(stdout)) settle(true);
    });
    child.on("error", reject);
    // A guard that never fires exits 0 having printed nothing at all.
    child.on("close", () => settle(REACHED_MAIN.test(stdout)));
  });
}

describe.skipIf(process.platform === "win32")("check-consumer — the gate runs", () => {
  test.each([
    ["its real path", () => CHECK_CONSUMER],
    [
      "a symlinked checkout directory",
      () => {
        const linked = join(gateLinks.path, "checkout");
        if (!existsSync(linked)) symlinkSync(gateRepoRoot, linked);
        return join(linked, "scripts", "check-consumer.mjs");
      },
    ],
    [
      "a symlinked script file",
      () => {
        const linked = join(gateLinks.path, "check-consumer.mjs");
        if (!existsSync(linked)) symlinkSync(CHECK_CONSUMER, linked);
        return linked;
      },
    ],
  ])(
    "reaches main() when started through %s",
    async (_name, entry) => {
      expect(await reachesMain(entry())).toBe(true);
    },
    30000,
  );
});
