import { existsSync } from "node:fs";
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
  InternalServerError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";

function responseWithStatus(status: number): Response {
  return new Response(null, { status });
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
});
