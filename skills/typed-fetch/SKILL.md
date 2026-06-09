---
name: typed-fetch
description: Write HTTP client code with @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper that returns errors as values instead of throwing. Use when a project depends on @pbpeterson/typed-fetch, when calling typedFetch, or when handling its errors (NotFoundError, NetworkError, UnknownHttpError, isHttpError). Also use when the user asks for fetch with Go-style error handling, no-throw HTTP requests, or typed HTTP error classes in TypeScript.
---

# Using typed-fetch

`typedFetch` wraps native `fetch` — same arguments (URL/Request, RequestInit) — but never throws. It resolves to a discriminated union:

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User[]>("/api/users");

if (error) {
  // error: ClientErrors | ServerErrors | UnknownHttpError | NetworkError
  console.error(error.message); // "HTTP 404 Not Found"
} else {
  const users = await response.json(); // typed as User[]
}
```

Rules the generated code must follow:

- Check `error` first; TypeScript then knows `response` is non-null (and vice versa).
- The success body is NOT pre-parsed — call `response.json()` / `.text()` yourself.
- Never wrap `typedFetch` in try/catch — it does not throw.
- Runs anywhere native fetch exists: Node 20+, browsers, Cloudflare Workers, Deno, Bun.

## Handling specific errors

Every HTTP status 400–511 has a class with literal-typed `status`/`statusText`. Unmapped codes (420, 599, Cloudflare 5xx variants…) become `UnknownHttpError`. Pre-response failures (DNS, refused, abort, timeout) become `NetworkError`.

```typescript
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  NotFoundError,
  TooManyRequestsError,
} from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/1");

if (error instanceof NotFoundError) {
  // error.status is the literal 404
} else if (error instanceof TooManyRequestsError) {
  const retryAfter = error.headers.get("Retry-After");
} else if (isHttpError(error)) {
  // any other HTTP error: read the body
  const details = await error.json<{ message: string }>();
} else if (isNetworkError(error)) {
  // error.cause holds the original fetch rejection
  const aborted = (error.cause as Error)?.name === "AbortError";
}
```

- Error bodies: `error.json<T>()`, `.text()`, `.blob()`, `.arrayBuffer()`; `error.clone()` to read twice.
- Prefer `isHttpError`/`isNetworkError` guards over `instanceof` across package boundaries.
- Statics need no instance: `NotFoundError.status === 404`.

## Common patterns

Timeout — standard AbortSignal, no custom API:

```typescript
const { response, error } = await typedFetch("/api/slow", {
  signal: AbortSignal.timeout(5000), // NetworkError; cause.name === "TimeoutError"
});
```

Narrow expected client errors via the second generic (5xx/UnknownHttpError/NetworkError always remain):

```typescript
const { error } = await typedFetch<User, NotFoundError | BadRequestError>("/api/users/1");
```

Typed wrapper for an API client:

```typescript
import type { TypedFetchOptions, TypedFetchReturnType } from "@pbpeterson/typed-fetch";

function api<T>(path: string, options?: TypedFetchOptions): Promise<TypedFetchReturnType<T>> {
  return typedFetch<T>(`${BASE_URL}${path}`, options);
}
```

Other exports: `TypedResponse`, `TypedHeaders`/`StrictHeaders` (header IntelliSense), `HttpMethods`, `ClientErrors`/`ServerErrors`/`TypedFetchError`, `statusCodeErrorMap` (ReadonlyMap), `httpErrors` array. Error classes alone: `@pbpeterson/typed-fetch/errors`.
