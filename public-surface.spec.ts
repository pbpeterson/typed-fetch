import { readFileSync } from "node:fs";
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
  distExists,
  importBuilt,
  loadRootCjs,
  loadRootEsm,
  requireBuilt,
  warnWhenDistMissing,
} from "./fixtures/built-package";
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
warnWhenDistMissing("api-surface", distExists);

const importDist = (path: string): Promise<Record<string, unknown>> =>
  importBuilt<Record<string, unknown>>(path);

// The CJS half of every axis below. A snapshot reads ONE format, and the two
// formats are built from one source by one bundler — so the CJS barrel is
// checked by requiring it and comparing it to the ESM side, rather than by a
// second snapshot that could drift from the first without a reviewer noticing.
const requireDist = <T = Record<string, unknown>>(path: string): T => requireBuilt<T>(path);

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

  // The CJS barrel is the format `require()` reaches, and neither snapshot
  // above reads it. A class dropped from `dist/errors/index.js` alone left
  // every gate green: the snapshots read `.mjs`, `check-consumer` requires the
  // package but asserts a handful of names, and `verify-pack` checks paths.
  test.each([
    ["main entry", "./dist/index.mjs", "./dist/index.js"],
    ["./errors subpath", "./dist/errors/index.mjs", "./dist/errors/index.js"],
  ])("%s exports the same names in both formats", async (_entry, esmPath, cjsPath) => {
    const esm = Object.keys(await importDist(esmPath)).toSorted();
    const cjs = Object.keys(requireDist(cjsPath) as Record<string, unknown>).toSorted();
    expect(cjs).toEqual(esm);
  });

  test.each([
    ["main entry", "./dist/index.mjs"],
    ["./errors subpath", "./dist/errors/index.mjs"],
    ["main entry (CJS)", "./dist/index.js"],
    ["./errors subpath (CJS)", "./dist/errors/index.js"],
  ])("%s exports every dedicated class in the internal roster", async (_entry, path) => {
    const mod = path.endsWith(".js")
      ? (requireDist(path) as Record<string, unknown>)
      : await importDist(path);

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
    ["main entry (CJS)", "./dist/index.js"],
    ["./errors subpath (CJS)", "./dist/errors/index.js"],
  ])("%s ships toJSON on the built error classes", async (_entry, path) => {
    const mod = (path.endsWith(".js") ? requireDist(path) : await importDist(path)) as unknown as {
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
function exportsOfDeclaration(dtsRelPath: string): { all: string[]; typeOnly: string[] } {
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

  const exported = checker.getExportsOfModule(moduleSymbol);
  const typeOnly = exported
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
  return { all: exported.map((sym) => sym.getName()).toSorted(), typeOnly };
}

/** The type-only export set, which is what the snapshot pair freezes. */
function typeOnlyExportsOf(dtsRelPath: string): string[] {
  return exportsOfDeclaration(dtsRelPath).typeOnly;
}

describe.skipIf(!distExists)("public TYPE surface is frozen", () => {
  test("main entry type-only exports", () => {
    expect(typeOnlyExportsOf("./dist/index.d.mts")).toMatchSnapshot();
  });

  test("./errors subpath type-only exports", () => {
    expect(typeOnlyExportsOf("./dist/errors/index.d.mts")).toMatchSnapshot();
  });

  // The snapshots read `.d.mts`, the declaration an `import`-condition consumer
  // gets. A `require`-condition consumer reads `.d.ts`, which no snapshot sees.
  // Compare the two rather than snapshot both: one reviewable diff, and the two
  // files cannot drift apart without this failing.
  test.each([
    ["main entry", "./dist/index.d.mts", "./dist/index.d.ts"],
    ["./errors subpath", "./dist/errors/index.d.mts", "./dist/errors/index.d.ts"],
  ])("%s declares the same exports in both declaration files", (_entry, mts, dts) => {
    const esm = exportsOfDeclaration(mts);
    const cjs = exportsOfDeclaration(dts);
    expect(cjs.all).toEqual(esm.all);
    expect(cjs.typeOnly).toEqual(esm.typeOnly);
  });

  test.each([
    ["main entry", "./dist/index.d.ts", "./dist/index.mjs"],
    ["./errors subpath", "./dist/errors/index.d.ts", "./dist/errors/index.mjs"],
  ])("%s declares every runtime value it ships", async (_entry, dts, mjs) => {
    const declared = new Set(exportsOfDeclaration(dts).all);
    for (const name of Object.keys(await importDist(mjs))) {
      expect(declared.has(name), `${name} ships at runtime but is not declared`).toBe(true);
    }
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

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 6 — two genuine package copies in one process.
//
// Raw `instanceof` does not cross the seam and the brand guards do; a
// `clone(recreate)` accepted across it is teed for real; a copy that cannot
// confirm the branch is refused with the branch released.
// ═══════════════════════════════════════════════════════════════════════════

// The round-6 block reads the same `dist/index.mjs` as the surface blocks
// above, so the one `warnWhenDistMissing` call at the top of this file already
// reports a missing build. It used to carry a second probe and a second
// warning, which printed twice and could disagree with the first.
interface Copy {
  BaseHttpError: new (response: Response) => BaseHttpError;
  NotFoundError: new (response: Response) => BaseHttpError;
  UnknownHttpError: new (response: Response) => BaseHttpError;
  isHttpError: (value: unknown) => boolean;
  isKnownHttpError: (value: unknown) => boolean;
}

const esmCopy = (): Promise<Copy> => loadRootEsm<Copy>();
const cjsCopy = (): Copy => loadRootCjs<Copy>();

async function copies6_settlesWithin(promise: Promise<unknown>, ms = 500): Promise<string> {
  return Promise.race([
    promise.then(
      () => "settled",
      () => "rejected",
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

const payload = (status = 404): Response => new Response("payload", { status });

describe.skipIf(!distExists)("L4-C — two genuine package copies", () => {
  test("L4-C1: the copies are distinct, and only the brand-keyed guards cross the seam", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    expect(esm.NotFoundError).not.toBe(cjs.NotFoundError);
    expect(esm.NotFoundError as unknown).not.toBe(NotFoundError as unknown);

    const error = new esm.NotFoundError(payload());
    // Raw `instanceof` does NOT cross — the documented reason the guards exist.
    expect(error instanceof (cjs.NotFoundError as never)).toBe(false);
    expect(error instanceof NotFoundError).toBe(false);
    // The guards do.
    expect(cjs.isHttpError(error)).toBe(true);
    expect(cjs.isKnownHttpError(error)).toBe(true);
    expect(isHttpError(error)).toBe(true);
    expect(isKnownHttpError(error)).toBe(true);
    expect(await copies6_settlesWithin(error.cancel())).toBe("settled");
  });

  test("L4-C2: ESM clones, CJS supplies the copy — accepted, teed for real, both released", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new esm.NotFoundError(payload());
    const copy = error.clone((branch) => new cjs.NotFoundError(branch) as never);

    expect(copy instanceof (cjs.NotFoundError as never)).toBe(true);
    // Acceptance alone proves nothing about the stream: read BOTH sides.
    expect([await error.text(), await copy.text()]).toEqual(["payload", "payload"]);
  });

  test("L4-C3: the same pairing, released rather than read", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new esm.NotFoundError(payload());
    const copy = error.clone((branch) => new cjs.NotFoundError(branch) as never);

    expect(await copies6_settlesWithin(Promise.all([error.cancel(), copy.cancel()]))).toBe(
      "settled",
    );
  });

  test("L4-C4: the reverse direction — CJS clones, ESM supplies the copy", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new cjs.NotFoundError(payload());
    const copy = error.clone((branch) => new esm.NotFoundError(branch) as never);

    expect(copy).toBeDefined();
    expect(await copies6_settlesWithin(Promise.all([error.cancel(), copy.cancel()]))).toBe(
      "settled",
    );
  });

  test("L4-C5: a cross-copy instance built from a DIFFERENT response is refused, and the branch released", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new esm.NotFoundError(payload());
    const elsewhere = new Response("elsewhere", { status: 404 });
    let branch: Response | undefined;
    let thrown: unknown;
    try {
      error.clone((response) => {
        branch = response;
        return new cjs.NotFoundError(elsewhere) as never;
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/built from a different response/);
    expect(branch?.bodyUsed).toBe(true);
    expect(await copies6_settlesWithin(error.cancel())).toBe("settled");
    void elsewhere.body?.cancel().catch(() => {});
  });

  test("L4-C6: a SUBCLASS of the other copy's BaseHttpError is accepted and narrows correctly", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    class Foreign extends cjs.BaseHttpError {
      override readonly name = "Foreign";
      readonly status = 499;
      readonly statusText = "Foreign";
    }

    const error = new esm.NotFoundError(payload());
    const copy = error.clone((branch) => new Foreign(branch) as never);

    expect(copy).toBeInstanceOf(Foreign);
    // A consumer subclass passes `isHttpError` and must NOT pass
    // `isKnownHttpError` — across copies too.
    expect(isHttpError(copy)).toBe(true);
    expect(isKnownHttpError(copy)).toBe(false);
    expect(esm.isKnownHttpError(copy)).toBe(false);
    expect(await copies6_settlesWithin(Promise.all([error.cancel(), copy.cancel()]))).toBe(
      "settled",
    );
  });

  test("L4-C7: a cross-copy clone CHAIN — clone the foreign copy again, back across the seam", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new esm.NotFoundError(payload());
    const copy = error.clone((branch) => new cjs.NotFoundError(branch) as never);
    const copy2 = copy.clone((branch) => new esm.NotFoundError(branch) as never);

    expect(copy2).toBeDefined();
    expect(
      await copies6_settlesWithin(Promise.all([error.cancel(), copy.cancel(), copy2.cancel()])),
    ).toBe("settled");
  });

  test("L4-C8: UnknownHttpError is excluded by isKnownHttpError from the other copy", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new esm.UnknownHttpError(payload(599));
    expect(cjs.isHttpError(error)).toBe(true);
    expect(cjs.isKnownHttpError(error)).toBe(false);
    expect(await copies6_settlesWithin(error.cancel())).toBe("settled");
  });

  test("L4-C9: THE RESIDUAL, re-verified — a cross-copy copy INHERITS nothing and reads the branch", async () => {
    // ADR 0002, amendment of 2026-07-26. The identity tables are per package
    // copy, so a `recreate` callback returning an instance from a DIFFERENT
    // copy runs that copy's constructor against tables that never saw the loan.
    // This asserts the divergence is confined to IDENTITY: nothing is stranded,
    // and the same-copy clone still inherits.
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const shifting = (): Response => {
      let reads = 0;
      const response = new Response("payload", { status: 404 });
      Object.defineProperty(response, "statusText", {
        get() {
          reads += 1;
          return reads === 1 ? "FIRST" : "LATER";
        },
        configurable: true,
      });
      return response;
    };

    const sameCopyOriginal = new esm.UnknownHttpError(shifting());
    const sameCopyClone = sameCopyOriginal.clone();
    expect((sameCopyOriginal as unknown as { statusText: string }).statusText).toBe("FIRST");
    expect((sameCopyClone as unknown as { statusText: string }).statusText).toBe("FIRST");

    const crossCopyOriginal = new esm.UnknownHttpError(shifting());
    const crossCopyClone = crossCopyOriginal.clone(
      (branch) => new cjs.UnknownHttpError(branch) as never,
    );
    expect((crossCopyOriginal as unknown as { statusText: string }).statusText).toBe("FIRST");
    // The branch is a real `Response.clone()`, so the other copy reads the
    // platform's internal slot — the empty reason phrase — not "LATER" and not
    // "FIRST". The two errors disagree, which is the stated residual.
    expect((crossCopyClone as unknown as { statusText: string }).statusText).toBe("");
    // Nothing is stranded, which is the half that matters here.
    expect(
      await copies6_settlesWithin(
        Promise.all([
          sameCopyOriginal.cancel(),
          sameCopyClone.cancel(),
          crossCopyOriginal.cancel(),
          crossCopyClone.cancel(),
        ]),
      ),
    ).toBe("settled");
  });

  test("L4-C10: a structuredClone-rebuilt error is not believed by EITHER copy", async () => {
    const esm = await esmCopy();
    const cjs = cjsCopy();

    const error = new esm.NotFoundError(payload());
    const rebuilt = structuredClone(error) as unknown;

    expect(esm.isHttpError(rebuilt)).toBe(false);
    expect(cjs.isHttpError(rebuilt)).toBe(false);
    expect(isHttpError(rebuilt)).toBe(false);
    expect(await copies6_settlesWithin(error.cancel())).toBe("settled");
  });

  test("L4-C11: a rebuilt plain Error returned from a recreate callback is refused, and releases", async () => {
    const esm = await esmCopy();

    const error = new esm.NotFoundError(payload());
    const donor = new esm.NotFoundError(payload());
    const rebuilt = structuredClone(donor) as unknown;
    await donor.cancel();

    let branch: Response | undefined;
    let thrown: unknown;
    try {
      error.clone((response) => {
        branch = response;
        return rebuilt as never;
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/cannot confirm that it took the cloned body branch/);
    expect(branch?.bodyUsed).toBe(true);
    expect(await copies6_settlesWithin(error.cancel())).toBe("settled");
  });
});
