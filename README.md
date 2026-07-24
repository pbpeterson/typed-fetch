# @pbpeterson/typed-fetch

[![CI](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40pbpeterson%2Ftyped-fetch)](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
[![license](https://img.shields.io/npm/l/%40pbpeterson%2Ftyped-fetch)](./LICENSE)

`typed-fetch` is a type-safe HTTP client for TypeScript. It returns request errors as values and uses the native Fetch API.

Its result model follows the Go pattern: errors are values.

> **Upgrade from 0.x:** Version 1.0 has breaking changes. Read [Migrating from 0.x](./CHANGELOG.md#migrating-from-0x).

## Why typed-fetch?

Native `fetch` does not reject a request for an HTTP error status. You must check `response.ok` after each request.

`typedFetch` checks the status for you. It returns a discriminated union with a response or a typed error.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

// Native fetch: this example forgets the required raw.ok check.
const raw = await fetch("/api/users");
const usersRaw = await raw.json();

// typedFetch: request errors are values.
const { response, error } = await typedFetch<User[]>("/api/users");

if (error) {
  if (isHttpError(error)) {
    console.log(`HTTP ${error.status}: ${error.statusText}`);
    const errorDetails = await error.json();
  } else {
    console.log(`Request failed: ${error.message}`);
  }
} else {
  const users = await response.json(); // User[]
}
```

The `<User[]>` type sets the TypeScript result of `response.json()`. It does not validate the response data.

Use a runtime validator when the response data is not trusted. You can use Zod, Valibot, or a Standard Schema validator.

### What never-throws means

`typedFetch` does not reject for HTTP statuses, network failures, aborts, or timeouts. It returns these failures in `error`.

Body readers keep the native Fetch behavior. `json()`, `text()`, and the other body methods can reject.

- Use `try/catch` for a body read when the data can be invalid.
- Call `.clone()` before the first body read when you must read the body two times.

A custom Fetch implementation is not trusted input. `typedFetch` returns a `NetworkError` when the implementation resolves a value that is not a `Response`.

`typedFetch` treats only statuses of 400 or more as HTTP errors. Thus, a response with status `0` stays on the success branch.

Browsers can produce status `0` for `opaque`, `opaqueredirect`, and `Response.error()` responses. Check `response.ok` or `response.type` for these responses.

Opaque response bodies cannot be read. `Response.error().text()` returns `""`, and its `.json()` rejects because the body is empty.

## Features

- Returns HTTP, network, abort, and timeout errors as values.
- Gives literal status types for 40 standard HTTP error classes.
- Returns `UnknownHttpError` for other statuses of 400 or more.
- Uses the same inputs as native `fetch`.
- Gives brand-based type guards for all error groups.
- Keeps the original pre-response error in `cause`.
- Gives typed success and error body readers.
- Releases an unread error body with `cancel()`.
- Has no runtime dependencies.

## Installation

Install the package:

```bash
npm install @pbpeterson/typed-fetch
```

Use Node.js 20 or a later version. You can also use a browser, Deno, Bun, or an edge runtime with native Fetch.

### Agent skill

Install the `typed-fetch` skill when you use Claude Code or another compatible agent:

```bash
npx skills add pbpeterson/typed-fetch --skill typed-fetch
```

## Basic usage

### GET request

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
    console.error(`HTTP ${error.status} ${error.statusText}`);
  } else {
    console.error("Request failed:", error.message);
  }
} else {
  const users = await response.json(); // User[]
}
```

### POST request

```typescript
import { typedFetch, BadRequestError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string; email: string };

const { response, error } = await typedFetch<User>("/api/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "John", email: "john@example.com" }),
});

if (error instanceof BadRequestError) {
  const details = await error.json<{ field: string; message: string }>();
  console.error("Validation failed:", details);
}
```

## Error handling

Each result contains one non-null value:

- A successful result has `response` and `error: null`.
- A failed result has `response: null` and `error`.

### HTTP status errors

Use `instanceof` to check one status when all code uses one package copy. Use a type guard when an error can cross module boundaries.

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

const { error } = await typedFetch<User>("/api/users/123");

if (error instanceof NotFoundError) {
  console.log("User not found");
} else if (error instanceof UnauthorizedError) {
  console.log("Log in first");
} else if (error instanceof NetworkError) {
  console.log("Network error:", error.message);
} else if (error instanceof AbortedError) {
  console.log("Request canceled");
} else if (error instanceof TimeoutError) {
  console.log("Request timed out");
}
```

### Unknown status codes

`UnknownHttpError` represents a status of 400 or more when no dedicated class exists. Examples include 420 and 599.

```typescript
import { typedFetch, UnknownHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/legacy");

if (error instanceof UnknownHttpError) {
  console.log(error.status); // For example, 599.
  const body = await error.text();
}
```

### Error type guards

The package gives type guards for each error group:

- `isHttpError()`
- `isKnownHttpError()`
- `isNetworkError()`
- `isAbortError()`
- `isTimeoutError()`

One process can load more than one copy of a class. This can occur when code mixes ESM and CJS or uses two package entry points.

Each copy has a different class identity. Thus, `instanceof` can return `false` for an error from a different copy.

The type guards use a `Symbol.for` brand. The brand works across package copies and module formats.

| Check                            | Same copy | Different copies                     |
| -------------------------------- | --------- | ------------------------------------ |
| Type guards                      | Yes       | Yes                                  |
| `error instanceof BaseHttpError` | Yes       | Yes, if both modules share the class |
| `error instanceof NotFoundError` | Yes       | Yes, if both modules share the class |

Use `instanceof` in an application that has one module graph. Use the type guards in a library or in code that can mix module formats.

Use `isKnownHttpError()` and `switch (error.status)` to identify a specific status across package copies.

```typescript
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { error } = await typedFetch<User>("/api/users/123");

if (error) {
  if (isHttpError(error)) {
    console.log(`HTTP ${error.status}: ${error.statusText}`);
  } else if (isNetworkError(error)) {
    console.log("Connection failed:", error.message);
  } else if (isAbortError(error)) {
    console.log("Request canceled");
  } else if (isTimeoutError(error)) {
    console.log("Request timed out");
  }
}
```

`isNetworkError()` does not match `AbortedError` or `TimeoutError`. Use their type guards.

The brand is not a security control. A value with a forged brand can pass a guard.

#### Known status switch

`isHttpError()` narrows an error to `BaseHttpError`. Its `status` stays a `number` because this group includes `UnknownHttpError`.

`isKnownHttpError()` excludes `UnknownHttpError`. TypeScript can then narrow each status to one dedicated class.

```typescript
import { typedFetch, isKnownHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { error } = await typedFetch<User>("/api/users/123");

if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      console.log("User not found"); // NotFoundError
      break;
    case 401:
      console.log("Log in first"); // UnauthorizedError
      break;
    default:
      // Keep this branch for different package versions.
      console.log(`HTTP ${error.status}`);
  }
}
```

### Error response bodies

All HTTP error classes give access to the response body and headers.

Call `clone()` before the first body read when you must read the body two times.

```typescript
import { typedFetch, isHttpError, isKnownHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (error && isHttpError(error)) {
  const forJson = error.clone();
  const json = await error.json();
  const text = await forJson.text();

  const retryAfter = error.headers.get("Retry-After");
  error.status; // number
  error.statusText; // string
}

if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      error.status; // 404
      error.statusText; // "Not Found"
      break;
  }
}
```

The generic type of `error.json<T>()` is an unchecked TypeScript cast. It does not validate the body.

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
  console.log(details.message);
}
```

A body is a one-use stream. A second read rejects with `TypeError`. A read also rejects with `TypeError` when a reader holds the stream.

An empty or non-JSON body makes `json()` reject with `SyntaxError`. Use `text()` when the body format is not known.

#### Cancel an unread error body

Every error body needs a read or a cancel. An unread body keeps the stream open, and the open stream pins the connection.

Call `cancel()` when the body content is not necessary. This method releases the body without a read of the content.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (isHttpError(error)) {
  console.log(error.status);
  await error.cancel();
}
```

`cancel()` frees the resources immediately. But it can also close the connection instead of a return of the connection to the keep-alive pool.

Read the body with `text()` when the connection is more important than the bytes.

`cancel()` resolves when the response has no body. It is also safe after a complete body read.

`cancel()` rejects with `TypeError` when a reader holds the stream. Release that reader first.

After a `cancel()`, all body readers and `clone()` throw `TypeError`.

### Network errors, aborts, and timeouts

Three error classes represent a failure before an HTTP response:

| Class          | Cause                                              | Guard              |
| -------------- | -------------------------------------------------- | ------------------ |
| `NetworkError` | DNS failure, refused connection, or redirect error | `isNetworkError()` |
| `AbortedError` | `AbortController.abort()` canceled the request     | `isAbortError()`   |
| `TimeoutError` | `AbortSignal.timeout()` stopped the request        | `isTimeoutError()` |

Each class keeps the original Fetch error in `cause`. `AbortedError` and `TimeoutError` do not extend `NetworkError`.

`NetworkError` also represents errors that occur before a network connection. Examples include an invalid URL, a forbidden method, and an invalid header name.

These permanent input errors have a `TypeError` in `cause`. Check `cause` before you retry a `NetworkError`.

The request signal controls abort classification. The name of the rejected error does not control the classification.

The signal can be in `options.signal` or in a `Request` input. An options signal has priority over the signal in a `Request`.

An explicit `signal: null` disconnects the signal in a `Request`. An absent or `undefined` signal does not disconnect it.

The classification also covers a custom Fetch implementation. Some implementations reject with their own abort error instead of the signal reason.

`typedFetch` returns `AbortedError` when the signal reports an abort and the rejected error has the name `"AbortError"`.

An error with the name `"AbortError"` stays a `NetworkError` when no signal reports an abort.

The signal reason still decides between an abort and a timeout. A timeout reason gives `TimeoutError`, also for an implementation that rejects with an abort error.

```typescript
import { typedFetch, isNetworkError, isAbortError, isTimeoutError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://unreachable.example");

if (isNetworkError(error)) {
  console.log("Connection failed:", error.message);
  console.log(error.cause);
} else if (isAbortError(error)) {
  console.log("Request canceled");
  console.log(error.reason);
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
}
```

#### `AbortedError` and the abort reason

You can give a reason to `AbortController.abort()`.

```typescript
import { typedFetch, isAbortError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const controller = new AbortController();
const promise = typedFetch<User[]>("/api/users", { signal: controller.signal });

controller.abort(new Error("route change"));

const { error } = await promise;

if (isAbortError(error) && error.reason instanceof Error) {
  console.log(error.reason.message);
}
```

`error.reason` is the exact value from `controller.abort(reason)`. Its type is `unknown`, so check its type before use.

When you call `controller.abort()` without a reason, the platform supplies an `AbortError` `DOMException`.

#### Timeouts

Use the standard `AbortSignal.timeout()` API. `typedFetch` returns a `TimeoutError` for this signal.

```typescript
import { typedFetch, isTimeoutError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});

if (isTimeoutError(error)) {
  console.log("Request timed out after 5 seconds");
}
```

A timeout requires a `DOMException` with the name `"TimeoutError"`. This is the value that `AbortSignal.timeout()` supplies.

A plain `Error` with the same name does not create a timeout. `typedFetch` returns `AbortedError` and keeps that value in `reason`.

#### Manual cancellation with a deadline

Use `AbortSignal.any()` when the code needs a manual cancellation and a deadline together.

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";

const controller = new AbortController();

const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);

const { error } = await typedFetch("/api/users", { signal });

controller.abort(new Error("route change"));
```

The first signal that aborts decides the result. A manual abort gives `AbortedError`. The deadline gives `TimeoutError`.

Each pre-response error also has a `url` value. Use this value to identify failed concurrent requests.

## Available error classes

<details>
<summary><strong>4xx client errors</strong> (29 classes)</summary>

| Class                               | Status | Status text                     |
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
| `RequestTooLongError`               | 413    | Content Too Large               |
| `RequestUriTooLongError`            | 414    | URI Too Long                    |
| `UnsupportedMediaTypeError`         | 415    | Unsupported Media Type          |
| `RequestedRangeNotSatisfiableError` | 416    | Range Not Satisfiable           |
| `ExpectationFailedError`            | 417    | Expectation Failed              |
| `ImATeapotError`                    | 418    | I'm a teapot                    |
| `MisdirectedRequestError`           | 421    | Misdirected Request             |
| `UnprocessableEntityError`          | 422    | Unprocessable Content           |
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
<summary><strong>5xx server errors</strong> (11 classes of 40 total)</summary>

| Class                                | Status | Status text                     |
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

### Other error classes

| Class              | Description                                     |
| ------------------ | ----------------------------------------------- |
| `UnknownHttpError` | Status of 400 or more without a dedicated class |
| `NetworkError`     | Network or request-construction failure         |
| `AbortedError`     | Request canceled by `AbortController.abort()`   |
| `TimeoutError`     | Request stopped by `AbortSignal.timeout()`      |
| `BaseHttpError`    | Abstract base class for HTTP errors             |

## API reference

### `typedFetch<T>(url, options?)`

`T` sets the TypeScript result of `response.json()`. It does not validate the response data.

`url` accepts the same resource input as native `fetch`.

`options` extends `RequestInit`. It gives autocomplete for common headers and methods, but it accepts all strings that native Fetch accepts.

The optional `fetch` property sets a custom Fetch implementation. Use it for tests, dependency injection, or custom agents.

When `options` has no custom `fetch` property, `typedFetch` gives the original object to native `fetch` without changes.

`typedFetch` removes the custom property before it calls the Fetch implementation. It keeps inherited properties and WebIDL getters.

`typedFetch` also protects the response inspection. A custom implementation that resolves a value that is not a `Response` gives a `NetworkError` with the original `TypeError` in `cause`.

You can give a `Request` in the `url` position. `typedFetch` keeps its method, headers, signal, and Node.js body.

Do not give a body-carrying `Request` in the `options` position. Browsers reject this form because WebIDL requires `duplex`.

An augmented `Request` in the `options` position can contain a `fetch` property. The sanitized view keeps its WebIDL fields and hides the custom property.

The function returns this union:

```typescript no-check
Promise<{ response: TypedResponse<T>; error: null } | { response: null; error: TypedFetchError }>;
```

The `error` value has the full `TypedFetchError` union. Use the type guards or `instanceof` to narrow it.

### `isHttpError(error): error is BaseHttpError`

This guard identifies all HTTP errors. It works across package copies and module formats.

### `isKnownHttpError(error): error is ClientErrors | ServerErrors`

This guard identifies dedicated library HTTP errors. It excludes `UnknownHttpError` and consumer subclasses of `BaseHttpError`.

The guard checks the status map of the current package version. An older package copy rejects a status that only a newer copy knows.

Use this guard before a status switch that must narrow to one dedicated class.

### `isNetworkError(error): error is NetworkError`

This guard identifies a `NetworkError`. It does not identify `AbortedError` or `TimeoutError`.

### `isAbortError(error): error is AbortedError`

This guard identifies a request that an abort signal canceled.

### `isTimeoutError(error): error is TimeoutError`

This guard identifies a request that `AbortSignal.timeout()` stopped.

### Exported types

The package exports public types for typed wrappers:

```typescript
import { typedFetch } from "@pbpeterson/typed-fetch";
import type {
  TypedResponse,
  TypedFetchReturnType,
  TypedFetchOptions,
  HttpMethods,
  ClientErrors,
  ServerErrors,
  TypedFetchError,
} from "@pbpeterson/typed-fetch";

async function api<T>(path: string, options?: TypedFetchOptions): Promise<TypedFetchReturnType<T>> {
  return typedFetch<T>(`https://api.example.com${path}`, options);
}
```

- `TypedResponse` gives typed `json()` and `clone()` methods.
- `TypedFetchReturnType` is the result union from `typedFetch`.
- `TypedFetchOptions` extends `RequestInit` and adds the Fetch override.
- `HttpMethods` gives method suggestions. It omits `CONNECT` and `TRACE`.
- `ClientErrors` is the union of dedicated 4xx errors.
- `ServerErrors` is the union of dedicated 5xx errors.
- `TypedFetchError` is the union of all returned error types.

Import only the error classes from `@pbpeterson/typed-fetch/errors` when you do not need `typedFetch`.

The `headers` and `method` types give autocomplete only. They do not validate a name or a value.

For example, an invalid content type or a misspelled header name can type-check. Native Fetch accepts the underlying string record.

### Error class API

All HTTP error classes extend `BaseHttpError`.

Dedicated classes use literal types for `status` and `statusText`.

Instance properties:

- `status`: The HTTP status code.
- `statusText`: The canonical protocol label from the library.
- `url`: The response URL.
- `headers`: The response headers.
- `name`: The error class name.

`statusText` does not copy the wire reason phrase from the server. The wire phrase can occur in `error.message`.

Instance methods:

- `json<T = unknown>()`: Read the body as JSON.
- `text()`: Read the body as text.
- `blob()`: Read the body as a `Blob`.
- `arrayBuffer()`: Read the body as an `ArrayBuffer`.
- `cancel(reason?)`: Release the body without a read.
- `clone(recreate?)`: Clone the error before a body read.

Do not call `clone()` after you read the body, cancel the body, or lock its stream. The method throws `TypeError`.

Built-in errors do not need a recreation callback. A consumer subclass can also call `clone()` without a callback.

The no-callback form uses only the cloned `Response`. It cannot preserve other constructor or private state.

Give a callback when a consumer subclass has other state:

```typescript no-check
const copy = error.clone((response) => new CustomHttpError(response, error.context));
```

Each dedicated class also has static `status` and `statusText` properties.

### `NetworkError`, `AbortedError`, and `TimeoutError`

These classes represent failures that occur before an HTTP response. They do not extend `BaseHttpError` and do not have body methods.

All three classes have `cause` and `url`. Thus, code can read `error.url` from every member of `TypedFetchError`.

The `url` value is an empty string when `typedFetch` cannot get the request URL.

- `NetworkError` has `message`, `cause`, and `url`.
- `TimeoutError` has `cause` and `url`.
- `AbortedError` has `cause`, `reason`, and `url`.

The `reason` value has type `unknown`. Check its type before use.

## Non-goals

This library does not include these features:

- Retries. Put retry policy in a separate layer.
- Interceptors, hooks, or middleware. Wrap `typedFetch` in your code.
- Base URL or instance configuration. Write a small wrapper function.
- A query-string builder. Use `URL` and `URLSearchParams`.
- Request-body serialization. Give `body` and `headers` as native Fetch inputs.
- Response caching. Use a cache layer.
- Necessary runtime validation. The package can add an optional Standard Schema hook in a later release.
- A `rawStatusText` field. Read the wire phrase from `error.message`.
- Eager body buffering. Body readers keep native streaming behavior.

## Semantic version contract

1. A new dedicated class in `ClientErrors` or `ServerErrors` requires a major release. It replaces `UnknownHttpError` and widens the error union.
2. Human-readable `error.message` text is diagnostic and can change in any release.
3. The canonical `statusText` value is public API. A change to it requires a major release.
4. Status 418 keeps `"I'm a teapot"`. Status 510 keeps `"Not Extended"`.
5. A removed or renamed export requires a major release.
6. A change to a `status` literal requires a major release.
7. A matching `vX.Y.Z` Git tag must start each npm release.
8. Node.js 20 is the minimum version. A higher minimum requires a major release.

Keep a `default` branch in a known-status switch. This helps code that uses different package versions.

Read [`RELEASING.md`](./RELEASING.md) for the release procedure.

## Contribution

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before you make a pull request.

That document gives setup instructions, necessary checks, and the procedure to add an HTTP status class.

## License

MIT
