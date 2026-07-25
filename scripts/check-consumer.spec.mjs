import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import {
  cjsAssertions,
  consumerTsconfig,
  crossformatAssertions,
  esmAssertions,
  indent,
  judgeConsumer,
  subpathAssertions,
  typecheckAssertion,
  TYPECHECK_PASSES,
} from "./check-consumer.mjs";

// ---------------------------------------------------------------------------
// Probe fixtures: the exact record shape a GREEN run produces. Copied from a
// real transcript (28 assertions + 1 note), so a mapper that stops matching the
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
  test("covers the five consumer configurations", () => {
    expect(TYPECHECK_PASSES.map((p) => p.id)).toEqual([
      "bundler",
      "nodenext",
      "node-without-dom",
      "node-with-dom",
      "cross-format-cjs-esm",
    ]);
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
          await import(${JSON.stringify(MODULE_URL)});
          console.log(JSON.stringify({
            leaked: readdirSync(tmpdir()).filter((n) => n.startsWith("tf-consumer-")).length - before,
            exit: process.listenerCount("exit"),
            sigint: process.listenerCount("SIGINT"),
            sigterm: process.listenerCount("SIGTERM"),
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
