import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, test, expect, expectTypeOf } from "vitest";
import { typedFetch, isHttpError, isNetworkError } from "../../src/index";
import type { TypedFetchOptions, TypedFetchReturnType, TypedResponse } from "../../index";
import type { HttpMethods } from "../../src/methods";
import type { TypedFetchError } from "../../src/errors";
import { httpErrors } from "../../src/errors/helpers";
import { useTestServer } from "../../fixtures/http-server";
import {
  builtEntryUrl,
  distExists,
  importBuilt,
  warnWhenDistMissing,
} from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 8, LANE H4 — the public surface, the exported types, and the README
// claims that describe them, read from the BUILT package.
//
// Nothing here duplicates public-surface.spec.ts. That file freezes each entry
// point's export set on its own; type-level.spec.ts pins the declared types
// against `src/`; docs-claims.spec.ts executes the README's BEHAVIOURAL
// sentences. Three claims sit in the gap between them, and each block below
// names the one it holds.
// ═══════════════════════════════════════════════════════════════════════════

const server = useTestServer();

// dist/-ordering, handled exactly as public-surface.spec.ts handles it: a
// missing dist/ is a graceful local skip with a printed warning, and a hard
// error in CI, where .github/workflows/ci.yml runs `pnpm build` before
// `pnpm test` and a silent skip would mean the surface stopped being checked.
warnWhenDistMissing("round8-h4", distExists);

const importDist = (path: string): Promise<Record<string, unknown>> =>
  importBuilt<Record<string, unknown>>(path);

/** Every exported symbol of a built declaration file, split by meaning. */
function exportsOfDeclaration(dtsRelPath: string): { all: string[]; typeOnly: string[] } {
  const abs = fileURLToPath(builtEntryUrl(dtsRelPath));
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
      const flags = sym.flags & F.Alias ? checker.getAliasedSymbol(sym).flags : sym.flags;
      return (flags & TYPE_MEANING) !== 0 && (flags & F.Value) === 0 ? sym.getName() : null;
    })
    .filter((name): name is string => name !== null)
    .toSorted();
  return { all: exported.map((sym) => sym.getName()).toSorted(), typeOnly };
}

// ── H4-A — the RELATION between the two entry points ────────────────────
//
// public-surface.spec.ts snapshots `.` and `./errors` independently, and
// compares each `.d.mts` to its own `.d.ts`. No assertion anywhere compares the
// two ENTRY POINTS to each other, so a name that reached `./errors` and not `.`
// would produce two snapshot diffs a reviewer could accept one at a time.
//
// The relation the package documents is containment: the README says to import
// "only the error classes from `@pbpeterson/typed-fetch/errors` when you do not
// need `typedFetch`", and the public skill says "the error classes alone are
// available from" that subpath. Subset, never a second surface.

describe.skipIf(!distExists)("H4-A: `./errors` is a strict subset of the root entry", () => {
  test("no name reaches `./errors` without also reaching `.`", () => {
    const root = exportsOfDeclaration("./dist/index.d.mts");
    const errors = exportsOfDeclaration("./dist/errors/index.d.mts");

    expect(errors.all.filter((name) => !root.all.includes(name))).toEqual([]);
    expect(errors.typeOnly.filter((name) => !root.typeOnly.includes(name))).toEqual([]);
  });

  test("the difference is exactly the request surface the subpath omits", () => {
    // Stated positively, so SHRINKAGE fails too: a subset assertion alone stays
    // green when `./errors` loses a class.
    const root = exportsOfDeclaration("./dist/index.d.mts");
    const errors = exportsOfDeclaration("./dist/errors/index.d.mts");

    expect(root.all.filter((name) => !errors.all.includes(name))).toEqual([
      "HttpMethods",
      "TypedFetchOptions",
      "TypedFetchReturnType",
      "TypedResponse",
      "isAbortError",
      "isHttpError",
      "isKnownHttpError",
      "isNetworkError",
      "isTimeoutError",
      "typedFetch",
    ]);
  });

  test("both entry points ship the same error-class set at runtime", async () => {
    const root = Object.keys(await importDist("./dist/index.mjs"));
    const errors = Object.keys(await importDist("./dist/errors/index.mjs"));
    expect(errors.filter((name) => !root.includes(name))).toEqual([]);
    // The 40 dedicated classes plus the five hand-written ones.
    expect(errors.toSorted()).toEqual(
      [
        ...httpErrors.map((ErrorClass) => ErrorClass.name),
        "AbortedError",
        "BaseHttpError",
        "NetworkError",
        "TimeoutError",
        "UnknownHttpError",
      ].toSorted(),
    );
  });
});

// ── H4-B — the README's class table against the BUILT package ───────────
//
// roster-sync.spec.ts holds a hand-written table and compares it to `src/`.
// The README carries a SECOND hand-written table, 40 rows of class name,
// status, and reason phrase, plus two cardinality claims in its `<summary>`
// lines. Nothing reads it. A wrong row there is what a consumer reads before
// they write the `switch`.

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

interface DocumentedRow {
  readonly name: string;
  readonly status: number;
  readonly statusText: string;
}

/** Every `| \`XxxError\` | NNN | Phrase |` row of the README's class tables. */
function documentedRows(): DocumentedRow[] {
  const rows: DocumentedRow[] = [];
  for (const line of README.split("\n")) {
    const match = /^\|\s*`(\w+Error)`\s*\|\s*(\d{3})\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (match) {
      rows.push({ name: match[1]!, status: Number(match[2]), statusText: match[3]! });
    }
  }
  return rows;
}

describe.skipIf(!distExists)("H4-B: the README class table is the roster the package ships", () => {
  test("the table has one row per dedicated class, and the counts it prints agree", () => {
    const rows = documentedRows();
    expect(rows).toHaveLength(httpErrors.length);
    expect(rows.filter((row) => row.status < 500)).toHaveLength(29);
    expect(rows.filter((row) => row.status >= 500)).toHaveLength(11);
    // The `<summary>` lines carry the same two numbers in prose. A row moved
    // between the two tables has to move both.
    expect(README).toContain("<strong>4xx client errors</strong> (29 classes of 40)");
    expect(README).toContain("<strong>5xx server errors</strong> (11 classes of 40)");
  });

  test("every row names the status and the canonical label the built class carries", async () => {
    const mod = (await importDist("./dist/errors/index.mjs")) as unknown as Record<
      string,
      { readonly status?: unknown; readonly statusText?: unknown } | undefined
    >;

    for (const row of documentedRows()) {
      const ErrorClass = mod[row.name];
      expect(ErrorClass, `README names ${row.name}, which the package does not export`).toBeTypeOf(
        "function",
      );
      expect(ErrorClass?.status, `${row.name} status`).toBe(row.status);
      // `statusText` is public API under semver rule 3, and the README table is
      // the only place a consumer reads it without running the code.
      expect(ErrorClass?.statusText, `${row.name} statusText`).toBe(row.statusText);
    }
  });
});

// ── H4-C — HttpMethods, and what a JavaScript caller gets ───────────────
//
// type-level.spec.ts pins that `CONNECT` and `TRACE` are outside the union, and
// docs-claims.spec.ts drives `CONNECT` through the transport. The README's
// sentence covers both names and gives a REASON — "native `fetch` throws a
// `TypeError` for them" — and the type cannot stop a JavaScript caller. What
// that caller must get is the envelope, never a rejection.
//
// Checked against the Fetch Standard's forbidden-method set (CONNECT, TRACE,
// TRACK, byte-case-insensitive), so the lowercase spellings are here too.

describe("H4-C: the forbidden methods stay outside the type and inside the envelope", () => {
  test("the union omits every forbidden method", () => {
    expectTypeOf<"CONNECT">().not.toExtend<HttpMethods>();
    expectTypeOf<"TRACE">().not.toExtend<HttpMethods>();
    expectTypeOf<"TRACK">().not.toExtend<HttpMethods>();
  });

  test.each(["TRACE", "trace", "CONNECT", "TRACK"])(
    "a JavaScript caller who passes %s resolves with a NetworkError",
    async (method) => {
      const { response, error } = await typedFetch(server.url(), {
        method: method as HttpMethods,
      });

      expect(response).toBe(null);
      expect(isNetworkError(error)).toBe(true);
      // README:583 — the message is a library constant; the platform's own text
      // (which quotes the caller's method back) stays on `cause`.
      expect(error?.message).toBe("Network error");
      expect(error?.cause).toBeInstanceOf(TypeError);
    },
  );
});

// ── H4-D — envelope narrowing shapes type-level.spec.ts does not pin ─────
//
// The narrowing tests there all destructure or read a `const` directly. A
// wrapper generic over the payload, a `satisfies` annotation, and a callback
// parameter inside `Array.prototype.map` each reach the union through a
// different inference path. `pnpm typecheck` compiles this file, so a failure
// to narrow is a compile error rather than a red assertion.

/** The exact wrapper the README's "Exported types" section prints. */
async function api<T>(path: string, options?: TypedFetchOptions): Promise<TypedFetchReturnType<T>> {
  return typedFetch<T>(path, options);
}

describe("H4-D: the envelope narrows through the shapes a wrapper actually writes", () => {
  test("under a `satisfies` annotation", async () => {
    const result = (await typedFetch<{ id: number }>(server.url({ status: 204 }), {
      fetch: async () => new Response(null, { status: 204 }),
    })) satisfies TypedFetchReturnType<{ id: number }>;

    if (result.error) {
      expectTypeOf(result.response).toEqualTypeOf<null>();
      expectTypeOf(result.error).toEqualTypeOf<TypedFetchError>();
    } else {
      expectTypeOf(result.response).toEqualTypeOf<TypedResponse<{ id: number }>>();
    }
    expect(result.error).toBe(null);
  });

  test("through a generic wrapper whose parameter is TypedFetchOptions", async () => {
    const { response, error } = await api<{ id: number }>(server.url(), {
      fetch: async () => new Response("x", { status: 404 }),
    });

    if (error) {
      expectTypeOf(response).toEqualTypeOf<null>();
      expectTypeOf(error).toEqualTypeOf<TypedFetchError>();
    } else {
      expectTypeOf(response).toEqualTypeOf<TypedResponse<{ id: number }>>();
    }
    expect(isHttpError(error)).toBe(true);
    if (isHttpError(error)) await error.cancel();
  });

  test("inside an Array.prototype.map callback over settled envelopes", async () => {
    const results = await Promise.all([
      typedFetch<{ id: number }>(server.url(), {
        fetch: async () => new Response(null, { status: 204 }),
      }),
      typedFetch<{ id: number }>(server.url(), {
        fetch: async () => new Response(null, { status: 204 }),
      }),
    ]);

    const labels = results.map((result) => {
      if (result.error) {
        expectTypeOf(result.response).toEqualTypeOf<null>();
        return result.error.name;
      }
      expectTypeOf(result.response).toEqualTypeOf<TypedResponse<{ id: number }>>();
      return String(result.response.status);
    });

    expect(labels).toEqual(["204", "204"]);
  });
});
