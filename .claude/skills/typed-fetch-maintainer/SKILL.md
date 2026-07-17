---
name: typed-fetch-maintainer
description: Maintainer guide for @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper with Go-style errors-as-values. Use when working in this repository — adding HTTP error classes, changing typedFetch behavior, editing TypedHeaders/HttpMethods, writing tests, or cutting a release. Triggers on typedFetch, BaseHttpError, UnknownHttpError, NetworkError, AbortedError, TimeoutError, statusCodeErrorMap, ClientErrors/ServerErrors.
---

# typed-fetch Maintainer Guide

Type-safe `fetch` wrapper that resolves request failures through a `{ response, error }` discriminated union. Native body readers remain throwing operations. Zero runtime dependencies. Published to npm as `@pbpeterson/typed-fetch` via OIDC trusted publishing.

## Architecture

```
index.ts                  → intentionally small public barrel (functions, errors, public types)
src/index.ts              → typedFetch core + type guards + TypedResponse/Options types
src/headers.ts            → internal StrictHeaders / TypedHeaders (IntelliSense headers)
src/methods.ts            → internal HttpMethods (no CONNECT/TRACE — fetch forbids them)
src/http-status-codes.ts  → internal statusCodeErrorMap: ReadonlyMap<number, HttpErrors>
src/errors/
  base-http-error.ts      → abstract base: message "HTTP 404 Not Found (<url>)",
                            url, headers, json<T>()/text()/blob()/arrayBuffer(),
                            generic clone(): this
  known-http-error.ts     → internal branded base for the 40 dedicated classes
  network-error.ts        → NetworkError with cause (original fetch rejection)
  aborted-error.ts        → AbortedError (controller.abort()); extends Error, NOT NetworkError
  timeout-error.ts        → TimeoutError (AbortSignal.timeout()); extends Error, NOT NetworkError
  unknown-http-error.ts   → any status >= 400 not in the map (non-literal status)
  helpers.ts              → public unions + internal HttpErrors/httpErrors registry
  index.ts                → re-export barrel for the ./errors subpath
  <40 status files>       → dedicated classes, see pattern below
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

No broad internal throw/catch control flow beyond the single `fetch` envelope.
Narrow defensive readers may catch hostile property/prototype access solely to
keep a rejected custom-fetch value inside that envelope; they must not drive
normal request control flow.

### The error contract (consumer-facing — keep it stable)

- `AbortedError` and `TimeoutError` do NOT extend `NetworkError`. `isNetworkError()` returns **false** for both aborts and timeouts. This is deliberate — consumers discriminate with `isAbortError(e)` / `isTimeoutError(e)`, never by inspecting `error.cause.name`.
- `AbortedError` carries the abort reason as `error.reason` (plus the original rejection as `cause`); `TimeoutError` is the sub-case produced by `AbortSignal.timeout()`.
- HTTP errors carry `error.url` (from `response.url`) and fold the server's wire reason phrase into `error.message`. `error.message` is NOT part of the semver contract (see RELEASING.md). Consumer-facing behavior tests should assert on `.status`/`.name`/`.statusText`; narrowly scoped constructor regression tests may characterize message branches without promoting the text to a public guarantee.

## Type guards (src/index.ts)

Exported from the main entry: `isHttpError` (any `BaseHttpError`),
`isKnownHttpError` (one of the library's dedicated classes), `isNetworkError`,
`isAbortError`, and `isTimeoutError`. A consumer-defined `BaseHttpError`
subclass passes `isHttpError` but not `isKnownHttpError`; the latter requires
the separate internal known-error brand and a status present in the receiving
copy's map. Its `ClientErrors | ServerErrors` predicate therefore remains sound
across duplicate copies, ESM/CJS entries, and mixed minor versions.

## Error class pattern

```typescript no-check
import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 */
export class NotFoundError extends KnownHttpError {
  override readonly name = "NotFoundError" as const;
  public readonly status = 404 as const;
  public readonly statusText = "Not Found" as const;
  static readonly status = 404 as const;
  static readonly statusText = "Not Found" as const;
}
```

Rules: extend the internal `KnownHttpError`; set an explicit literal `name`;
use `as const` (oxlint prefer-as-const); provide instance AND static status
properties; and add no constructor or `clone()` — the base class provides both.
The file is kebab-case matching the class name. `statusText` is the library's
canonical protocol label (normally the current IANA phrase), not the server's
wire value. The documented historical exceptions are 418 and 510.

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
- **API-surface snapshot + barrel completeness** (`describe("public API surface is frozen")`): snapshots the sorted named exports of the BUILT `dist/index.mjs` and `dist/errors/index.mjs`, then compares the internal `httpErrors` names/statuses with both entry points so a registered class cannot ship without being importable. It is `describe.skipIf(!distExists)` — it only runs after `pnpm build` because `dist/` is gitignored. CI deliberately builds first. Any intentional export add/remove needs `pnpm build && pnpm test -u` to refresh the snapshot.

## Verification (run all before commit)

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm check-docs
pnpm verify-pack
pnpm check-consumer
pnpm audit:prod
pnpm audit
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
- CI verifies Node 20, 22, and 24 plus Bun and Deno. Browser and edge support
  follows from the Web-standard-only runtime implementation, but a runtime is
  not called verified until its smoke test exists. Keep Node APIs outside
  production source.

## Release

Releases are PR-reviewed and tag-driven — the full, binding process is in
**RELEASING.md**; follow it exactly. In short:

1. Open a release PR against `main` with the chosen version and dated changelog;
   all required checks above must pass.
2. Merge the PR and verify the exact release commit is the current
   `origin/main` tip.
3. Create and push the matching `vX.Y.Z` tag on that commit. The tag-triggered
   workflow revalidates the version, commit, full gate set, tarball, and
   consumer install before `npm publish --provenance` through OIDC, with no
   repository npm token.
4. Verify the npm version, dist-tag, provenance attestation, source commit, and
   workflow run after publication. Never retry by moving or reusing a published
   tag.

Semver highlights (RELEASING.md is authoritative):

- **Adding a dedicated error class to `ClientErrors`/`ServerErrors` is a `minor`** — the value was always reachable at runtime (as `UnknownHttpError`); nothing that compiled stops compiling. Consumers must keep a `default:` in exhaustive `switch (error.status)`.
- **Moving a code from `UnknownHttpError` to a dedicated class is a `major`** (changes the runtime type of an existing code path).
- Removing/renaming an export, or changing a class's `status`/`statusText` literal, is a `major`. Node engines stay `>=20`; dropping a Node major is a `major`.
