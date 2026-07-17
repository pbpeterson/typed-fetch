# @pbpeterson/typed-fetch

[![CI](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40pbpeterson%2Ftyped-fetch)](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
[![license](https://img.shields.io/npm/l/%40pbpeterson%2Ftyped-fetch)](./LICENSE)

A type-safe HTTP client for TypeScript that never throws. Inspired by Go's error handling pattern, built on top of the native Fetch API.

> **Upgrading from 0.x?** 1.0 has breaking changes — see [Migrating from 0.x](./CHANGELOG.md#migrating-from-0x).

## Why typed-fetch?

Traditional fetch libraries throw exceptions on HTTP errors, making error handling cumbersome and error-prone. **typed-fetch** follows Go's philosophy of explicit error handling - errors are values, not exceptions.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

// ❌ Traditional approach - the 404 sails through as success
const raw = await fetch("/api/users");
// fetch does NOT throw on a 404 — raw.ok is false, but you have to remember
// to check it. Skip that check and the error page (often HTML) reaches
// json(), which throws a SyntaxError far from the real cause.
const usersRaw = await raw.json();

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

The `<User[]>` type parameter **types the parse, it does not validate it** — `response.json()` is an unchecked cast to `User[]`, exactly like `await res.json() as User[]` with native fetch. If the payload might not match, pair it with a runtime validator (Zod, Valibot, any Standard Schema) and check the parsed value yourself.

### What never-throws means

`typedFetch` never throws for network failures or HTTP status codes — those come back as `error`. Reading a body (`response.json()`, `error.json()`, `.text()`, …) can still throw, exactly like native fetch: malformed JSON throws `SyntaxError`, and reading an already-consumed body throws.

- **Untrusted/possibly-malformed payload?** Wrap the body read in try/catch — `.clone()` does not help here.
- **Need to read the body more than once?** `.clone()` first, then read each copy — a body can only be consumed once.

Filtered responses with `status: 0` — `opaque`, `opaqueredirect`, and
`Response.error()` responses — come back on the **success** branch as `response`
(with `error: null`), per the Fetch standard. `res.status >= 400` is the only
HTTP-failure test, and zero is not `>= 400`. If your call can produce one
(browser `no-cors`, manual redirects, or service-worker-mediated fetches), check
`response.ok` / `response.type` yourself. Preserve the platform's native body
behavior: opaque bodies are unreadable, while `Response.error().text()` resolves
to `""` and its `.json()` rejects with `SyntaxError` because the empty body is
not JSON.

## Features

- **Never throws** - All errors are returned as values
- **Fully typed** - Complete TypeScript support with literal status types
- **Built on Fetch** - Thin wrapper around the native Fetch API, same arguments
- **40 HTTP error classes** - Covering all standard HTTP status codes (400-511)
- **No status code left behind** - Non-standard error codes (e.g. 420, 599) become `UnknownHttpError`
- **Network error handling** - Separate `NetworkError`, `AbortedError`, and `TimeoutError` classes for connection issues, cancellation, and timeouts, with the original error preserved on `cause`
- **Type guards** - `isHttpError()`, `isKnownHttpError()`, `isNetworkError()`, `isAbortError()`, and `isTimeoutError()` for runtime checks
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

Match a specific status with `instanceof`. This reads well, but only inside a single module graph — if your error may cross an ESM ↔ CJS boundary, use the type guards instead (see [Checking which error you got](#checking-which-error-you-got)).

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

### Checking which error you got

You can check which error you got with the brand-based **type guards** (`isHttpError`,
`isKnownHttpError`, `isNetworkError`, `isAbortError`, `isTimeoutError`) or with plain
`instanceof`. They differ in one way that matters: surviving multiple copies of the
package's classes in one process.

A process can end up with **more than one copy** of this package's classes — for
example when one part of the app `import`s it (ESM) and another `require`s it (CJS,
the "dual-package hazard"), or when a bundler duplicates a class across the `.` and
`./errors` entry points. Each copy is a distinct class object, so `error instanceof
BaseHttpError` can be `false` even when the value genuinely is one.

The type guards are **immune** to this. They identify errors by a cross-realm brand
(a `Symbol.for`-keyed marker) rather than by class identity, so they return the right
answer regardless of which copy created the error or which module format you call them
from.

| Check                                                                                     | Same copy | Across copies (ESM ↔ CJS, `.` ↔ `./errors`)                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isHttpError` / `isNetworkError` / `isAbortError` / `isTimeoutError` / `isKnownHttpError` | ✅        | ✅                                                                                                                                                     |
| `error instanceof BaseHttpError` (base class)                                             | ✅        | ⚠️ only if your bundler shares the class (this package ships with code-splitting, so a single ESM **or** a single CJS graph is fine; ESM ↔ CJS is not) |
| `error instanceof NotFoundError` (specific subclass)                                      | ✅        | ⚠️ same caveat as above                                                                                                                                |

**Which to reach for:** an app that's bundled once and never mixes module formats can use
`instanceof` freely. A library that might be `require()`d by one consumer and `import()`ed
by another must use the guards — that's the case where `instanceof` silently returns
`false`. Use the guards for kind checks (HTTP vs. network vs. abort vs. timeout), and reach
a specific status with `isKnownHttpError()` + `switch (error.status)` — that path is
copy-proof end to end.

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

> The brand is a correctness aid, not a security boundary: a value that hand-forges the
> brand symbol will pass the guard, exactly as a value with a doctored prototype passes
> `instanceof`. Guards answer "did this library make this?", not "is this trusted?".

#### Exhaustive status narrowing with `isKnownHttpError`

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
      // error class to the library ships in a minor release, so new cases can
      // appear without a major bump. (See RELEASING.md#semver-policy.)
      console.log(`HTTP ${error.status}`);
  }
}
```

### Reading Error Response Bodies

All HTTP error classes provide access to the response body. Note that after `isHttpError`,
`error.status` is `number`; the literal type (`404`) only appears after `isKnownHttpError`

- a `case` or after `instanceof NotFoundError`:

```typescript
import { typedFetch, isHttpError, isKnownHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (error && isHttpError(error)) {
  // Clone BEFORE reading if you need the body more than once.
  const forJson = error.clone();
  const json = await error.json();
  const text = await forJson.text();

  const retryAfter = error.headers.get("Retry-After");
  error.status; // number — the union's UnknownHttpError.status widens it
  error.statusText; // string
}

// For literal `status`/`statusText`, narrow to a known class first:
if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      error.status; // 404 (literal)
      error.statusText; // "Not Found" (literal)
      break;
  }
}
```

The `json()` method accepts a generic type parameter for typed error payloads (an unchecked
cast, like the response-body `json()`):

```typescript
import { typedFetch, BadRequestError } from "@pbpeterson/typed-fetch";

interface ApiError {
  message: string;
  code: string;
  fields?: Record<string, string>;
}

const { error } = await typedFetch("/api/users");

if (error instanceof BadRequestError) {
  const details = await error.json<ApiError>();
  console.log(details.message); // typed as ApiError.message
}
```

> **Bodies are single-use.** The response body is a one-shot stream. Reading it
> a second time (`text()` after `json()`, etc.) throws a clear `TypeError` — call
> `clone()` **before** the first read if you need it more than once. And `json()`
> on an empty or non-JSON body still rejects with the platform's `SyntaxError`:
> 4xx/5xx responses often carry an empty body or an HTML page, so reach for
> `text()` when the payload may not be JSON.

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

> **`NetworkError` also covers permanent, non-retryable request errors.** When
> `fetch` throws while _constructing_ the request — an invalid URL, a forbidden
> method (`CONNECT`, `TRACE`), a malformed header name — it raises a `TypeError`
> that never reaches the network. `typedFetch` surfaces these as `NetworkError`
> too (the original `TypeError` is on `error.cause`). A blind "retry on
> `NetworkError`" loop will retry these forever, since no amount of retrying
> fixes a bad URL. Inspect `error.cause` before retrying, and cap your retries.

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
`Request`'s own signal entirely, and the `Request`'s signal is then ignored. An explicit
`signal: null` in the options detaches the `Request`'s signal entirely (fetch-spec behavior);
only an absent or `undefined` `signal` falls back to the `Request`'s own signal.

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

```typescript
import { typedFetch, isAbortError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

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

#### Timeouts

No custom timeout API needed — use the standard `AbortSignal.timeout()`, exactly like with native fetch. It produces a typed `TimeoutError`, not a generic `NetworkError`:

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

A request is classified as a `TimeoutError` only when the signal's reason is a `DOMException`
named `"TimeoutError"` — precisely the value `AbortSignal.timeout()` produces. This is
deliberately robust against a forged name: `controller.abort(Object.assign(new Error("x"), {
name: "TimeoutError" }))` yields an `AbortedError` (with your `Error` preserved on
`error.reason`), not a timeout. Every pre-response error also carries `error.url`, so timed-out
and aborted requests are as easy to correlate in logs as HTTP errors.

## Available Error Classes

<details>
<summary><strong>4xx Client Errors</strong> (29 classes)</summary>

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

</details>

<details>
<summary><strong>5xx Server Errors</strong> (11 classes; 40 dedicated HTTP classes total)</summary>

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

</details>

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

- `T` - The expected response body type. It types `response.json()` as an unchecked cast; it does not validate the payload.

**Parameters:**

- `url` - The URL to fetch (same as `fetch()`)
- `options` - Fetch options with typed `headers` and `method` (optional). The typing is
  **autocomplete-only**: it suggests common header names and HTTP methods in your editor,
  but any string is accepted, exactly like native fetch (see the note below). Accepts an
  optional `fetch` property to override the fetch implementation used for the
  request (useful for testing, dependency injection, or custom agents); it is
  stripped before the request options are forwarded, so it never leaks into the
  underlying `fetch()` call.

  You can also pass a `Request` object in the url slot (the same shapes `fetch()` accepts),
  which is the pattern this library champions for carrying a `signal`. A `Request` is
  forwarded to `fetch()` untouched — its `method`, `headers`, `signal`, and (on Node)
  `body` are preserved. Note that a body-carrying `Request` passed in the **options** slot
  is rejected by browsers on this path (WebIDL requires `duplex` there), so keep bodies on
  the plain-object options path. Passing a `Request` in the **options** slot and using the
  `fetch` override are mutually exclusive: a `Request` has no `fetch` property, so the
  override only applies on the plain-object options path. A `Request` in the **url** slot
  combines freely with a plain options object carrying `fetch`.

**Returns:**

```typescript no-check
Promise<{ response: TypedResponse<T>; error: null } | { response: null; error: TypedFetchError }>;
```

`error` is always the full union — `ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError`.
Narrow it with `isKnownHttpError()` + `switch (error.status)`, or `instanceof`.

### `isHttpError(error): error is BaseHttpError`

Type guard that checks if an error is an HTTP error (any status code). Brand-based, so
it is reliable across module copies and formats — unlike raw `instanceof`
(see [Checking which error you got](#checking-which-error-you-got)). The same holds for
every guard below.

### `isKnownHttpError(error): error is ClientErrors | ServerErrors`

Type guard for a _known_, dedicated HTTP error class. It excludes both
`UnknownHttpError` and consumer-defined subclasses of `BaseHttpError`; those
custom subclasses still pass `isHttpError()`. Dedicated library errors carry a
separate cross-copy brand so this `ClientErrors | ServerErrors` predicate stays
sound across ESM/CJS and duplicate package installations. Narrowing on
`error.status` after this guard is exhaustive over the mapped codes — see
[Exhaustive status narrowing](#exhaustive-status-narrowing-with-isknownhttperror).

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

All public types are exported for building typed wrappers around `typedFetch`. The
`headers` and `method` typing is **autocomplete-only** — it suggests common names in
your editor, but any string is accepted, exactly like native fetch:

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";
import type {
  TypedResponse, // Response with typed json() and clone()
  TypedFetchReturnType, // the discriminated union typedFetch resolves to
  TypedFetchOptions, // RequestInit with typed headers, method, and an optional fetch override
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

> **`headers` and `method` are autocomplete-only.** The type behind
> `TypedFetchOptions["headers"]` suggests common header names (and some values) in your
> editor, but it does **not** validate what you pass — neither the names nor the values.
> `{ "Content-Type": "not/a/real/type" }`, `{ "Content-Typ": "x" }` (misspelled name), and
> `{ Connection: "definitely-wrong" }` all type-check, because the underlying string index
> signature and the `| HeadersInit` union arm accept any string record. Treat it as an
> editor convenience, not a guarantee.

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
- `clone()` - Clone the error for multiple body reads (call it **before** the first read; it throws a clear `TypeError` once the body has been consumed)

**Static Properties** (access status codes without creating an instance):

- `status` - HTTP status code (e.g. `NotFoundError.status === 404`)
- `statusText` - The canonical IANA reason phrase for `status` (e.g. `NotFoundError.statusText === "Not Found"`) - not the server's wire value

### `NetworkError`, `AbortedError`, `TimeoutError`

These three are **not** HTTP errors — they represent a request that never got an HTTP
response, so they do not extend `BaseHttpError` and have no `status`/`headers`/body methods.
All three carry the original error thrown by `fetch` on `cause`, and the requested URL on
`url` (a `string`) — so concurrent pre-response failures are still distinguishable in logs,
the same way `BaseHttpError.url` distinguishes HTTP errors. Because every error family now
carries `readonly url: string`, code written against the full `TypedFetchError` union can
read `error.url` unconditionally, with no narrowing.

- **`NetworkError`** — `message` (`string`), `cause` (`unknown`), `url` (`string`).
- **`TimeoutError`** — `cause` (`unknown`), `url` (`string`). Emitted when the request's
  signal was aborted with a `DOMException` named `"TimeoutError"` — exactly what
  `AbortSignal.timeout()` produces. Classification requires that specific `DOMException`
  shape, **not** merely a `reason.name` of `"TimeoutError"`: a caller who forges that name
  on a plain `Error` via `controller.abort()` gets an `AbortedError` (with the reason
  preserved), never a spurious timeout.
- **`AbortedError`** — `cause` (`unknown`), `reason` (`unknown`), `url` (`string`). `reason`
  is whatever the caller passed to `controller.abort(reason)`, typed `unknown` — you must
  narrow it.

For the full abort/timeout story — how cancellation is detected, signal precedence, and the
reason value — see [Network Errors, Aborts, and Timeouts](#network-errors-aborts-and-timeouts).

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

## Semantic versioning contract

1. Adding a new dedicated HTTP error class is a **minor** release. Consumers
   switching on `error.status` after `isKnownHttpError()` must keep a `default`
   branch so an additive status remains safe.
2. Changing a status that already returned `UnknownHttpError` to return a new
   dedicated class is a **major** release because it changes the runtime type of
   an existing path.
3. Human-readable `error.message` text is diagnostic and is not a stable API
   contract.
4. A class's `statusText` is its canonical IANA reason phrase and is part of the
   public contract; it does not mirror a server's wire reason phrase.
5. Removing or renaming an export, or changing an existing class's `status` or
   `statusText` literal, is a **major** release.
6. Every npm publication must come from the matching `vX.Y.Z` Git tag through
   the repository's release workflow.
7. Node.js 20 is the current minimum. Dropping a supported Node major requires
   a **major** release.

See [`RELEASING.md`](./RELEASING.md) for the binding release procedure.

## Contributing

Bug reports and PRs are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
setup, the gates to run before opening a PR, and how to add a new HTTP status
code. Releases follow [`RELEASING.md`](./RELEASING.md).

## License

MIT
