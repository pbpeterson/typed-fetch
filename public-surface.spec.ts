import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, test, expect } from "vitest";
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isKnownHttpError,
  isAbortError,
  isTimeoutError,
} from "./src/index";
import { httpErrors } from "./src/errors/helpers";
import {
  AbortedError,
  BaseHttpError,
  InternalServerError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";

function responseWithStatus(status: number): Response {
  return new Response(null, { status });
}

/**
 * Race a promise against a timer, so a stranded teed branch FAILS the suite
 * instead of hanging it: a bare `await error.cancel()` on an orphaned branch
 * waits for vitest's global timeout and reports nothing about why.
 *
 * The budget is generous on purpose, and it costs nothing where it matters.
 * Every caller asserts `"settled"`, so the timer is a fallback and the assertion
 * still fails in milliseconds on a real regression: a stranded branch never
 * settles at all, so no budget rescues it. A tight budget only adds a way for a
 * genuinely-settling `cancel()` to lose the race on a starved CI runner and
 * report a defect that is not there.
 */
async function settlesWithin(promise: Promise<unknown>, ms = 500): Promise<string> {
  return Promise.race([
    promise.then(() => "settled"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

// P3-03: freeze the public API surface. This machinery owns TWO axes of
// "the public surface changed", each with its own snapshot pair:
//
//   Axis A — the VALUE surface (the block just below): the set of runtime
//   named exports, read via `Object.keys(await import("dist/index.mjs"))`.
//   Object.keys() sees only bindings that exist at runtime.
//
//   Axis B — the TYPE surface (the block after that): the set of type-only
//   exports, read via the TypeScript compiler API against the built
//   `.d.mts`. Type-only exports (`export type { … }`, re-exported interfaces
//   and type aliases) NEVER exist at runtime, so `Object.keys()` is
//   STRUCTURALLY BLIND to them — deleting `export type { HttpMethods }` from
//   the barrel left all runtime tests, check-consumer, check-docs and
//   verify-pack green. Axis B closes that hole.
//
// Both snapshot the exact set of names from the BUILT package so an accidental
// addition/removal is a red test (and a reviewable snapshot diff), not a
// silent minor/major. To change the surface on purpose, update the code and
// re-run with `-u` (see CONTRIBUTING.md → "Updating the public-surface
// snapshots").
//
// A separate roster → barrel invariant in the value-surface suite derives the
// dedicated class names/statuses from `httpErrors` and requires both built
// entry points to expose exactly that roster. Snapshots alone cannot catch a
// future class registered internally but accidentally omitted from a barrel,
// because the unchanged export list would still match the old snapshot.
//
// dist/-ordering: this reads from `dist/`, which only exists after
// `pnpm build`. `dist/` is gitignored, so on a fresh local checkout it is
// absent until you build. In CI it is present: .github/workflows/ci.yml runs
// `pnpm build` BEFORE `pnpm test` in the same job, so these suites run for
// real there. The two cases are therefore handled differently below: locally,
// a missing dist/ skips gracefully (with an explicit console message, so it's
// visible rather than silently vanishing); in CI, a missing dist/ is a hard
// error, because it would mean the workflow lost the `build`-before-`test`
// ordering and the surface would silently stop being checked. Present dist/
// runs for real everywhere — e.g. the documented verification flow
// `pnpm build && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.
const distExists = existsSync(new URL("./dist/index.mjs", import.meta.url));

if (!distExists) {
  if (process.env.CI) {
    throw new Error(
      "[api-surface] dist/ not found in CI — .github/workflows/ci.yml must run " +
        "`pnpm build` before `pnpm test` so the dist-gated suites run for real.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "\n[api-surface] dist/ not found — skipping the public API surface snapshot tests. " +
      "Run `pnpm build` first (e.g. `pnpm build && pnpm test`) to exercise them.\n",
  );
}

// The specifier is built at runtime so `tsc` does not try to resolve dist/,
// which does not exist until `pnpm build` has run.
const importDist = (path: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ new URL(path, import.meta.url).href);

describe.skipIf(!distExists)("public API surface is frozen", () => {
  test("main entry named exports", async () => {
    const mod = await importDist("./dist/index.mjs");
    // Object.keys() returns a fresh array each call, so sorting it in place
    // (oxlint's unicorn/no-array-sort warning, not an error) is harmless.
    expect(Object.keys(mod).toSorted()).toMatchSnapshot();
  });

  test("./errors subpath named exports", async () => {
    const mod = await importDist("./dist/errors/index.mjs");
    // Same as above: sorting the fresh Object.keys() array in place is fine.
    expect(Object.keys(mod).toSorted()).toMatchSnapshot();
  });

  test.each([
    ["main entry", "./dist/index.mjs"],
    ["./errors subpath", "./dist/errors/index.mjs"],
  ])("%s exports every dedicated class in the internal roster", async (_entry, path) => {
    const mod = await importDist(path);

    for (const ErrorClass of httpErrors) {
      expect(Object.hasOwn(mod, ErrorClass.name)).toBe(true);
      const exported = mod[ErrorClass.name] as { readonly status?: unknown };
      expect(exported.status).toBe(ErrorClass.status);
    }
  });

  // `toJSON` is a public METHOD. Both snapshots above see only NAMES, so
  // nothing else in this file notices it failing to reach the built package.
  test.each([
    ["main entry", "./dist/index.mjs"],
    ["./errors subpath", "./dist/errors/index.mjs"],
  ])("%s ships toJSON on the built error classes", async (_entry, path) => {
    const mod = (await importDist(path)) as unknown as {
      NotFoundError: typeof NotFoundError;
      NetworkError: typeof NetworkError;
    };

    expect(JSON.parse(JSON.stringify(new mod.NotFoundError(responseWithStatus(404))))).toEqual({
      name: "NotFoundError",
      message: "HTTP 404",
      status: 404,
      statusText: "Not Found",
      url: "",
      headers: [],
    });
    expect(JSON.parse(JSON.stringify(new mod.NetworkError("boom")))).toEqual({
      name: "NetworkError",
      message: "boom",
      url: "",
    });
  });
});

// Axis B — freeze the TYPE-ONLY surface (see the header comment above for why
// the value snapshot cannot). `Object.keys()` of the runtime module is blind
// to `export type { … }` and re-exported interfaces/type aliases, so this
// block reads the shipped `.d.mts` with the TypeScript compiler API — the
// honest tool. `getExportsOfModule` returns EVERY exported symbol; we keep the
// ones that carry a type meaning but NO value meaning (following aliases to
// their target), i.e. the names that ship purely as types. That set is
// snapshotted per entry point, so:
//   • removing a type export (e.g. `HttpMethods`)     → snapshot diff → RED
//   • adding an unreviewed type export                 → snapshot diff → RED
//   • re-adding a deliberately-cut type (TypedHeaders) → snapshot diff → RED
// It runs against `dist/*.d.mts` (the artifact that ships), never `src/` —
// this whole class of bug came from a guard that read `src/` instead of dist/.
function typeOnlyExportsOf(dtsRelPath: string): string[] {
  const abs = fileURLToPath(new URL(dtsRelPath, import.meta.url));
  const program = ts.createProgram([abs], {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(abs);
  if (!source) throw new Error(`could not load ${abs} into the TS program`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`no module symbol for ${abs}`);

  const F = ts.SymbolFlags;
  const TYPE_MEANING = F.Type | F.Interface | F.TypeAlias | F.Class | F.Enum;

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((sym) => {
      // Follow re-export aliases to the symbol they actually point at, so a
      // barrel `export type { ClientErrors } from "./helpers"` is classified
      // by the target's meaning, not the alias's.
      const flags = sym.flags & F.Alias ? checker.getAliasedSymbol(sym).flags : sym.flags;
      const hasValue = (flags & F.Value) !== 0;
      const hasType = (flags & TYPE_MEANING) !== 0;
      // A CLASS carries both a value and a type meaning; it ships as a runtime
      // binding and is already frozen by the value snapshot. Keep only names
      // with a type meaning and NO value meaning — the ones invisible at
      // runtime and therefore only guardable here.
      return hasType && !hasValue ? sym.getName() : null;
    })
    .filter((name): name is string => name !== null)
    .toSorted();
}

describe.skipIf(!distExists)("public TYPE surface is frozen", () => {
  test("main entry type-only exports", () => {
    expect(typeOnlyExportsOf("./dist/index.d.mts")).toMatchSnapshot();
  });

  test("./errors subpath type-only exports", () => {
    expect(typeOnlyExportsOf("./dist/errors/index.d.mts")).toMatchSnapshot();
  });
});

// ── Cross-copy / cross-format guards against the BUILT artifacts ─────
//
// The whole reason branding exists: exercise the guards against errors created
// by a DIFFERENT copy of the classes than the one that owns the guard. The
// src/ tests in guards.spec.ts cannot catch a regression to `instanceof`
// because every import there resolves to the same module object. These tests
// import the two ESM entry points (`.` and `./errors`) and the two CJS entry
// points via createRequire, then cross the wires. On a clean checkout dist/ is
// absent and this block skips (see distExists rationale above).
describe.skipIf(!distExists)("guards work across module copies (dist)", () => {
  const require = createRequire(import.meta.url);

  test("axis 1 — ESM cross-entry: typedFetch from `.`, NotFoundError from `./errors`", async () => {
    const main = (await importDist("./dist/index.mjs")) as {
      typedFetch: typeof typedFetch;
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const errors = (await importDist("./dist/errors/index.mjs")) as {
      NotFoundError: typeof NotFoundError;
    };
    const { error } = await main.typedFetch("http://x/y", {
      fetch: async () => responseWithStatus(404),
    });
    expect(main.isHttpError(error)).toBe(true);
    expect(main.isKnownHttpError(error)).toBe(true);
    // With code-splitting the two entries share a chunk, so raw instanceof
    // holds too within a single ESM graph.
    expect(error instanceof errors.NotFoundError).toBe(true);
  });

  test("axis 2 — CJS cross-entry: typedFetch and NotFoundError via require()", async () => {
    const main = require("./dist/index.js") as {
      typedFetch: typeof typedFetch;
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const errors = require("./dist/errors/index.js") as {
      NotFoundError: typeof NotFoundError;
    };
    const { error } = await main.typedFetch("http://x/y", {
      fetch: async () => responseWithStatus(404),
    });
    expect(main.isHttpError(error)).toBe(true);
    expect(main.isKnownHttpError(error)).toBe(true);
    expect(error instanceof errors.NotFoundError).toBe(true);
  });

  test("axis 3 — cross-format: CJS isHttpError on an ESM-created HTTP error", async () => {
    const esm = (await importDist("./dist/index.mjs")) as { typedFetch: typeof typedFetch };
    const cjs = require("./dist/index.js") as {
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const { error } = await esm.typedFetch("http://x/y", {
      fetch: async () => responseWithStatus(404),
    });
    expect(cjs.isHttpError(error)).toBe(true); // was false before the brand
    expect(cjs.isKnownHttpError(error)).toBe(true);
  });

  test("axis 4 — cross-format reverse: ESM isNetworkError on a CJS-built NetworkError", async () => {
    const cjsErrors = require("./dist/errors/index.js") as {
      NetworkError: typeof NetworkError;
    };
    const esm = (await importDist("./dist/index.mjs")) as {
      isNetworkError: typeof isNetworkError;
      isHttpError: typeof isHttpError;
    };
    const err = new cjsErrors.NetworkError("boom");
    expect(esm.isNetworkError(err)).toBe(true);
    expect(esm.isHttpError(err)).toBe(false);
  });

  test("axis 5/6 — full exclusivity matrix (instances CJS, guards ESM)", async () => {
    const cjs = require("./dist/errors/index.js") as {
      NotFoundError: typeof NotFoundError;
      InternalServerError: typeof InternalServerError;
      UnknownHttpError: typeof UnknownHttpError;
      NetworkError: typeof NetworkError;
      AbortedError: typeof AbortedError;
      TimeoutError: typeof TimeoutError;
    };
    const g = (await importDist("./dist/index.mjs")) as {
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
      isNetworkError: typeof isNetworkError;
      isAbortError: typeof isAbortError;
      isTimeoutError: typeof isTimeoutError;
    };
    const row = (v: unknown) => [
      g.isHttpError(v),
      g.isKnownHttpError(v),
      g.isNetworkError(v),
      g.isAbortError(v),
      g.isTimeoutError(v),
    ];
    expect(row(new cjs.NotFoundError(responseWithStatus(404)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(row(new cjs.InternalServerError(responseWithStatus(500)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    // axis 6: UnknownHttpError is http but NOT known, across copies.
    expect(row(new cjs.UnknownHttpError(responseWithStatus(499)))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(row(new cjs.NetworkError("x"))).toEqual([false, false, true, false, false]);
    expect(row(new cjs.AbortedError("x"))).toEqual([false, false, false, true, false]);
    expect(row(new cjs.TimeoutError("x"))).toEqual([false, false, false, false, true]);
  });

  test("axis 8 — clone() returns the right subclass across copies; switch narrows", async () => {
    const main = (await importDist("./dist/index.mjs")) as {
      typedFetch: typeof typedFetch;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const errors = (await importDist("./dist/errors/index.mjs")) as {
      NotFoundError: typeof NotFoundError;
    };
    const { error } = await main.typedFetch("http://x/y", {
      fetch: async () => new Response(JSON.stringify({ a: 1 }), { status: 404 }),
    });
    const cloned = (error as NotFoundError).clone();
    expect(cloned instanceof errors.NotFoundError).toBe(true);
    expect(cloned.status).toBe(404);
    expect(await cloned.json()).toEqual({ a: 1 });
    let label = "other";
    if (main.isKnownHttpError(error)) {
      switch (error.status) {
        case 404:
          label = "nf";
          break;
      }
    }
    expect(label).toBe("nf");
  });

  // ── The cross-copy ownership query, against the REAL artifacts ──────
  //
  // These belong here rather than in the consumer gate: they need real teed
  // streams and a `Promise.race` timeout guard, which vitest expresses directly
  // and a one-JSON-line probe does not. `B4` in base-http-error.spec.ts is the
  // primary regression guard, because these skip on a checkout with no `dist/`;
  // this block is the proof against the built files, where each FORMAT stamps
  // in its own module init and a bundler could drop one.

  test("axis 9 — an ESM-copy clone accepts a CJS-copy instance built from the branch", async () => {
    const esm = (await importDist("./dist/index.mjs")) as { typedFetch: typeof typedFetch };
    const cjsErrors = require("./dist/errors/index.js") as { NotFoundError: typeof NotFoundError };

    const { error } = await esm.typedFetch("http://x/y", {
      fetch: async () => new Response("payload", { status: 404 }),
    });
    const original = error as NotFoundError;

    const copy = original.clone(
      (response) => new cjsErrors.NotFoundError(response) as NotFoundError,
    );

    expect(copy).toBeDefined();
    expect(await settlesWithin(Promise.all([original.cancel(), copy.cancel()]))).toBe("settled");
  });

  test("axis 9 reverse — a CJS-copy clone accepts an ESM-copy instance", async () => {
    const cjs = require("./dist/index.js") as { typedFetch: typeof typedFetch };
    const esmErrors = (await importDist("./dist/errors/index.mjs")) as {
      NotFoundError: typeof NotFoundError;
    };

    const { error } = await cjs.typedFetch("http://x/y", {
      fetch: async () => new Response("payload", { status: 404 }),
    });
    const original = error as NotFoundError;

    const copy = original.clone(
      (response) => new esmErrors.NotFoundError(response) as NotFoundError,
    );

    expect(copy).toBeDefined();
    expect(await settlesWithin(Promise.all([original.cancel(), copy.cancel()]))).toBe("settled");
  });

  test("axis 10 — THE REPRODUCED DEFECT: a cross-copy instance from another response", async () => {
    // Reproduced on Node 20.15.0 against these exact files: the clone was
    // accepted, `branch.bodyUsed` stayed `false`, and `original.cancel()`
    // stayed pending forever.
    const esm = (await importDist("./dist/index.mjs")) as { typedFetch: typeof typedFetch };
    const cjsErrors = require("./dist/errors/index.js") as { NotFoundError: typeof NotFoundError };

    const { error } = await esm.typedFetch("http://x/y", {
      fetch: async () => new Response("payload", { status: 404 }),
    });
    const original = error as NotFoundError;
    const elsewhere = new Response("elsewhere", { status: 404 });

    let branch: Response | undefined;
    let thrown: unknown;
    try {
      original.clone((response) => {
        branch = response;
        return new cjsErrors.NotFoundError(elsewhere) as NotFoundError;
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/built from a different response/);
    expect(branch?.bodyUsed).toBe(true);
    expect(await settlesWithin(original.cancel())).toBe("settled");
    void elsewhere.body?.cancel().catch(() => {});
  });

  test("C4 — both built formats stamp the query with the frozen descriptor", async () => {
    // Each format runs its own module init, so a bundler that tree-shook the
    // stamping side effect out of one of them would leave that format unable to
    // answer — and every cross-copy clone through it would start throwing.
    const key = Symbol.for("@pbpeterson/typed-fetch.ownsResponse");
    const esm = (await importDist("./dist/index.mjs")) as { BaseHttpError: typeof BaseHttpError };
    const cjs = require("./dist/index.js") as { BaseHttpError: typeof BaseHttpError };

    for (const Base of [esm.BaseHttpError, cjs.BaseHttpError]) {
      expect(Object.getOwnPropertyDescriptor(Base.prototype, key)).toEqual({
        value: expect.any(Function),
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
  });

  test("C5 — no declaration file carries a unique symbol or a #private marker", () => {
    // The type-surface snapshot catches a leaked EXPORT. Only this catches a
    // leaked `unique symbol`, which would reintroduce the exact cross-format
    // assignability hazard (`TS2741`) that the whole no-`#private` rule exists
    // to avoid: two declaration files means two distinct unique symbols.
    for (const file of [
      "./dist/index.d.mts",
      "./dist/index.d.ts",
      "./dist/errors/index.d.mts",
      "./dist/errors/index.d.ts",
    ]) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(text, `${file} leaked the ownership query`).not.toContain("ownsResponse");
      expect(text, `${file} declares a unique symbol`).not.toContain("unique symbol");
      expect(text, `${file} carries a nominal #private marker`).not.toContain("#private");
    }
  });
});
