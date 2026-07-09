# @pbpeterson/typed-fetch

[![CI](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40pbpeterson%2Ftyped-fetch)](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
[![license](https://img.shields.io/npm/l/%40pbpeterson%2Ftyped-fetch)](./LICENSE)

A type-safe HTTP client for TypeScript that never throws. Inspired by Go's error handling pattern, built on top of the native Fetch API.

## Why typed-fetch?

Traditional fetch libraries throw exceptions on HTTP errors, making error handling cumbersome and error-prone. **typed-fetch** follows Go's philosophy of explicit error handling - errors are values, not exceptions.

```typescript
// ❌ Traditional approach - can throw unexpectedly
try {
  const response = await fetch("/api/users");
  const users = await response.json(); // What if response is 404?
} catch (error) {
  // Handle network errors, parsing errors, HTTP errors... all mixed together
}

// ✅ typed-fetch approach - explicit and type-safe
const { response, error } = await typedFetch<User[]>("/api/users");
if (error) {
  // Handle error with full type information
  console.log(`HTTP ${error.status}: ${error.statusText}`);
  const errorDetails = await error.json(); // Access error response body
} else {
  // TypeScript knows response is not null
  const users = await response.json(); // Type: User[]
}
```

### What never-throws means

`typedFetch` never throws for network failures or HTTP status codes — those come back as `error`. Reading a body (`response.json()`, `error.json()`, `.text()`, …) can still throw, exactly like native fetch: malformed JSON throws `SyntaxError`, and reading an already-consumed body throws. Wrap body reads in try/catch (or `.clone()` first) when the payload is untrusted.

Opaque responses (`mode: "no-cors"`, `status: 0`) come back as `response`, per the fetch spec; their body is unreadable and `json()`/`text()` will reject.

## Features

- **Never throws** - All errors are returned as values
- **Fully typed** - Complete TypeScript support with literal status types
- **Built on Fetch** - Thin wrapper around the native Fetch API, same signature
- **40 HTTP error classes** - Covering all standard HTTP status codes (400-511)
- **No status code left behind** - Non-standard error codes (e.g. 420, 599) become `UnknownHttpError`
- **Network error handling** - Separate `NetworkError`, `AbortedError`, and `TimeoutError` classes for connection issues, cancellation, and timeouts, with the original error preserved on `cause`
- **Type guards** - `isHttpError()`, `isNetworkError()`, `isAbortError()`, and `isTimeoutError()` for runtime checks
- **Generic error bodies** - `error.json<T>()` for typed error response parsing
- **Zero dependencies**

## Installation

```bash
npm install @pbpeterson/typed-fetch
```

Requires Node.js >= 20 (or any runtime with the native Fetch API: browsers, Deno, Bun, edge runtimes).

### Agent Skill

Using Claude Code or another agent? Install the typed-fetch skill so your agent knows the API and error-handling patterns:

```bash
npx skills add pbpeterson/typed-fetch --skill typed-fetch
```

## Basic Usage

### Simple GET Request

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";

interface User {
  id: number;
  name: string;
  email: string;
}

const { response, error } = await typedFetch<User[]>("/api/users");

if (error) {
  console.error("Failed to fetch users:", error.statusText);
} else {
  const users = await response.json(); // Type: User[]
}
```

### POST Request with Body

```typescript
import { typedFetch, BadRequestError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "John", email: "john@example.com" }),
});

if (error) {
  if (error instanceof BadRequestError) {
    const details = await error.json<{ field: string; message: string }>();
    console.error("Validation failed:", details);
  }
}
```

## Error Handling

### HTTP Status Errors

```typescript
import {
  typedFetch,
  NotFoundError,
  UnauthorizedError,
  NetworkError,
  AbortedError,
  TimeoutError,
} from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/123");

if (error) {
  if (error instanceof NotFoundError) {
    console.log("User not found");
  } else if (error instanceof UnauthorizedError) {
    console.log("Please log in");
  } else if (error instanceof NetworkError) {
    console.log("Network error:", error.message);
  } else if (error instanceof AbortedError) {
    console.log("Request was cancelled");
  } else if (error instanceof TimeoutError) {
    console.log("Request timed out");
  }
}
```

### Unknown Status Codes

Status codes >= 400 without a dedicated class (non-standard or vendor-specific, e.g. 420 or 599) are returned as `UnknownHttpError`, so no error response ever slips through as a success:

```typescript
import { typedFetch, UnknownHttpError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch("/api/legacy");

if (error instanceof UnknownHttpError) {
  console.log(error.status); // whatever the server sent, e.g. 599
  const body = await error.text();
}
```

### Network Errors, Aborts, and Timeouts

`typedFetch` distinguishes three different ways a request can fail before it gets an HTTP
response, each with its own error class and type guard:

| Class          | Cause                                                      | Guard              |
| -------------- | ---------------------------------------------------------- | ------------------ |
| `NetworkError` | DNS failure, connection refused, `redirect: "error"`, etc. | `isNetworkError()` |
| `AbortedError` | The request was cancelled via `AbortController.abort()`    | `isAbortError()`   |
| `TimeoutError` | The request exceeded a timeout (`AbortSignal.timeout()`)   | `isTimeoutError()` |

All three preserve the original error thrown by `fetch` on `cause`. **`AbortedError` and
`TimeoutError` do NOT extend `NetworkError`** — `isNetworkError()` returns `false` for
aborted or timed-out requests. This is intentional: cancellation and timeouts are not
network failures, and conflating them made the taxonomy lie. Use `isAbortError()` /
`isTimeoutError()` to check for them explicitly.

```typescript
import { typedFetch, isNetworkError, isAbortError, isTimeoutError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch("https://unreachable.example");

if (isNetworkError(error)) {
  console.log("Connection failed:", error.message);
  console.log(error.cause); // the original TypeError, etc.
} else if (isAbortError(error)) {
  console.log("Request was cancelled");
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
}
```

### Timeouts

No custom timeout API needed — use the standard `AbortSignal.timeout()`, exactly like with native fetch. It now produces a typed `TimeoutError`, not a generic `NetworkError`:

```typescript
import { typedFetch, isTimeoutError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});

if (isTimeoutError(error)) {
  console.log("Request timed out after 5s");
}
```

### Type Guards

Use `isHttpError()`, `isNetworkError()`, `isAbortError()`, and `isTimeoutError()` instead of `instanceof` for reliable checks across package boundaries:

```typescript
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/123");

if (error) {
  if (isHttpError(error)) {
    console.log(`HTTP ${error.status}: ${error.statusText}`);
  } else if (isNetworkError(error)) {
    console.log("Connection failed:", error.message);
  } else if (isAbortError(error)) {
    console.log("Request was cancelled");
  } else if (isTimeoutError(error)) {
    console.log("Request timed out");
  }
}
```

> **Note:** `isNetworkError()` does NOT match `AbortedError` or `TimeoutError` — they are
> separate classes, not `NetworkError` subclasses. Check for them with their own guards.

### Exhaustive Status Narrowing with `isKnownHttpError`

`isHttpError()` narrows to `BaseHttpError`, but `switch (error.status)` on that type
still includes `UnknownHttpError` in every `case` (its `status` is typed `number`, so
it matches everything). Use `isKnownHttpError()` instead when you want `error.status`
to narrow to exactly one dedicated error class per case:

```typescript
import { typedFetch, isKnownHttpError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/123");

if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      console.log("User not found"); // error: NotFoundError
      break;
    case 401:
      console.log("Please log in"); // error: UnauthorizedError
      break;
    default:
      // Keep a `default` even though this switch looks exhaustive: adding a new
      // error class to the library is a minor version bump (see semver policy),
      // so new cases can appear without a major release.
      console.log(`HTTP ${error.status}`);
  }
}
```

### Typed Error Response Bodies

The `json()` method accepts a generic type parameter:

```typescript
interface ApiError {
  message: string;
  code: string;
  fields?: Record<string, string>;
}

if (error instanceof BadRequestError) {
  const details = await error.json<ApiError>();
  console.log(details.message); // fully typed
}
```

### Narrowing to Specific Errors

`typedFetch` has a single type parameter — the response body type. `error` is always
the full {@link TypedFetchError} union (every class the request could actually produce
at runtime). There is no second type parameter to "expect" a narrower set of errors:
that would only be a type-level assertion with no runtime check behind it, so a 403
response could be reported as a `NotFoundError` if you asked for one.

Narrow the real, sound way — `isKnownHttpError()` + `switch (error.status)`
(see above), or `instanceof` for one specific class:

```typescript
import { typedFetch, NotFoundError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/123");

if (error instanceof NotFoundError) {
  console.log("User not found");
}
```

### Error Response Bodies

All HTTP error classes provide access to the response body:

```typescript
if (error && isHttpError(error)) {
  // Clone BEFORE reading if you need the body more than once.
  const forJson = error.clone();
  const json = await error.json();
  const text = await forJson.text();

  const retryAfter = error.headers.get("Retry-After");
  error.status; // 404 (literal, not number)
  error.statusText; // "Not Found" (literal, not string)
}
```

### Static Properties

Access status codes without creating instances:

```typescript
import { NotFoundError, BadRequestError } from "@pbpeterson/typed-fetch";

console.log(NotFoundError.status); // 404
console.log(NotFoundError.statusText); // "Not Found"
console.log(BadRequestError.status); // 400
console.log(BadRequestError.statusText); // "Bad Request"
```

## Available Error Classes

### 4xx Client Errors

| Class                               | Status | Status Text                     |
| ----------------------------------- | ------ | ------------------------------- |
| `BadRequestError`                   | 400    | Bad Request                     |
| `UnauthorizedError`                 | 401    | Unauthorized                    |
| `PaymentRequiredError`              | 402    | Payment Required                |
| `ForbiddenError`                    | 403    | Forbidden                       |
| `NotFoundError`                     | 404    | Not Found                       |
| `MethodNotAllowedError`             | 405    | Method Not Allowed              |
| `NotAcceptableError`                | 406    | Not Acceptable                  |
| `ProxyAuthenticationRequiredError`  | 407    | Proxy Authentication Required   |
| `RequestTimeoutError`               | 408    | Request Timeout                 |
| `ConflictError`                     | 409    | Conflict                        |
| `GoneError`                         | 410    | Gone                            |
| `LengthRequiredError`               | 411    | Length Required                 |
| `PreconditionFailedError`           | 412    | Precondition Failed             |
| `RequestTooLongError`               | 413    | Payload Too Large               |
| `RequestUriTooLongError`            | 414    | URI Too Long                    |
| `UnsupportedMediaTypeError`         | 415    | Unsupported Media Type          |
| `RequestedRangeNotSatisfiableError` | 416    | Range Not Satisfiable           |
| `ExpectationFailedError`            | 417    | Expectation Failed              |
| `ImATeapotError`                    | 418    | I'm a teapot                    |
| `MisdirectedRequestError`           | 421    | Misdirected Request             |
| `UnprocessableEntityError`          | 422    | Unprocessable Entity            |
| `LockedError`                       | 423    | Locked                          |
| `FailedDependencyError`             | 424    | Failed Dependency               |
| `TooEarlyError`                     | 425    | Too Early                       |
| `UpgradeRequiredError`              | 426    | Upgrade Required                |
| `PreconditionRequiredError`         | 428    | Precondition Required           |
| `TooManyRequestsError`              | 429    | Too Many Requests               |
| `RequestHeaderFieldsTooLargeError`  | 431    | Request Header Fields Too Large |
| `UnavailableForLegalReasonsError`   | 451    | Unavailable For Legal Reasons   |

### 5xx Server Errors

| Class                                | Status | Status Text                     |
| ------------------------------------ | ------ | ------------------------------- |
| `InternalServerError`                | 500    | Internal Server Error           |
| `NotImplementedError`                | 501    | Not Implemented                 |
| `BadGatewayError`                    | 502    | Bad Gateway                     |
| `ServiceUnavailableError`            | 503    | Service Unavailable             |
| `GatewayTimeoutError`                | 504    | Gateway Timeout                 |
| `HttpVersionNotSupportedError`       | 505    | HTTP Version Not Supported      |
| `VariantAlsoNegotiatesError`         | 506    | Variant Also Negotiates         |
| `InsufficientStorageError`           | 507    | Insufficient Storage            |
| `LoopDetectedError`                  | 508    | Loop Detected                   |
| `NotExtendedError`                   | 510    | Not Extended                    |
| `NetworkAuthenticationRequiredError` | 511    | Network Authentication Required |

### Other

| Class              | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `UnknownHttpError` | Any status code >= 400 without a dedicated class (e.g. 420, 599)  |
| `NetworkError`     | Connection issues, DNS failures, and other network-level failures |
| `AbortedError`     | Request was cancelled via `AbortController.abort()`               |
| `TimeoutError`     | Request exceeded a timeout (e.g. `AbortSignal.timeout()`)         |
| `BaseHttpError`    | Abstract base class for all HTTP errors                           |

## API Reference

### `typedFetch<T>(url, options?)`

**Type Parameters:**

- `T` - The expected response body type

**Parameters:**

- `url` - The URL to fetch (same as `fetch()`)
- `options` - Fetch options with typed `headers` and `method` (optional). Accepts an
  optional `fetch` property to override the fetch implementation used for the
  request (useful for testing, dependency injection, or custom agents); it is
  stripped before the request options are forwarded, so it never leaks into the
  underlying `fetch()` call.

**Returns:**

```typescript
Promise<{ response: TypedResponse<T>; error: null } | { response: null; error: TypedFetchError }>;
```

`error` is always the full union — `ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError`.
Narrow it with `isKnownHttpError()` + `switch (error.status)`, or `instanceof`.

### `isHttpError(error): error is BaseHttpError`

Type guard that checks if an error is an HTTP error (any status code).

### `isKnownHttpError(error): error is ClientErrors | ServerErrors`

Type guard for a _known_, dedicated HTTP error class (excludes `UnknownHttpError`).
Narrowing on `error.status` after this guard is exhaustive over the mapped codes —
see [Exhaustive Status Narrowing](#exhaustive-status-narrowing-with-isknownhttperror).

### `isNetworkError(error): error is NetworkError`

Type guard that checks if an error is a network-level error (DNS failure, connection
refused, etc.). Returns `false` for `AbortedError` and `TimeoutError` — those are
separate classes; use `isAbortError()` / `isTimeoutError()` for them.

### `isAbortError(error): error is AbortedError`

Type guard that checks if an error is an `AbortedError` (request cancelled via
`AbortController.abort()`).

### `isTimeoutError(error): error is TimeoutError`

Type guard that checks if an error is a `TimeoutError` (request exceeded a timeout,
e.g. via `AbortSignal.timeout()`).

### `statusCodeErrorMap`

A `ReadonlyMap<number, ErrorClass>` mapping HTTP status codes to their error classes. Useful for custom error handling logic.

### `httpErrors`

Array of all 40 HTTP error classes. Useful for iteration and custom registries.

### Exported Types

All public types are exported for building typed wrappers around `typedFetch`:

```typescript
import type {
  TypedResponse, // Response with typed json() and clone()
  TypedFetchReturnType, // the discriminated union typedFetch resolves to
  TypedFetchOptions, // RequestInit with typed headers, method, and an optional fetch override
  TypedHeaders, // headers with IntelliSense for common names
  StrictHeaders, // the strict header name/value map
  HttpMethods, // "GET" | "POST" | ... (fetch-forbidden methods excluded)
  ClientErrors, // union of all 4xx error instances
  ServerErrors, // union of all 5xx error instances
  TypedFetchError, // every error typedFetch can return
} from "@pbpeterson/typed-fetch";

// Example: a typed wrapper with shared options
async function api<T>(path: string, options?: TypedFetchOptions): Promise<TypedFetchReturnType<T>> {
  return typedFetch<T>(`https://api.example.com${path}`, options);
}
```

Error classes are also available from the `@pbpeterson/typed-fetch/errors` subpath if you only need the classes without `typedFetch`.

### Error Class API

All HTTP error classes extend `BaseHttpError`:

**Instance Properties:**

- `status` - HTTP status code (literal type, e.g. `404`)
- `statusText` - The canonical IANA reason phrase for `status` (literal type, e.g. `"Not Found"`) - not the server's wire value. The server's wire phrase, when present, is in `error.message`.
- `url` - The URL of the failed request (from `response.url`)
- `headers` - Response `Headers` object
- `name` - Error class name (e.g. `"NotFoundError"`)

**Instance Methods:**

- `json<T = unknown>()` - Parse error response body as JSON
- `text()` - Parse as text
- `blob()` - Parse as Blob
- `arrayBuffer()` - Parse as ArrayBuffer
- `clone()` - Clone the error for multiple body reads

**Static Properties:**

- `status` - HTTP status code
- `statusText` - The canonical IANA reason phrase for `status` - not the server's wire value

## Non-goals

Things this library deliberately does not do, and won't:

- **Retries** — belongs to a policy layer; a thin fetch wrapper shouldn't own backoff.
- **Interceptors / hooks / middleware** — the moment we add them we're a worse `ky`; compose `typedFetch` in your own function instead.
- **Base-URL / instance configuration (`create()`)** — wrap `typedFetch` yourself; see the typed-wrapper example above.
- **Query-string builder** — use `URL`/`URLSearchParams`; that's what they're for.
- **Request-body serialization** — pass `body`/`headers` exactly like native fetch.
- **Response caching** — out of a request library's remit.
- **Runtime response-body validation as a hard dependency** — a Standard Schema hook may come later as an _additive, zero-dependency_ feature, not as a required dependency.
- **`rawStatusText` field** — the wire reason phrase is already on `error.message`; a second field is only added if there's real demand.
- **Making body reads never-throw (eager buffering)** — it would break streaming semantics; the never-throws guarantee is documented to end at the response envelope.

## Contributing

Bug reports and PRs are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
setup, the gates to run before opening a PR, and how to add a new HTTP status
code. Releases follow [`RELEASING.md`](./RELEASING.md).

## Inspiration

Inspired by Go's error handling philosophy where errors are values:

```go
result, err := http.Get("https://api.example.com/users")
if err != nil {
    return err
}
```

```typescript
const { response, error } = await typedFetch<User[]>("/api/users");
if (error) {
  return error;
}
```

## License

MIT
