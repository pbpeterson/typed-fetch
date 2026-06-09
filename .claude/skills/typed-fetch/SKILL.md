---
name: typed-fetch
description: Maintainer guide for @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper with Go-style errors-as-values. Use when working in this repository — adding HTTP error classes, changing typedFetch behavior, editing TypedHeaders/HttpMethods, writing tests, or cutting a release. Triggers on typedFetch, BaseHttpError, UnknownHttpError, NetworkError, statusCodeErrorMap, ClientErrors/ServerErrors.
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
  base-http-error.ts      → abstract base: message "HTTP 404 Not Found", headers,
                            json<T>()/text()/blob()/arrayBuffer(), generic clone(): this
  network-error.ts        → NetworkError with cause (original fetch rejection)
  unknown-http-error.ts   → any status >= 400 not in the map (non-literal status)
  helpers.ts              → ClientErrors/ServerErrors unions, httpErrors array
  <40 status files>       → 4-line classes, see pattern below
```

## Core flow (src/index.ts)

1. `try { res = await fetch(...) } catch` → `NetworkError(message, { cause: err })`. Never rethrows — abort/timeout also become NetworkError; consumers check `error.cause.name` (`AbortError`/`TimeoutError`).
2. `res.status >= 400` → mapped class from `statusCodeErrorMap`, else `UnknownHttpError`.
3. Otherwise success — body NOT parsed; consumer calls `response.json()`. 3xx with `redirect: "manual"` is success.

No internal throw/catch control flow. Keep it that way.

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

Rules: `as const` (oxlint prefer-as-const), instance AND static props, no constructor, no clone() — base class provides both. File kebab-case matching class name.

### Adding a new status code

1. Create `src/errors/<kebab>-error.ts` (pattern above)
2. Export from `src/errors/index.ts`
3. Add to `ClientErrors` or `ServerErrors` union AND `httpErrors` array in `src/errors/helpers.ts`
4. Map it in `src/http-status-codes.ts`
5. Tests in `test.spec.ts`: add to `errorCases` AND `allErrors` arrays; bump the two count assertions (currently 40)

## Verification (run all before commit)

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

- `pnpm typecheck` uses `tsconfig.test.json` — includes `test.spec.ts` so `expectTypeOf` assertions are real. Plain `tsc --noEmit` skips them.
- Tests hit a real local HTTP server (no mocks). Query params drive responses: `?status=`, `?body=`, `?header=Key:Value`.
- 407 can't go through Node's fetch (rejected at network level) — tested via direct construction.

## Gotchas

- `tsconfig.json` needs `"lib": ["ES2022", "DOM"]` — DOM supplies `HeadersInit`; dropping it breaks headers.ts.
- `tsup.config.ts` carries `ignoreDeprecations: "6.0"` in dts compilerOptions — tsup injects deprecated `baseUrl`; remove when tsup fixes it.
- oxfmt formats and sorts `package.json` — don't fight it.
- `statusCodeErrorMap` is `ReadonlyMap` by type; never mutate.
- Verified runtimes: Node 20+, Cloudflare Workers (workerd). Keep runtime code Web-standard only — no Node APIs outside tests.

## Release

1. Bump `version` in package.json, update `CHANGELOG.md`
2. Commit on a branch, ff-merge to main, push
3. `git tag vX.Y.Z && git push origin vX.Y.Z`
4. Tag triggers `.github/workflows/release.yml` → lint/typecheck/test → `npm publish --provenance` (OIDC, no token)

Breaking changes: this is 0.x — minor bump signals breaking, document under "Breaking" in CHANGELOG.
