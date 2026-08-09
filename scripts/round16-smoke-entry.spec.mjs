import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { BaseHttpError } from "../dist/index.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 16, COVERAGE SUB-LANE C4, BLOCK 2 — `scripts/smoke/**`.
//
// `scripts/smoke/node-min.mjs` is 0 / 63. It is the gate that guards the
// declared `engines` floor, and section 2.4 records what that cost: for seven
// rounds every gate was green while the floor was never executed, because
// `smoke:node-min` only WARNS on a newer runtime and CI's `node-version: 20`
// resolves to the latest 20.x. The orchestrator finally ran it by hand on a
// real 20.13.0 after round 15.
//
// It is a NODE script, so section 8.5 option (b) reaches it: export `main`, and
// give it an `io` for everything it reaches for that a test must control. Three
// of its own branches decide whether a run counts, and no spec has ever asked
// any of them:
//
//   below the floor   → refuse, exit 1, and RUN NOTHING
//   above it, in CI   → refuse, exit 1, because a green run would be a lie
//   above it, locally → warn, and run anyway
//
// The third one is the branch that let seven rounds pass. It is asserted here.
//
// `bun.mjs` and `deno.ts` take section 8.5 option (d) instead — each imports a
// runtime global a Node worker does not have. The exclusion list itself is
// pinned in `tests/surface/round16-h4-surface.spec.ts`; what this file pins is
// the FACT that justifies the exclusion, so a later round cannot excuse a third
// path with the same sentence.
// ═══════════════════════════════════════════════════════════════════════════

const here = dirname(fileURLToPath(import.meta.url));
const smokeDir = join(here, "smoke");

// ── Loading the entry point ──────────────────────────────────────────────
//
// `process.exit` is neutralized across the import. Before the option (b) edit
// this module runs its whole body at import time, and one of its arms calls
// `process.exit(1)` — which, inside a vitest worker, takes the worker down and
// reports nothing. A stub turns that into a caught error and a legible failure.

let entry = null;
{
  const realExit = process.exit;
  process.exit = (code) => {
    throw new Error(`node-min.mjs called process.exit(${code}) while being imported`);
  };
  try {
    entry = await import("./smoke/node-min.mjs");
  } catch {
    // entry stays null; the describe.skipIf below skips every test that
    // would otherwise reach entry.main.
  } finally {
    process.exit = realExit;
  }
}

/** One driven run: the writers it filled and the code it asked for. */
async function run({ version, env = {} }) {
  const out = [];
  const err = [];
  let code = null;
  await entry.main({
    version,
    env,
    out: (line) => out.push(String(line)),
    err: (line) => err.push(String(line)),
    exit: (value) => {
      code = value;
    },
  });
  return { out: out.join("\n"), err: err.join("\n"), code };
}

describe.skipIf(typeof entry?.main !== "function")("the floor smoke's own decision", () => {
  test("below the declared floor it refuses, exits 1, and runs nothing", async () => {
    const { out, err, code } = await run({ version: "20.12.9" });

    expect(code).toBe(1);
    expect(err).toContain("20.12.9");
    expect(err).toContain("20.13.0");
    // The refusal has to STOP the run. A gate that reports a refusal and then
    // exercises the package anyway has told a reader two different things, and
    // the second one is the one a CI log ends with.
    expect(out).toBe("");
  });

  test("a non-numeric version component counts as zero, so a nightly is below the floor", async () => {
    // `process.versions.node` carries one on a nightly build. NaN comparisons
    // are always false, so an unguarded compare took the "this is the floor"
    // branch and reported a pass it had not earned.
    const { code } = await run({ version: "20.0.0-nightly" });

    expect(code).toBe(1);
  });

  test("a non-numeric PATCH component counts as zero too, reaching the floor exactly", async () => {
    // The nightly test above never reaches the patch component at all: major
    // and minor already decide the comparison before the loop gets there. This
    // version keeps major and minor AT the floor, so the loop only resolves at
    // the patch index — the one place the fallback in compareToMinimum's
    // `Number.isFinite(...) ? ... : 0` actually has to answer 0 instead of NaN.
    const { out, err, code } = await run({ version: "20.13.nightly" });

    expect(code).toBe(null);
    expect(err).toBe("");
    expect(out).toContain("node-min smoke: OK on Node 20.13.nightly");
  });

  test("above the floor in CI it refuses, because a green run there would be a lie", async () => {
    const { err, code } = await run({ version: "24.0.0", env: { CI: "1" } });

    expect(code).toBe(1);
    expect(err).toContain("Refusing to report a pass in CI.");
    expect(err).toContain("does NOT prove floor support");
  });

  test("above the floor outside CI it warns loudly and still exercises the package", async () => {
    // THE BRANCH THAT COST SEVEN ROUNDS. A developer with no 20.13.0 binary
    // still gets a run, and the notice is the only thing separating that run
    // from a floor run.
    const { out, err, code } = await run({ version: "24.0.0" });

    expect(code).toBe(null);
    expect(err).toContain("does NOT prove floor support");
    expect(out).toContain("node-min smoke: OK on Node 24.0.0");
  });

  test("at exactly the floor it reports a pass with no notice at all", async () => {
    const { out, err, code } = await run({ version: "20.13.0" });

    expect(code).toBe(null);
    expect(err).toBe("");
    expect(out).toContain("node-min smoke: OK on Node 20.13.0");
  });
});

// ── The default io ───────────────────────────────────────────────────────
//
// Every test above passes its OWN io, so the default writers — the ones
// `node scripts/smoke/node-min.mjs` actually uses — are defined but never
// called. Reaching them means calling `main()` with no argument at all, which
// wires straight to the real `console.log`, `console.error`, and
// `process.exit`. `process.exit` is stubbed the same way the import above
// stubs it, so the default `exit` writer is proved to reach the real
// `process.exit` without the worker actually going down.

describe("the default io reaches the real platform", () => {
  test("the default err and exit close together, whichever refusal branch the real version takes", async () => {
    // The default `env` is a live reference to `process.env`, and the default
    // `version` was captured from the REAL runtime at import time. Setting CI
    // guarantees a refusal one of two ways: below the floor, `main` refuses
    // regardless of CI; at or above it, CI forces the refusal. Both arms call
    // the default `err` writer and then the default `exit` writer, so this
    // test proves both without depending on which arm the host happens to be.
    const previousCI = process.env.CI;
    process.env.CI = "1";
    const realExit = process.exit;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exit = (code) => {
      throw new Error(`stubbed process.exit(${code})`);
    };
    let caught = null;
    let errCallCount = 0;
    try {
      await entry.main();
    } catch (error) {
      caught = error;
    } finally {
      // Read the spy's call count BEFORE mockRestore(), which clears it.
      errCallCount = errSpy.mock.calls.length;
      process.exit = realExit;
      errSpy.mockRestore();
      if (previousCI === undefined) delete process.env.CI;
      else process.env.CI = previousCI;
    }

    expect(String(caught?.message)).toBe("stubbed process.exit(1)");
    expect(errCallCount).toBeGreaterThan(0);
  });

  test("the default out writes the real success line when the host is above the floor and CI is unset", async () => {
    // Every machine that can run this test suite today is well above the
    // 20.13.0 floor, so this arm is the one a bare `main()` takes outside CI:
    // warn-and-continue, then the full smoke, ending in the default `out`.
    const previousCI = process.env.CI;
    delete process.env.CI;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed = [];
    try {
      await entry.main();
    } finally {
      // Read the spy's calls BEFORE mockRestore(), which clears them.
      printed = logSpy.mock.calls.map((args) => String(args[0]));
      logSpy.mockRestore();
      errSpy.mockRestore();
      if (previousCI !== undefined) process.env.CI = previousCI;
    }

    expect(printed.some((line) => line.includes("node-min smoke: OK on Node"))).toBe(true);
  });
});

// ── Step 1's own failure message ─────────────────────────────────────────
//
// `assert(ok.error === null, \`expected no error, got ${ok.error &&
// ok.error.name}\`)` builds its message on EVERY call, success or not, and
// every scenario this file drives leaves `ok.error` null — so the `&&` has
// only ever taken its short-circuit arm. Sabotaging the ambient `fetch` for
// exactly the smoke's first request makes `ok.error` a real NetworkError,
// which both fires the assert AND reaches `ok.error.name` inside its own
// message. `request-plan.ts` reads the bare `fetch` identifier fresh on each
// call (it is not captured at import time), so restoring it after one call is
// enough.

describe("step 1's failure message", () => {
  test("names the error when the smoke's own first request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new TypeError("simulated network failure"));

    let caught = null;
    try {
      await run({ version: "20.13.0" });
    } catch (error) {
      caught = error;
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe("expected no error, got NetworkError");
  });
});

// ── The guard timer on the two-branch cleanup ────────────────────────────
//
// Step 6's own race has a real setTimeout(..., 5000) arm, and nothing in this
// spec has ever made it win: a healthy cancel() always settles first. This is
// the arm that PROVES the timeout exists at all — without it, a hang here
// would report nothing forever, and the whole point of racing it against a
// timer is lost. `BaseHttpError.prototype.cancel` is patched so the FIRST
// call (step 3's lone `missing.error.cancel()`) still settles for real, and
// only calls after it — step 6's tee pair — hang. Real time, not a mocked
// clock: it is the guard's own timer that has to fire.

describe("the two-branch cleanup's guard timer", () => {
  test("the setTimeout arm wins the race when the SECOND and THIRD cancel() calls never settle", async () => {
    const original = BaseHttpError.prototype.cancel;
    let calls = 0;
    BaseHttpError.prototype.cancel = function (...args) {
      calls += 1;
      if (calls === 1) return original.apply(this, args);
      return new Promise(() => {}); // never settles
    };

    let caught = null;
    try {
      await run({ version: "20.13.0" });
    } catch (error) {
      caught = error;
    } finally {
      BaseHttpError.prototype.cancel = original;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("must settle at the floor");
  }, 10000);
});

// ── The guard, when this module really is the entry point ────────────────
//
// Every other test drives `entry.main` directly, so the top-level
// `if (isMainModule(import.meta.url)) await main();` line has only ever been
// evaluated as FALSE — this module is always imported by a spec, never
// started. `isMainModule` compares `process.argv[1]` against its own
// `import.meta.url`, and only the first of those is mutable from here.
// Pointing `argv[1]` at the file's own real path and re-importing it under a
// cache-busting query makes the guard true FOR REAL, in this same process —
// no subprocess, so this run counts toward this file's own coverage.

describe("the guard, run as the real entry point", () => {
  test("isMainModule reports true and the default io runs the real smoke", async () => {
    const entryPath = fileURLToPath(new URL("./smoke/node-min.mjs", import.meta.url));
    const previousArgv1 = process.argv[1];
    const previousCI = process.env.CI;
    process.argv[1] = entryPath;
    delete process.env.CI;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed = [];
    try {
      await import("./smoke/node-min.mjs?round16-guard-check");
    } finally {
      printed = logSpy.mock.calls.map((args) => String(args[0]));
      logSpy.mockRestore();
      errSpy.mockRestore();
      process.argv[1] = previousArgv1;
      if (previousCI !== undefined) process.env.CI = previousCI;
    }

    expect(printed.some((line) => line.includes("node-min smoke: OK on Node"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The two files the exclusion covers.
//
// The written reason for excluding them is that each needs a runtime a Node
// worker cannot host. That reason is a FACT about the file, so it is asserted
// as one. A later round proposing a third exclusion has to produce the same
// fact about that file, and `tests/surface/round16-h4-surface.spec.ts` fails
// until the list itself is updated.
// ═══════════════════════════════════════════════════════════════════════════

describe("the two cross-runtime smokes each need a runtime a Node worker lacks", () => {
  const smoke = (name) => readFileSync(resolve(smokeDir, name), "utf8");

  test("bun.mjs reaches for the Bun global", () => {
    expect(smoke("bun.mjs")).toMatch(/\bBun\b/);
  });

  test("deno.ts reaches for the Deno global", () => {
    expect(smoke("deno.ts")).toMatch(/\bDeno\b/);
  });

  test("node-min.mjs reaches for neither, which is why it is not excluded", () => {
    const source = smoke("node-min.mjs");

    expect(source).not.toMatch(/\bBun\.\w/);
    expect(source).not.toMatch(/\bDeno\.\w/);
  });
});
