---
name: typed-fetch
description: Write HTTP client code with @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper that returns errors as values instead of throwing. Use when a project depends on @pbpeterson/typed-fetch, when calling typedFetch, or when handling its errors (NotFoundError, NetworkError, UnknownHttpError, AbortedError, TimeoutError, isHttpError, isKnownHttpError, isAbortError, isTimeoutError). Also use when the user asks for fetch with Go-style error handling, no-throw HTTP requests, or typed HTTP error classes in TypeScript.
---

# Using typed-fetch

`typedFetch` wraps native `fetch` — same arguments (URL/Request, RequestInit) — and resolves request failures to a discriminated union instead of rejecting. Body readers remain native operations and can still reject:

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";

interface User {
  id: number;
  name: string;
}

const { response, error } = await typedFetch<User[]>("/api/users");

if (error) {
  // error: ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError
  console.error(error.message); // e.g. "HTTP 404 Not Found (https://api.example.com/users)"
} else {
  const users = await response.json(); // typed as User[]
}
```

Rules the generated code must follow:

- Check `error` first; TypeScript then knows `response` is non-null (and vice versa).
- The success body is NOT pre-parsed — call `response.json()` / `.text()` yourself.
- Do not wrap the `typedFetch` request itself in try/catch for network or HTTP failures; inspect its `error` value. Body reads such as `response.json()` are separate operations and can still throw.
- `error.message` is for humans and may include the request URL when known; never parse or assert on it. Branch on the error class or `error.status`.
- Runs anywhere native fetch exists: Node 20+, browsers, Cloudflare Workers, Deno, Bun.

## The error union

`typedFetch` only ever returns one of these on failure:

- **A dedicated HTTP error** (e.g. `NotFoundError`, `TooManyRequestsError`) for a mapped 4xx/5xx status. Each has a literal-typed `status`/`statusText`.
- **`UnknownHttpError`** for any status ≥ 400 with no dedicated class (420, 599, Cloudflare 5xx variants…). Its `status` is a plain `number`.
- **`NetworkError`** — the request never got an HTTP response (DNS failure, connection refused, CORS, etc.). `error.cause` holds the original rejection.
- **`AbortedError`** — the request was cancelled via an `AbortSignal` (`controller.abort()`).
- **`TimeoutError`** — the request was aborted by a timeout signal (`AbortSignal.timeout(ms)`).

`AbortedError` and `TimeoutError` do NOT extend `NetworkError`: `isNetworkError()` returns `false` for both. Use the dedicated guards below.

## Handling specific errors

```typescript
import {
  typedFetch,
  isHttpError,
  isKnownHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
  NotFoundError,
  TooManyRequestsError,
} from "@pbpeterson/typed-fetch";

interface User {
  id: number;
}

const { response, error } = await typedFetch<User>("/api/users/1");

if (!error) {
  // success — response is available and typed
  const user = await response.json();
} else if (error instanceof NotFoundError) {
  // error.status is the literal 404
} else if (error instanceof TooManyRequestsError) {
  const retryAfter = error.headers.get("Retry-After");
} else if (isHttpError(error)) {
  // any other HTTP error (dedicated or UnknownHttpError): read the body
  const details = await error.json<{ message: string }>();
} else if (isTimeoutError(error)) {
  // request exceeded its AbortSignal.timeout()
} else if (isAbortError(error)) {
  // request was cancelled via controller.abort()
} else if (isNetworkError(error)) {
  // no HTTP response at all; error.cause holds the original rejection
}
```

- Guards, not message strings: prefer `isHttpError`/`isKnownHttpError`/`isNetworkError`/`isAbortError`/`isTimeoutError` over `instanceof` across package boundaries.
- `error.url` is the failed request URL on **every** error family — HTTP errors take it from `response.url`; `NetworkError`/`AbortedError`/`TimeoutError` carry the requested URL (empty string when unavailable). Read it unconditionally, no narrowing needed.
- Error bodies (HTTP errors only): `error.json<T>()`, `.text()`, `.blob()`, `.arrayBuffer()`; `error.clone()` to read the body twice — call `.clone()` before the first body read.
- Statics need no instance: `NotFoundError.status === 404`.

### Exhaustive status switch

`isKnownHttpError` narrows to one of the library's dedicated classes. It excludes
both `UnknownHttpError` and consumer-defined `BaseHttpError` subclasses (which
still pass `isHttpError`). It also rejects a dedicated status introduced by a
newer package copy when the receiving copy does not know that status, so
`switch (error.status)` safely narrows each case to the exact class:

```typescript
import { typedFetch, isKnownHttpError, NotFoundError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch<{ id: number }>("/api/users/1");

if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      // error: NotFoundError
      break;
    default:
      // keep a default: a new dedicated class can appear in a minor release
      break;
  }
}
```

## Common patterns

Timeout — standard `AbortSignal`, no custom API. A timeout surfaces as `TimeoutError`, not `NetworkError`:

```typescript
import { typedFetch, isTimeoutError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch("/api/slow", {
  signal: AbortSignal.timeout(5000),
});

if (isTimeoutError(error)) {
  // handle the timeout
}
```

Cancellation — `controller.abort()` surfaces as `AbortedError`:

```typescript
import { typedFetch, isAbortError } from "@pbpeterson/typed-fetch";

const controller = new AbortController();
const promise = typedFetch("/api/users", { signal: controller.signal });
controller.abort();

const { error } = await promise;
if (isAbortError(error)) {
  // error.reason carries the signal's abort reason, when one was supplied
  console.log(error.reason);
}
```

Custom fetch — inject your own implementation (testing, DI, custom agents) via `options.fetch`:

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch<{ id: number }>("/api/users/1", {
  fetch: async (input, init) => fetch(input, init),
});
void error;
```

Typed wrapper for an API client:

```typescript
import {
  typedFetch,
  type TypedFetchOptions,
  type TypedFetchReturnType,
} from "@pbpeterson/typed-fetch";

const BASE_URL = "https://api.example.com";

function api<T>(path: string, options?: TypedFetchOptions): Promise<TypedFetchReturnType<T>> {
  return typedFetch<T>(`${BASE_URL}${path}`, options);
}
```

Other exports: `TypedResponse`, `HttpMethods`, `ClientErrors`/`ServerErrors`/`TypedFetchError`, `BaseHttpError`. Error classes alone: `@pbpeterson/typed-fetch/errors`. Note: `TypedFetchOptions["headers"]` gives header-name autocomplete (it suggests common names but does NOT validate values); the type is not itself a named export.
