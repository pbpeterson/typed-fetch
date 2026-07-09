---
name: typed-fetch-maintainer
description: Maintainer guide for @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper with Go-style errors-as-values. Use when working in this repository — adding HTTP error classes, changing typedFetch behavior, editing TypedHeaders/HttpMethods, writing tests, or cutting a release. Triggers on typedFetch, BaseHttpError, UnknownHttpError, NetworkError, AbortedError, TimeoutError, statusCodeErrorMap, ClientErrors/ServerErrors.
---

# typed-fetch Maintainer Guide

Type-safe `fetch` wrapper that never throws. Returns `{ response, error }` discriminated union. Zero runtime dependencies. Published to npm as `@pbpeterson/typed-fetch` via OIDC trusted publishing.

## Architecture

```
index.ts                  → public barrel (functions, registries, all types)
src/index.ts              → typedFetch core + type guards + TypedResponse/Options types
src/headers.ts            → StrictHeaders / TypedHeaders (IntelliSense headers)
src/methods.ts            → HttpMethods (no CONNECT/TRACE — fetch forbids them)
src/http-status-codes.ts  → statusCodeErrorMap: ReadonlyMap<number, HttpErrors>
src/errors/
  base-http-error.ts      → abstract base: message "HTTP 404 Not Found (<url>)",
                            url, headers, json<T>()/text()/blob()/arrayBuffer(),
                            generic clone(): this
  network-error.ts        → NetworkError with cause (original fetch rejection)
  aborted-error.ts        → AbortedError (controller.abort()); extends Error, NOT NetworkError
  timeout-error.ts        → TimeoutError (AbortSignal.timeout()); extends Error, NOT NetworkError
  unknown-http-error.ts   → any status >= 400 not in the map (non-literal status)
  helpers.ts              → ClientErrors/ServerErrors unions, TypedFetchError union, httpErrors array
  index.ts                → re-export barrel for the ./errors subpath
  <40 status files>       → 4-line classes, see pattern below
```

## Core flow (src/index.ts)

1. Pull an optional `fetch` override off `options` (`options.fetch`, defaults to global `fetch`); the rest is the `RequestInit`.
2. `try { res = await fetchImpl(url, init) } catch (err)` → classify the rejection:
   - an abort → `AbortedError` (with the original rejection as `cause`),
   - a timeout (from `AbortSignal.timeout()`) → `TimeoutError`,
   - anything else → `NetworkError`.
     Never rethrows.
3. `res.status >= 400` → mapped class from `statusCodeErrorMap`, else `UnknownHttpError`.
4. Otherwise success — body NOT parsed; consumer calls `response.json()`. 3xx with `redirect: "manual"` is success.

No internal throw/catch control flow beyond the single `fetch` try/catch. Keep it that way.

### The error contract (consumer-facing — keep it stable)

- `AbortedError` and `TimeoutError` do NOT extend `NetworkError`. `isNetworkError()` returns **false** for both aborts and timeouts. This is deliberate — consumers discriminate with `isAbortError(e)` / `isTimeoutError(e)`, never by inspecting `error.cause.name`.
- `AbortedError` carries the abort reason as `error.reason` (plus the original rejection as `cause`); `TimeoutError` is the sub-case produced by `AbortSignal.timeout()`.
- HTTP errors carry `error.url` (from `response.url`) and fold the server's wire reason phrase into `error.message`. `error.message` is NOT part of the semver contract (see RELEASING.md) — never assert on it; assert on `.status`/`.name`/`.statusText`.

## Type guards (src/index.ts)

Exported from the main entry: `isHttpError` (any `BaseHttpError`), `isKnownHttpError` (a dedicated class, excludes `UnknownHttpError` — narrows `switch (error.status)`), `isNetworkError`, `isAbortError`, `isTimeoutError`.

## Error class pattern

```typescript
import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 */
export class NotFoundError extends BaseHttpError {
  public readonly status = 404 as const;
  public readonly statusText = "Not Found" as const;
  static readonly status = 404 as const;
  static readonly statusText = "Not Found" as const;
}
```

Rules: `as const` (oxlint prefer-as-const), instance AND static props, no constructor, no clone() — base class provides both. File kebab-case matching class name. `statusText` is the canonical IANA reason phrase, not the server's wire value.

### Adding a new status code (5 hand-edited places)

The roster is hand-maintained. To add a dedicated class for status code `NNN`:

1. **Create** `src/errors/<kebab>-error.ts` (pattern above).
2. **Export** it from `src/errors/index.ts` (`export { NnnError } from "./nnn-error";`).
3. In `src/errors/helpers.ts`, add it in **two** spots: the `ClientErrors` or `ServerErrors` union AND the `httpErrors` array.
4. In `src/http-status-codes.ts`, add the import at the top AND the `[NNN, NnnError]` entry to the `statusCodeErrorMap` Map literal.
5. In `test.spec.ts`, add a row to **both** the `errorCases` table and the `allErrors` table, and bump the cardinality assertions — currently **40** (the `expect(httpErrors).toHaveLength(40)` / `statusCodeErrorMap.size` checks in the `httpErrors & statusCodeErrorMap` block, and the `roster.length` / `size` checks in the `roster sync` block).

Adding a class also changes the public API surface, so update the snapshot (see below): `pnpm build && pnpm test -u`.

## Guardrail tests (test.spec.ts)

These are what keep the hand-edited roster honest — run and read them when touching errors:

- **Roster sync** (`describe("roster sync")`): compile-time `InstanceType<HttpErrors>` vs `ClientErrors | ServerErrors` exhaustiveness; runtime cardinality (exactly 40) and `httpErrors` ↔ `statusCodeErrorMap` agreement; and 40 explicit per-class `expectTypeOf<XError["status"]>().toEqualTypeOf<NNN>()` assertions (the array/union checks do NOT catch a single class's literal being widened — only the per-class ones do).
- **API-surface snapshot** (`describe("public API surface is frozen")`): snapshots the sorted named exports of the BUILT `dist/index.mjs` and `dist/errors/index.mjs`. It is `describe.skipIf(!distExists)` — it only runs after `pnpm build` (dist/ is gitignored and CI runs `pnpm test` before `pnpm build`, so it skips there). Any export add/remove needs `pnpm build && pnpm test -u` to refresh the snapshot; a diff is a reviewable minor/major signal.

## Verification (run all before commit)

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm test
```

- Build BEFORE test so the API-surface snapshot tests actually run (they skip when `dist/` is absent).
- `pnpm typecheck` uses `tsconfig.test.json` — includes `test.spec.ts` so `expectTypeOf` assertions are real. Plain `tsc --noEmit` skips them.
- Tests hit a real local HTTP server (no mocks). Query params drive responses: `?status=`, `?body=`, `?header=Key:Value`.
- 407 can't go through Node's fetch (rejected at network level) — tested via direct construction.
- Abort/timeout are exercised against the live server (`controller.abort()` and `AbortSignal.timeout()`), asserting `AbortedError`/`TimeoutError` and that `isNetworkError` is false for both.

## Gotchas

- `tsconfig.json` needs `"lib": ["ES2022", "DOM"]` — DOM supplies `HeadersInit`; dropping it breaks headers.ts.
- `tsup.config.ts` carries `ignoreDeprecations: "6.0"` in dts compilerOptions — tsup injects deprecated `baseUrl`; remove when tsup fixes it.
- oxfmt formats and sorts `package.json` — don't fight it.
- `statusCodeErrorMap` is `ReadonlyMap` by type; never mutate.
- `options.fetch` is stripped off before the init reaches the underlying fetch — don't forward it into the request.
- Verified runtimes: Node 20+, Cloudflare Workers (workerd). Keep runtime code Web-standard only — no Node APIs outside tests.

## Release

Releases are manual and tag-driven — the full, binding process is in **RELEASING.md**; follow it exactly. In short:

1. Ensure `main` is green (`pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`).
2. Decide the bump using the **semver policy** in RELEASING.md, then bump `version` in `package.json` (edit the field directly — no `npm/pnpm version`).
3. Add a `CHANGELOG.md` entry.
4. Commit `package.json` + `CHANGELOG.md` together, tag `vX.Y.Z`, push the commit then the tag. The tag push triggers `.github/workflows/release.yml` → gates → `npm publish --provenance` (OIDC, no token).

Semver highlights (RELEASING.md is authoritative):

- **Adding a dedicated error class to `ClientErrors`/`ServerErrors` is a `minor`** — the value was always reachable at runtime (as `UnknownHttpError`); nothing that compiled stops compiling. Consumers must keep a `default:` in exhaustive `switch (error.status)`.
- **Moving a code from `UnknownHttpError` to a dedicated class is a `major`** (changes the runtime type of an existing code path).
- Removing/renaming an export, or changing a class's `status`/`statusText` literal, is a `major`. Node engines stay `>=20`; dropping a Node major is a `major`.
