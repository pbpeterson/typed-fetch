---
name: typed-fetch
description: Write HTTP client code with @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper that resolves with errors as values instead of rejecting. Use when a project depends on @pbpeterson/typed-fetch, when calling typedFetch, or when handling its errors (NotFoundError, NetworkError, UnknownHttpError, AbortedError, TimeoutError, isHttpError, isKnownHttpError, isAbortError, isTimeoutError). Also use when the user asks for fetch with Go-style error handling, no-throw HTTP requests, or typed HTTP error classes in TypeScript.
---

# Using typed-fetch

`typedFetch` wraps native `fetch`. It takes the same arguments (URL or `Request`, `RequestInit`).

`typedFetch` resolves with a discriminated union. It does not reject for a
request failure. Body readers are separate native operations, and they do
reject.

## Rules

- Check `error` first. TypeScript then knows `response` is not null, and the reverse.
- `typedFetch` must not be wrapped in `try`/`catch` to handle a request failure. Inspect the `error` value. A body read can use `try`/`catch`.
- The success body is not pre-parsed. Call `response.json()` or `response.text()`.
- `error.message` is diagnostic. Code must not parse it or assert on it. Branch on the error class or on `error.status`.
- Every HTTP error carries a body. Read it or cancel it. See "Error response bodies".
- `typedFetch` runs anywhere native `fetch` exists: Node 20+, browsers, Cloudflare Workers, Deno, and Bun.

## Basic usage

### GET request

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

interface User {
  id: number;
  name: string;
}

const { response, error } = await typedFetch<User[]>("https://api.example.com/users");

if (error) {
  if (isHttpError(error)) {
    console.error(`HTTP ${error.status} ${error.statusText}`);
    // This branch does not read the body, so it cancels the body.
    await error.cancel();
  } else {
    console.error("Request failed:", error.message);
  }
} else {
  const users = await response.json(); // User[]
}
```

### POST request

```typescript
import { typedFetch, isHttpError, BadRequestError } from "@pbpeterson/typed-fetch";

interface User {
  id: number;
  name: string;
}

const { error } = await typedFetch<User>("https://api.example.com/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "John" }),
});

if (error instanceof BadRequestError) {
  const details = await error.json<{ field: string; message: string }>();
  console.error("Validation failed:", details);
} else if (isHttpError(error)) {
  // Every other HTTP status reaches this branch. Cancel its body.
  await error.cancel();
}
```

## Error handling

Each result carries one non-null value. A successful result has `response` and
`error: null`. A failed result has `response: null` and `error`.

### The error union

`typedFetch` resolves with one of these values on failure.

| Value                  | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| A dedicated HTTP error | A known HTTP error: a status of 400 or more that has a dedicated class. |
| `UnknownHttpError`     | An unknown HTTP error: a status of 400 or more with no dedicated class. |
| `NetworkError`         | No HTTP response exists. DNS failure, connection refused, or CORS.      |
| `AbortedError`         | An `AbortSignal` aborted the request, through `controller.abort()`.     |
| `TimeoutError`         | `AbortSignal.timeout(ms)` aborted the request.                          |

Notes on the union:

- A known HTTP error class, such as `NotFoundError`, has a literal-typed `status` and `statusText`. `UnknownHttpError` has a plain `number` status.
- `NetworkError` also covers a permanent request-construction failure, such as an invalid URL or the `CONNECT` method. It also covers a transient failure, such as a DNS failure or a refused connection. No portable test separates the two: `error.cause` is a `TypeError` for every kind of failure, and on Deno there is no `cause` at all. A blind retry loop keyed on `NetworkError` retries the permanent failures forever. Put the retry policy in a layer that knows the request.
- `AbortedError` and `TimeoutError` do not extend `NetworkError`. `isNetworkError()` returns `false` for both. Use the dedicated guards.
- `error.url` is present on every member of the union. It is the empty string when no URL could be resolved. Read it without narrowing.
- Only a status of 400 or more is an HTTP error. `typedFetch` converts the response's `status` to a number before it compares it with 400, and it reads that status once. Status `0` stays on the success branch, so check `response.ok` for an opaque response.

### Type guards

Prefer the guards over `instanceof`. A guard is keyed on a cross-copy brand, so
it holds across package copies. A package copy is one loaded instance of this
package in a process. Two entry points and two module formats can produce
several copies, and `instanceof` holds within one copy only.

| Guard              | Narrows to                    |
| ------------------ | ----------------------------- |
| `isHttpError`      | Any `BaseHttpError` subclass. |
| `isKnownHttpError` | A known HTTP error class.     |
| `isNetworkError`   | `NetworkError`.               |
| `isAbortError`     | `AbortedError`.               |
| `isTimeoutError`   | `TimeoutError`.               |

`isKnownHttpError` excludes `UnknownHttpError` and consumer-defined
`BaseHttpError` subclasses, which still pass `isHttpError`. It also rejects a
dedicated status that a newer package copy introduced, when the receiving copy
does not know that status. `switch (error.status)` after this guard therefore
narrows each case to the exact class.

```typescript
import {
  typedFetch,
  isHttpError,
  isKnownHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "@pbpeterson/typed-fetch";

interface User {
  id: number;
}

const { response, error } = await typedFetch<User>("https://api.example.com/users/1");

if (!error) {
  const user = await response.json();
} else if (isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      // error: NotFoundError
      await error.cancel();
      break;
    case 429: {
      // error: TooManyRequestsError
      const retryAfter = error.headers.get("Retry-After");
      await error.cancel();
      break;
    }
    default:
      // Keep a default branch for forward compatibility and mixed package
      // versions. A later version can move a status to a dedicated class.
      await error.cancel();
      break;
  }
} else if (isHttpError(error)) {
  // An unknown HTTP error, or a consumer-defined subclass.
  await error.cancel();
} else if (isTimeoutError(error)) {
  // AbortSignal.timeout() aborted the request.
} else if (isAbortError(error)) {
  // controller.abort() aborted the request.
} else if (isNetworkError(error)) {
  // No HTTP response exists. error.cause holds the original rejection.
}
```

A static status needs no instance: `NotFoundError.status === 404`.

### Error response bodies

An HTTP error carries the response body. Read it with `error.json<T>()`,
`error.text()`, `error.blob()`, or `error.arrayBuffer()`. Cancel it with
`await error.cancel()`.

WARNING: Read or cancel every HTTP error body. An unread body keeps its stream
open, and the open stream holds the underlying connection until the runtime
collects it. Code that logs `error.message` and drops the error leaks one
connection for each failed request.

CAUTION: `cancel()` does not buffer the payload. The remaining bytes are never
received, so the runtime can close the connection instead of reusing it. If
connection reuse is more important than the transfer cost, read the body with
`error.text()`.

`error.json<T>()` applies a compile-time type only. It performs no runtime
validation. For untrusted data, validate the parsed value. An empty or non-JSON
body makes `json()` reject with a `SyntaxError`, which is common for a 4xx or
5xx response.

To read a body twice, call `error.clone()`.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://api.example.com/users/1");

if (isHttpError(error)) {
  // Call clone() BEFORE the first body read. Release every branch it creates.
  const copy = error.clone();
  const raw = await copy.text();
  const parsed = await error.json<{ message: string }>();
}
```

Rules for `clone()`:

- Call `clone()` before the first body read, cancel, or lock. A later call throws a `TypeError`.
- `clone()` tees the body stream. Both branches must be read or canceled.
- A `cancel()` on one branch stays pending until the other branch is released too. Release both together with `await Promise.all([error.cancel(), copy.cancel()])`.
- A `cancel()` on one branch never cancels the other branch.
- A consumer subclass that holds extra state should pass a recreation callback to `clone()`.
- A recreation callback must return a new error, built from the `Response` it receives. Any other result throws a `TypeError`, and `clone()` releases the orphaned branch first.
- An error from a different package copy is accepted only when that copy can confirm that it took the branch. A package copy older than this one cannot confirm it.

## Common patterns

### Timeout

A timeout resolves with `TimeoutError`, never `NetworkError`. Use a standard
`AbortSignal`. This package adds no timeout API.

```typescript
import { typedFetch, isHttpError, isTimeoutError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://api.example.com/slow", {
  signal: AbortSignal.timeout(5000),
});

if (isTimeoutError(error)) {
  // AbortSignal.timeout() aborted the request.
} else if (isHttpError(error)) {
  await error.cancel();
}
```

### Abort

`controller.abort()` resolves with `AbortedError`. Abort the request before the
promise settles.

```typescript
import { typedFetch, isAbortError, isHttpError } from "@pbpeterson/typed-fetch";

const controller = new AbortController();
const promise = typedFetch("https://api.example.com/users", { signal: controller.signal });
controller.abort();

const { error } = await promise;

if (isAbortError(error)) {
  // error.reason carries the signal's abort reason, when the caller supplied one.
  console.log(error.reason);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

NOTE: The `AbortSignal` is the authority on an abort, not the rejection's
`.name`. An aborted signal alone is not sufficient. A `TypeError` raised during
`Request` construction, while the signal is already aborted, resolves with a
`NetworkError`.

The signal can arrive from either slot: `options.signal`, or a `Request` passed
in the URL position. `signal: null` detaches the `Request`'s signal.

### Custom fetch implementation

Inject an implementation through `options.fetch` for testing, dependency
injection, or a custom agent.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch<{ id: number }>("https://api.example.com/users/1", {
  fetch: async (input, init) => fetch(input, init),
});

if (isHttpError(error)) {
  await error.cancel();
}
```

### Typed wrapper for an API client

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

`api` returns the whole envelope, so it transfers the error to its caller. The
caller then owns the error body and must read it or cancel it.

## Exports

The package root exports `typedFetch`, the five guards, `BaseHttpError`,
`UnknownHttpError`, `NetworkError`, `AbortedError`, `TimeoutError`, and the
dedicated HTTP error classes. The error classes alone are available from
`@pbpeterson/typed-fetch/errors`.

The exported types are `TypedResponse`, `TypedFetchOptions`,
`TypedFetchReturnType`, `HttpMethods`, `ClientErrors`, `ServerErrors`, and
`TypedFetchError`.

NOTE: `TypedFetchOptions["headers"]` gives header-name autocomplete. It
suggests common names, and it validates no name and no value. The type behind
it is not itself a named export.
