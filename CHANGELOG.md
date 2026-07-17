# Changelog

## [Unreleased]

### Fixed

- **`isKnownHttpError` no longer misclassifies consumer-defined
  `BaseHttpError` subclasses as one of the library's dedicated status
  classes.** Dedicated errors now carry a separate cross-copy brand, keeping
  the guard's `ClientErrors | ServerErrors` type predicate sound while
  preserving ESM/CJS and cross-entry behavior.
- **`BaseHttpError` no longer leaks its internal `Response` as an own enumerable
  property.** It was a constructor parameter property, so `JSON.stringify(err)`,
  `{...err}`, and `Object.keys(err)` exposed a live `Response` handle. It is now
  a native private field.
- **`NetworkError` / `AbortedError` / `TimeoutError`: `"cause" in err` (and
  `"reason" in err`) are honest again.** Under ES2022 class-field semantics the
  field declarations defined an own `cause: undefined` on every instance, so
  `"cause" in err` was always `true`. The property now exists only when a cause
  is actually supplied.
- **Error body readers (`json()`/`text()`/`blob()`/`arrayBuffer()`) throw a
  clear `TypeError` on a second read**, matching `clone()`, instead of the
  platform's opaque `Body is unusable`. (An empty/non-JSON body still rejects
  with `SyntaxError` — use `text()` when unsure.)
- **`clone()` also guards a locked (reader-held) body**, not only a consumed one.
- **Abort/timeout classification tightened for polyfilled signals**: a
  reason-less aborted signal only takes the abort path when the rejection is a
  DOMException named `AbortError` or `TimeoutError` (not any DOMException), and a
  polyfilled timeout signal now yields `TimeoutError` rather than `AbortedError`.

### Documentation

- Corrected the status-0 body guidance: filtered responses remain on the
  success branch, but `Response.error().text()` resolves to an empty string
  while `.json()` rejects for that empty body.
- Public JSDoc examples are now compiled by `pnpm check-docs`, alongside the
  Markdown and agent-skill examples.
- Documented the complete 1.x semantic-versioning contract and corrected the
  4xx/5xx error-class counts.
- Clarified that `NetworkError` also covers permanent, non-retryable
  request-construction `TypeError`s (invalid URL, forbidden method) — warn
  against blind retry loops.
- Clarified that status-0 / `type: "error"` / opaque responses return on the
  success branch; consumers must check `response.ok` / `response.type`.

## [1.0.0] - 2026-07-09

### Breaking

- **The type guards (`isHttpError`, `isKnownHttpError`, `isNetworkError`,
  `isAbortError`, `isTimeoutError`) now identify errors by a cross-realm brand
  (`Symbol.for`) instead of `instanceof`.** This fixes them across multiple
  copies of the package's classes in one process — the dual-package hazard
  (`require()` ↔ `import()`) and cross-entry-point duplication (`.` vs
  `./errors`), where a raw `instanceof` returned `false` for a value that
  genuinely was one. The guards' _behavior_ is unchanged for the common
  single-copy case; the break is that a value which forges the brand symbol now
  passes a guard (a guard answers "did this library make this?", not "is this
  trusted?"), and that guards no longer depend on prototype identity. If you
  relied on the guards returning `false` for a same-shape object that lacked
  the brand, that still holds.
- **Removed the second `ErrorType` type parameter from `typedFetch<T, E>`.**
  It was enforced by an unchecked cast at the error-construction site: asking
  for `typedFetch<User, NotFoundError>(...)` and receiving a 403 still gave
  you a `ForbiddenError` at runtime, just typed as `NotFoundError` — the type
  system was lying. `typedFetch` now has a single type parameter (the
  response body type); `error` is always the full `TypedFetchError` union.
  See [Migrating from 0.x](#migrating-from-0x) below.
- **Aborts and timeouts now return `AbortedError` / `TimeoutError` instead of
  `NetworkError`.** Both are new classes that extend `Error` directly (not
  `NetworkError`), so **`isNetworkError()` no longer returns `true` for
  cancelled or timed-out requests.** Cancellation and timeouts are not
  network failures, and collapsing all three into `NetworkError` forced an
  untyped `error.cause` cast to tell them apart. See
  [Migrating from 0.x](#migrating-from-0x) below.
- **Abort/timeout detection now keys on the request's `AbortSignal`
  (`signal.aborted`), not on the rejected error's `.name`.** The previous
  implementation matched `err.name === "AbortError"` / `"TimeoutError"`, which
  (a) missed the mainstream `controller.abort(reason)` pattern — passing a
  reason makes `fetch` reject with _that_ value, whose `.name` is usually not
  `"AbortError"`, so it was misclassified as a `NetworkError` — and (b) could
  false-positive on any unrelated rejection that merely happened to be named
  `"AbortError"`. The signal is now the sole authority: a request is treated
  as aborted only when its own signal reports `aborted`.
- **`statusCodeErrorMap` and `httpErrors` are no longer public exports.** They
  were internal registries (the status-code → error-class map and the array of
  all 40 error classes) with no demonstrated consumer use case, and every
  public export is a semver liability. They remain available internally but are
  no longer part of the published API surface.
- **The `HttpErrors` type is no longer a public export.** It was the union of
  error class _constructors_ derived from the (now-private) `httpErrors` array —
  the same internal registry privatized above, so the same reasoning applies: no
  demonstrated consumer use case, and every public export is a semver liability.
  For the type of an error _instance_, use `ClientErrors | ServerErrors`. It
  remains available internally but is no longer part of the published API surface.
- **`TypedHeaders` and `StrictHeaders` are no longer public exports.** They were
  autocomplete-only types — they suggest common header names but validate no
  values — and every named export is a semver liability. The **behavior is
  unchanged**: they still shape `TypedFetchOptions["headers"]`, so writing
  `typedFetch(url, { headers: { "Content-Type": "..." } })` still gives header-name
  IntelliSense (the suggestions are structural and need no import). Only the
  named exports are gone; if you imported either type by name, inline the shape
  or use `TypedFetchOptions["headers"]` instead.

### Added

- `dist/`-level cross-copy / cross-format regression tests that exercise the
  _built_ artifacts (both entry points, both ESM and CJS), so a regression to
  `instanceof`-based guards is caught — the previous suite only imported
  `src/`, which masked the bug.
- `isKnownHttpError(error): error is ClientErrors | ServerErrors` — a type
  guard for a _known_, dedicated HTTP error class (excludes
  `UnknownHttpError`). Narrowing on `error.status` after this guard is
  exhaustive over the mapped status codes, which makes `switch (error.status)`
  actually useful (previously `UnknownHttpError.status: number` absorbed
  every case).
- `isAbortError(error): error is AbortedError` and
  `isTimeoutError(error): error is TimeoutError` guards, alongside the new
  `AbortedError` and `TimeoutError` classes.
- `AbortedError.reason` (`unknown`) — the `AbortSignal`'s cancellation reason,
  i.e. whatever the caller passed to `controller.abort(reason)`. Typed
  `unknown` so the consumer narrows it. When `abort()` is called with no
  argument, the platform supplies a `DOMException` named `"AbortError"`.
- `error.url` (`string`) on **every** error class — the URL of the failed
  request, so concurrent requests produce distinguishable errors in logs.
  It was already on HTTP errors (from `response.url`); it is now also on
  `NetworkError`, `AbortedError`, and `TimeoutError` — the pre-response
  failures that dominate flaky-network logs, where a bare
  `NetworkError: fetch failed` previously gave nothing to correlate. For a
  `Request` input the resolved `request.url` is used; for a `URL` its `href`;
  for a `string` the string itself. Because all six families now carry
  `readonly url: string`, code written against the full `TypedFetchError`
  union can read `error.url` unconditionally, with no narrowing.
- `options.fetch` — override the underlying `fetch` implementation
  (testing, DI, custom agents, polyfills) without patching `globalThis`.

### Changed

- `error.message` on HTTP errors now includes the request URL when
  available, e.g. `"HTTP 404 Not Found (https://api.example.com/users/123)"`.
  **Message text is not part of the semver contract** — assert on
  `.status` / `.name`, not `.message` (see `RELEASING.md`).
- Every error class's `name` (e.g. `NotFoundError`, `NetworkError`) is now a
  hardcoded string literal instead of being derived from
  `this.constructor.name`, so it survives consumer minification
  (`.name` used to collapse to a mangled identifier like `"a"` under
  production minifiers).

### Fixed

- **Timeout classification now requires a `DOMException`, not a forgeable
  `reason.name`.** Detection previously matched a `reason` that was any `Error`
  whose `.name` was `"TimeoutError"`, so a caller doing
  `controller.abort(Object.assign(new Error("cancelled"), { name: "TimeoutError" }))`
  was misclassified as a `TimeoutError` — and, worse, the caller's meaningful
  reason was demoted to `cause` and lost from `error.reason`. This is the
  mirror of the `err.name === "AbortError"` bug already fixed above, on the
  `reason.name` axis. Classification now requires the exact shape
  `AbortSignal.timeout()` produces — a `DOMException` named `"TimeoutError"`
  (guarded by `typeof DOMException !== "undefined"` for polyfilled runtimes) —
  which a plain `Error` cannot forge. The `name` check stays load-bearing (a
  bare `controller.abort()` also produces a `DOMException`, named
  `"AbortError"`). A caller who hand-builds a `DOMException` named
  `"TimeoutError"` is still treated as a timeout — that shape is
  indistinguishable from a real one, by design.
- **`instanceof` across the package's own entry points.** The build previously
  shipped `splitting: false`, so the `.` and `./errors` entry points each
  bundled their _own_ copy of every error class. A `NotFoundError` created by
  `typedFetch` (from `.`) was therefore not `instanceof` the `NotFoundError`
  imported from `./errors` — the exact pattern the README teaches. Enabling
  code-splitting makes both entry points share one copy of each class per
  module format, so raw `instanceof` now works across entry points within a
  single ESM (or single CJS) graph. Across the ESM/CJS boundary, use the
  brand-based type guards — no bundler can merge those two module graphs.
- The guards now work regardless of which copy or module format created the
  error (see Breaking above). Bundle size drops ~9% as a side effect of
  splitting removing the duplicated classes.
- **An `AbortSignal` carried by a `Request` in the url slot is now honored.**
  `typedFetch(new Request(url, { signal }))` — the canonical fetch pattern used
  by service workers, middleware, and request factories — put the signal on the
  first argument, where it is a prototype getter (`url.signal`), not on `init`.
  The catch block keyed abort/timeout classification solely off `init.signal`,
  so every cancellation on this path misclassified as a `NetworkError` instead
  of `AbortedError`/`TimeoutError`. The governing signal is now resolved from
  either slot. Precedence matches native `fetch(request, init)`: an
  options-slot `signal` overrides the `Request`'s own signal entirely.
- **A `Request` object passed in the `options` slot is no longer corrupted.**
  A `Request` is a host exotic object: its `method`, `headers`, `body`, and
  `signal` are prototype getters, not own enumerable properties. The
  `options.fetch` change (b00380e) introduced an object rest spread
  (`const { fetch, ...init } = options`) that copied none of them, silently
  downgrading `typedFetch(url, new Request(url, { method: "POST", ... }))` to a
  bodyless, header-less `GET` and dropping the abort signal (so a pre-aborted
  or timed-out `Request` produced no error at all). A `Request` is now passed
  through to `fetch()` untouched; the spread only applies on the plain-object
  options path.
- The README no longer documents an "Error Response Bodies" pattern that
  reads the body with `error.json()` and then calls `error.clone()` — that
  order throws `TypeError: Response.clone: Body has already been consumed`.
  The example now clones before the first read.
- `statusText` is now documented (README and JSDoc) as the canonical IANA
  reason phrase for the status code, not necessarily what the server sent on
  the wire — the two could already disagree (`error.message` uses the real
  `response.statusText`; `error.statusText` is a hardcoded literal per
  class), and the docs previously implied they were the same value.

### Migrating from 0.x

Two breaking changes to handle:

**1. The second `ErrorType` type parameter is gone.**

```typescript
// Before (0.x)
const { response, error } = await typedFetch<User, NotFoundError>("/api/users/123");
if (error) {
  // error was typed as NotFoundError | ServerErrors | UnknownHttpError | NetworkError,
  // but a 403 response would still construct a ForbiddenError at runtime —
  // the second type argument was never checked against what actually came back.
}

// After
import { isKnownHttpError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/123");
if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      console.log("User not found"); // error: NotFoundError
      break;
    case 403:
      console.log("Forbidden"); // error: ForbiddenError
      break;
    default:
      // Keep a default: adding a new error class to the library is a minor
      // version bump, so new cases can appear here without a major release.
      console.log(`HTTP ${error.status}`);
  }
}
```

Prefer `instanceof` if you only care about one class:

```typescript
import { NotFoundError } from "@pbpeterson/typed-fetch";

if (error instanceof NotFoundError) {
  console.log("User not found");
}
```

**2. Aborts and timeouts are no longer `NetworkError`.**

```typescript
// Before (0.x)
const { response, error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});
if (isNetworkError(error)) {
  if ((error.cause as Error)?.name === "AbortError") {
    console.log("Request was cancelled");
  } else {
    console.log("Network error:", error.message);
  }
}

// After
import { isNetworkError, isAbortError, isTimeoutError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});
if (isAbortError(error)) {
  console.log("Request was cancelled");
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
} else if (isNetworkError(error)) {
  console.log("Network error:", error.message);
}
```

If you only checked `error instanceof NetworkError` (or `isNetworkError`) to
catch _any_ pre-response failure, add the two new branches above it —
`isNetworkError` on its own will silently stop matching aborted and
timed-out requests.

## 0.8.0 (2026-06-09)

### Breaking

- Responses with unmapped status codes >= 400 (e.g. 420, 599) now return an
  `UnknownHttpError` instead of being passed through as a successful response.
- Requires Node.js >= 20 (Node 18 is end-of-life).
- `HttpMethods` no longer includes `CONNECT` and `TRACE` — the Fetch spec
  forbids them and `fetch` throws a `TypeError` if they are used.

### Added

- `UnknownHttpError` — covers any status >= 400 without a dedicated class.
  Its `status`/`statusText` reflect what the server actually sent.
- `NetworkError.cause` — the original error thrown by `fetch` (e.g. the
  `TypeError` with an `ECONNREFUSED` cause chain, or an `AbortError`) is
  preserved instead of discarded.
- HTTP errors now have a useful `message` (e.g. `"HTTP 404 Not Found"`);
  previously it was empty.
- `TypedResponse.clone()` keeps the typed `json()` method.
- The main entry now exports the `TypedResponse`, `TypedFetchReturnType`,
  `TypedFetchOptions`, `TypedHeaders`, `StrictHeaders`, and `HttpMethods`
  types for building typed wrappers around `typedFetch`.
- `method` option accepts any string (fetch parity) while keeping
  IntelliSense for standard verbs.

### Changed

- `statusCodeErrorMap` is now typed as `ReadonlyMap`.
- Compile target raised to ES2022 (Node 18+ baseline).
- Removed the `is-network-error` dependency — the package now has zero
  runtime dependencies.

### Fixed

- 3xx responses with `redirect: "manual"` are returned as successful
  responses instead of being misclassified.
- `TypedFetchError` no longer mixes constructor and instance types.

## 0.7.2 and earlier

See the [commit history](https://github.com/pbpeterson/typed-fetch/commits/main).
