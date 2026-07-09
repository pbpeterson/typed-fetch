# @pbpeterson/typed-fetch

[![CI](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40pbpeterson%2Ftyped-fetch)](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
[![license](https://img.shields.io/npm/l/%40pbpeterson%2Ftyped-fetch)](./LICENSE)

A type-safe HTTP client for TypeScript that never throws. Inspired by Go's error handling pattern, built on top of the native Fetch API.

## Why typed-fetch?

Traditional fetch libraries throw exceptions on HTTP errors, making error handling cumbersome and error-prone. **typed-fetch** follows Go's philosophy of explicit error handling - errors are values, not exceptions.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

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
  if (isHttpError(error)) {
    console.log(`HTTP ${error.status}: ${error.statusText}`);
    const errorDetails = await error.json(); // Access error response body
  } else {
    console.log(`Request failed: ${error.message}`); // network, abort, timeout
  }
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
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

interface User {
  id: number;
  name: string;
  email: string;
}

const { response, error } = await typedFetch<User[]>("/api/users");

if (error) {
  if (isHttpError(error)) {
    console.error(`Failed to fetch users: HTTP ${error.status} ${error.statusText}`);
  } else {
    console.error("Failed to fetch users:", error.message);
  }
} else {
  const users = await response.json(); // Type: User[]
}
```

### POST Request with Body

```typescript
import { typedFetch, BadRequestError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string; email: string };

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

type User = { id: number; name: string };

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

Cancellation is detected from the request's `AbortSignal` (`signal.aborted`), **not** from
the rejected error's `.name`. That's what makes the mainstream pattern work: when you pass a
reason — `controller.abort(reason)` — `fetch` rejects with _that reason_, whose `.name` is
usually not `"AbortError"`. `typedFetch` still classifies it as an `AbortedError` and hands
you the reason on `error.reason` (see [`AbortedError`](#abortederror-abort-and-the-signal-reason)),
so you decide what it means.

The signal is honored **wherever it lives** — whether you pass it in the options slot
(`typedFetch(url, { signal })`) or carry it on a `Request` in the url slot
(`typedFetch(new Request(url, { signal }))`, the canonical fetch pattern used by service
workers, middleware, and request factories). If a signal is present in **both** slots,
precedence matches native `fetch(request, init)`: the options-slot `signal` **overrides** the
`Request`'s own signal entirely, and the `Request`'s signal is then ignored.

```typescript
import { typedFetch, isNetworkError, isAbortError, isTimeoutError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch("https://unreachable.example");

if (isNetworkError(error)) {
  console.log("Connection failed:", error.message);
  console.log(error.cause); // the original TypeError, etc.
} else if (isAbortError(error)) {
  console.log("Request was cancelled");
  console.log(error.reason); // whatever you passed to controller.abort(reason)
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
}
```

#### `AbortedError`, abort, and the signal reason

The Web platform lets you attach a cancellation _reason_:

```typescript no-check
const controller = new AbortController();

const promise = typedFetch<User[]>("/api/users", { signal: controller.signal });

// e.g. the user navigated away — cancel with a reason that says why
controller.abort(new Error("route change"));

const { error } = await promise;
if (isAbortError(error)) {
  // error.reason is the exact value you passed to abort() — narrow it yourself.
  if (error.reason instanceof Error) console.log(error.reason.message); // "route change"
}
```

`error.reason` is **whatever the caller passed to `controller.abort(reason)`** — an `Error`,
a string, an object, anything — so it is typed `unknown` and you must narrow it. When you
call `controller.abort()` with **no** reason, the platform supplies a `DOMException` named
`"AbortError"` as the reason.

### Timeouts

No custom timeout API needed — use the standard `AbortSignal.timeout()`, exactly like with native fetch. It now produces a typed `TimeoutError`, not a generic `NetworkError`:

```typescript
import { typedFetch, isTimeoutError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { response, error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});

if (isTimeoutError(error)) {
  console.log("Request timed out after 5s");
}
```

### Type Guards

Use `isHttpError()`, `isNetworkError()`, `isAbortError()`, and `isTimeoutError()` instead of `instanceof` for reliable checks across package boundaries (see [`instanceof` vs. type guards](#instanceof-vs-type-guards) for why this matters):

```typescript
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

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

### `instanceof` vs. type guards

A process can end up with **more than one copy** of this package's classes — for
example when one part of the app `import`s it (ESM) and another `require`s it (CJS,
the "dual-package hazard"), or when a bundler duplicates a class across the `.` and
`./errors` entry points. Each copy is a distinct class object, so `error instanceof
BaseHttpError` can be `false` even when the value genuinely is one.

The type guards (`isHttpError`, `isKnownHttpError`, `isNetworkError`, `isAbortError`,
`isTimeoutError`) are **immune** to this. They identify errors by a cross-realm brand
(a `Symbol.for`-keyed marker) rather than by class identity, so they return the right
answer regardless of which copy created the error or which module format you call them
from.

| Check                                                                                     | Same copy | Across copies (ESM ↔ CJS, `.` ↔ `./errors`)                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isHttpError` / `isNetworkError` / `isAbortError` / `isTimeoutError` / `isKnownHttpError` | ✅        | ✅                                                                                                                                                     |
| `error instanceof BaseHttpError` (base class)                                             | ✅        | ⚠️ only if your bundler shares the class (this package ships with code-splitting, so a single ESM **or** a single CJS graph is fine; ESM ↔ CJS is not) |
| `error instanceof NotFoundError` (specific subclass)                                      | ✅        | ⚠️ same caveat as above                                                                                                                                |

**Recommendation:** use the type guards for kind checks (HTTP vs. network vs. abort vs.
timeout), and reach a specific status with `isKnownHttpError()` + `switch (error.status)`
— that path is copy-proof end to end. Plain `instanceof` still works and reads well within
a single module graph; the examples below use it for brevity.

> The brand is a correctness aid, not a security boundary: a value that hand-forges the
> brand symbol will pass the guard, exactly as a value with a doctored prototype passes
> `instanceof`. Guards answer "did this library make this?", not "is this trusted?".

### Exhaustive Status Narrowing with `isKnownHttpError`

`isHttpError()` narrows to `BaseHttpError`, but `switch (error.status)` on that type
still includes `UnknownHttpError` in every `case` (its `status` is typed `number`, so
it matches everything). Use `isKnownHttpError()` instead when you want `error.status`
to narrow to exactly one dedicated error class per case:

```typescript
import { typedFetch, isKnownHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

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

```typescript no-check
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
(see above; this path is copy-proof), or `instanceof` for one specific class (reliable
within a single module graph — see [`instanceof` vs. type guards](#instanceof-vs-type-guards)):

```typescript
import { typedFetch, NotFoundError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { response, error } = await typedFetch<User>("/api/users/123");

if (error instanceof NotFoundError) {
  console.log("User not found");
}
```

### Error Response Bodies

All HTTP error classes provide access to the response body:

```typescript no-check
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

  You can also pass a `Request` object here (the same shapes `fetch()` accepts). A
  `Request` is forwarded to `fetch()` untouched — its `method`, `headers`, `body`,
  and `signal` are preserved exactly (including abort/timeout handling). Note that
  passing a `Request` and using the `fetch` override are mutually exclusive: a
  `Request` has no `fetch` property, so the override only applies on the
  plain-object options path.

**Returns:**

```typescript no-check
Promise<{ response: TypedResponse<T>; error: null } | { response: null; error: TypedFetchError }>;
```

`error` is always the full union — `ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError`.
Narrow it with `isKnownHttpError()` + `switch (error.status)`, or `instanceof`.

### `isHttpError(error): error is BaseHttpError`

Type guard that checks if an error is an HTTP error (any status code). Brand-based, so
it is reliable across module copies and formats — unlike raw `instanceof`
(see [`instanceof` vs. type guards](#instanceof-vs-type-guards)). The same holds for
every guard below.

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

### Exported Types

All public types are exported for building typed wrappers around `typedFetch`:

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";
import type {
  TypedResponse, // Response with typed json() and clone()
  TypedFetchReturnType, // the discriminated union typedFetch resolves to
  TypedFetchOptions, // RequestInit with typed headers, method, and an optional fetch override
  TypedHeaders, // header-name autocomplete only — does NOT validate values
  StrictHeaders, // the header name/value suggestion map (autocomplete only)
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

> **`TypedHeaders` / `StrictHeaders` are autocomplete-only.** They suggest common
> header names (and some values) in your editor, but they do **not** validate the
> values you pass. `{ "Content-Type": "not/a/real/type" }` type-checks, because
> `StrictHeaders`' string index signature and the `| HeadersInit` union arm both
> accept any string record. Treat them as an editor convenience, not a guarantee.

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

### `NetworkError`, `AbortedError`, `TimeoutError`

These three are **not** HTTP errors — they represent a request that never got an HTTP
response, so they do not extend `BaseHttpError` and have no `status`/`headers`/body methods.
All three carry the original error thrown by `fetch` on `cause`.

- **`NetworkError`** — `message` (`string`), `cause` (`unknown`).
- **`TimeoutError`** — `cause` (`unknown`). Emitted when the request's signal was aborted
  by an `AbortSignal.timeout()` (its reason is a `DOMException` named `"TimeoutError"`).
- **`AbortedError`** — `cause` (`unknown`) and `reason` (`unknown`). `reason` is whatever
  the caller passed to `controller.abort(reason)`. It is typed `unknown` on purpose — the
  reason can be an `Error`, a string, an object, or anything else, so **you must narrow it**.
  When `controller.abort()` is called with no argument, the platform supplies a
  `DOMException` named `"AbortError"` as the reason.

Cancellation is determined by the request's `AbortSignal` (`signal.aborted`), not by the
rejected error's `.name`, so `controller.abort(reason)` is classified as an `AbortedError`
regardless of what `reason` is.

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

```typescript no-check
const { response, error } = await typedFetch<User[]>("/api/users");
if (error) {
  return error;
}
```

## License

MIT
