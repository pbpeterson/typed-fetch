# Changelog

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
