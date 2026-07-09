# Changelog

## [Unreleased]

### Breaking

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

### Added

- `isKnownHttpError(error): error is ClientErrors | ServerErrors` — a type
  guard for a _known_, dedicated HTTP error class (excludes
  `UnknownHttpError`). Narrowing on `error.status` after this guard is
  exhaustive over the mapped status codes, which makes `switch (error.status)`
  actually useful (previously `UnknownHttpError.status: number` absorbed
  every case).
- `isAbortError(error): error is AbortedError` and
  `isTimeoutError(error): error is TimeoutError` guards, alongside the new
  `AbortedError` and `TimeoutError` classes.
- `error.url` on all HTTP error classes — the URL of the failed request
  (from `response.url`), so concurrent requests produce distinguishable
  errors in logs.
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
