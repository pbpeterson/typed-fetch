# @pbpeterson/typed-fetch

[![CI](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40pbpeterson%2Ftyped-fetch)](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
[![license](https://img.shields.io/npm/l/%40pbpeterson%2Ftyped-fetch)](./LICENSE)

## Purpose

`typed-fetch` is a type-safe HTTP client for TypeScript. It uses the native Fetch API. It has no runtime dependencies.

Native `fetch` does not reject a request for an HTTP error status. The calling code must check `response.ok` after each request.

`typedFetch` checks the status. It resolves with a discriminated union that holds a response or a typed error.

`typedFetch` does not reject for an HTTP status, a network failure, an abort, or a timeout. It resolves with these failures in `error`.

Body readers are separate operations. `json()`, `text()`, `blob()`, and `arrayBuffer()` keep the native Fetch behavior, and they can reject.

### Upgrade from 0.x

Version 1.0 has breaking changes. Four of them need a code change:

- **The type guards identify errors by a `Symbol.for` brand, not by `instanceof`.** They now work across package copies. A value that forges the brand passes a guard.
- **`typedFetch<T, E>` lost its second type parameter.** Use `typedFetch<T>`. `error` is always the complete `TypedFetchError` union. Narrow it with a guard.
- **An abort resolves with `AbortedError`, and a timeout with `TimeoutError`.** Neither extends `NetworkError`, so `isNetworkError()` returns `false` for both. Use `isAbortError()` and `isTimeoutError()`.
- **Abort detection reads the request's `AbortSignal`, not the rejected error's `name`.** `controller.abort(reason)` now classifies correctly.

`statusCodeErrorMap`, `httpErrors`, `HttpErrors`, `TypedHeaders`, and `StrictHeaders` are no longer exported. `TypedFetchOptions["headers"]` still gives header-name autocomplete.

The full list is in [CHANGELOG.md](https://github.com/pbpeterson/typed-fetch/blob/main/CHANGELOG.md#migrating-from-0x).

### Terms

This document uses these terms with these meanings.

| Term                  | Meaning                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| known HTTP error      | A status code that has a dedicated error class.                                                   |
| unknown HTTP error    | A status code of 400 or more with no dedicated class. `UnknownHttpError` represents it.           |
| package copy          | One loaded instance of this package in a process.                                                 |
| abort the request     | An `AbortSignal` stops a request.                                                                 |
| cancel the error body | `error.cancel()` releases the body of an HTTP error.                                              |
| read the error body   | `json()`, `text()`, `blob()`, or `arrayBuffer()` consumes the body.                               |
| reason phrase         | The status text that the server sends on the wire. It can differ from the library's `statusText`. |
| error record          | The plain object that `error.toJSON()` returns and `JSON.stringify(error)` writes.                |

### Capabilities

- Resolves with HTTP, network, abort, and timeout errors as values.
- Gives literal status types for 40 dedicated HTTP error classes.
- Resolves with `UnknownHttpError` for other statuses of 400 or more.
- Accepts the same inputs as native `fetch`.
- Gives brand-based type guards for all error groups. The guards work across package copies.
- Keeps the original pre-response error in `cause`.
- Gives typed success and error body readers.
- Releases an unread error body with `cancel()`.

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

## Basic operation

**Purpose** — send a request and handle a failure.

**Action** — destructure `response` and `error` from the result. Check `error` first.

**Result** — one of the two values is non-null:

- A successful result has `response` and `error: null`.
- A failed result has `response: null` and `error`.

> WARNING: Read or cancel every HTTP error body. An unread body can keep its connection open.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { response, error } = await typedFetch<User[]>("/api/users");

if (error) {
  if (isHttpError(error)) {
    console.log(`HTTP ${error.status} ${error.statusText}`);
    await error.cancel();
  } else {
    console.log(`Request failed: ${error.message}`);
  }
} else {
  const users = await response.json(); // User[]
}
```

The `<User[]>` type sets the TypeScript result of `response.json()`. It does not validate the response data.

Use a runtime validator when the response data is not trusted. You can use Zod, Valibot, or a Standard Schema validator.

### POST request

```typescript
import { typedFetch, isHttpError, BadRequestError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string; email: string };

const { error } = await typedFetch<User>("/api/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "John", email: "john@example.com" }),
});

if (error instanceof BadRequestError) {
  const details = await error.json<{ field: string; message: string }>();
  console.log("Validation failed:", details);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

## Request failure decision table

Use this table to identify a failure and to decide what to do with its body.

| Condition                           | Error type         | Check                | Body action    |
| ----------------------------------- | ------------------ | -------------------- | -------------- |
| HTTP status has a dedicated class   | Known HTTP error   | `isKnownHttpError()` | Read or cancel |
| HTTP status has no dedicated class  | `UnknownHttpError` | `isHttpError()`      | Read or cancel |
| No HTTP response is available       | `NetworkError`     | `isNetworkError()`   | None           |
| A signal aborts the request         | `AbortedError`     | `isAbortError()`     | None           |
| A timeout signal aborts the request | `TimeoutError`     | `isTimeoutError()`   | None           |

`isKnownHttpError()` matches a subset of `isHttpError()`. Check `isKnownHttpError()` first when the code must narrow to one dedicated class.

`NetworkError`, `AbortedError`, and `TimeoutError` carry no response, so they have no body and no body methods.

```typescript
import {
  typedFetch,
  isKnownHttpError,
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (isKnownHttpError(error)) {
  console.log(`Known status ${error.status}`);
  await error.cancel();
} else if (isHttpError(error)) {
  console.log(`Unknown status ${error.status}`);
  await error.cancel();
} else if (isNetworkError(error)) {
  console.log("Connection failed:", error.message);
} else if (isAbortError(error)) {
  console.log("Request aborted");
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
}
```

NOTE: `typedFetch` treats only a status of 400 or more as an HTTP error. A response with status `0` stays on the success branch.

Browsers produce status `0` for an `opaque` response, an `opaqueredirect` response, and `Response.error()`. Check `response.ok` or `response.type` for these responses.

An opaque response body cannot be read. `Response.error().text()` resolves with `""`, and its `json()` rejects because the body is empty.

## HTTP error procedures

All HTTP error classes extend `BaseHttpError`. They give access to the response status, headers, and body.

### Identify a status with a type guard

**Condition** — the code can receive an error from another package copy.

One process can load more than one copy of a class. This occurs when code mixes ESM and CJS, or when code uses two package entry points.

Each package copy has a different class identity. Thus `instanceof` can return `false` for an error that another copy created.

The type guards use a `Symbol.for` brand. The brand works across package copies and module formats.

It also works across a realm that shares the original object, such as a same-origin `iframe` or a `node:vm` context. The object crosses by reference, so its prototype and its brand stay intact.

WARNING: The brand does not survive structured cloning. `structuredClone()` and `postMessage()` to a Worker rebuild the value as a plain `Error`. The subclass, the status, and the brand are all lost, so every guard returns `false`.

The brand sits on the class prototype and is not enumerable. Thus it never occurs in `JSON.stringify(error)`, in `{ ...error }`, or in a `for...in` loop.

| Check                            | Same package copy | Different package copies |
| -------------------------------- | ----------------- | ------------------------ |
| Type guards                      | Yes               | Yes                      |
| `error instanceof BaseHttpError` | Yes               | No                       |
| `error instanceof NotFoundError` | Yes               | No                       |

Use `instanceof` in an application that loads one package copy. Use the type guards in a library, or in code that can mix module formats.

The brand is not a security control. A value with a forged brand can pass a guard.

### Narrow a known status

`isHttpError()` narrows an error to `BaseHttpError`. Its `status` stays a `number`, because this group includes `UnknownHttpError`.

`isKnownHttpError()` excludes `UnknownHttpError`. TypeScript can then narrow each status to one dedicated class.

Use `isKnownHttpError()` with `switch (error.status)` to identify a specific status across package copies.

```typescript
import { typedFetch, isKnownHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { error } = await typedFetch<User>("/api/users/123");

if (isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      console.log("User not found"); // NotFoundError
      break;
    case 401:
      console.log("Log in first"); // UnauthorizedError
      break;
    default:
      // Keep this branch for a different package version.
      console.log(`HTTP ${error.status}`);
  }
  await error.cancel();
}
```

`isKnownHttpError()` checks the status map of the current package version. An older package copy rejects a status that only a newer copy knows.

### Identify a status with `instanceof`

**Condition** — the application loads one package copy.

```typescript
import {
  typedFetch,
  isHttpError,
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
  await error.cancel();
} else if (error instanceof UnauthorizedError) {
  console.log("Log in first");
  await error.cancel();
} else if (error instanceof NetworkError) {
  console.log("Network error:", error.message);
} else if (error instanceof AbortedError) {
  console.log("Request aborted");
} else if (error instanceof TimeoutError) {
  console.log("Request timed out");
} else if (isHttpError(error)) {
  await error.cancel();
}
```

### Handle an unknown status

`UnknownHttpError` represents a status of 400 or more when no dedicated class exists. Examples include 420 and 599.

Its `status` and `statusText` are not literal types. They reflect the values that the server sent.

```typescript
import { typedFetch, isHttpError, UnknownHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/legacy");

if (error instanceof UnknownHttpError) {
  console.log(error.status); // For example, 599.
  const body = await error.text();
  console.log(body);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

## Error body procedures

Every HTTP error carries a one-use body stream. Every error body needs a read or a cancel.

An unread body keeps the stream open. The open stream holds the connection open until the runtime collects it.

Code that logs only `error.message` and drops the error leaks one connection for each failed request.

### The three body actions

| Action                     | Effect on the transfer                    | Effect on the connection                                      |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Read the body              | Downloads the remaining bytes.            | The runtime can return the connection to the keep-alive pool. |
| Cancel the body            | Does not download the remaining bytes.    | The runtime can close the connection instead of returning it. |
| Release a `clone()` branch | Each branch needs its own read or cancel. | The platform releases the source after the last branch.       |

Read the body with `text()` when connection reuse is more important than the transfer. Cancel the body when avoiding the remaining transfer is more important than connection reuse.

### Read an error body

```typescript
import { typedFetch, isHttpError, BadRequestError } from "@pbpeterson/typed-fetch";

interface ApiError {
  message: string;
  code: string;
  fields?: Record<string, string>;
}

const { error } = await typedFetch("/api/users");

if (error instanceof BadRequestError) {
  const details = await error.json<ApiError>();
  console.log(details.message);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

The generic type of `error.json<T>()` is an unchecked TypeScript cast. It does not validate the body.

A body is a one-use stream. A second read rejects with `TypeError`. A read also rejects with `TypeError` when a reader holds the stream.

An empty or non-JSON body makes `json()` reject with `SyntaxError`. Many servers send an empty body or an HTML page for a 4xx or 5xx status. Use `text()` when the body format is not known.

Use `try`/`catch` for a body read when the data can be invalid. Do not use `try`/`catch` for the request: `typedFetch` resolves with the failure.

### Cancel an unread error body

**Purpose** — release a body when the content is not necessary.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (isHttpError(error)) {
  console.log(error.status);
  await error.cancel();
}
```

Without a `clone()`, the promise from `cancel()` stays pending until the body is released. It resolves after the release.

`cancel()` resolves when the response has no body. It also resolves after a complete body read.

`cancel()` resolves when other code already read the body. This occurs when a custom Fetch implementation gives you its own `Response`.

`cancel()` resolves when the body stream failed. A truncated response, or a connection reset during the body transfer, puts the stream in a failed state. The stream released its source at that moment, so nothing remains to release. The failure gives you no information that you can act on.

`cancel()` rejects with `TypeError` when an external reader holds the stream and read nothing from it. Release that reader first, then cancel through it. This is the only condition that makes `cancel()` reject.

A repeated `cancel()` on the same error settles with the same outcome as the first call. It never reports success before the first call settles.

NOTE: Bun reports a body as used as soon as `getReader()` locks the stream. Node, Deno, and workerd keep that state unused until the stream is disturbed. On Bun a bare reader lock is indistinguishable from a consumed body, so `cancel()` resolves instead of rejecting.

After a `cancel()`, the four body readers reject with `TypeError`. `clone()` is synchronous, and it throws `TypeError`.

### Read one body two times

> CAUTION: Call `clone()` before the first body read.

`clone()` tees the body stream. The platform releases the source only after the release of every branch.

Thus `cancel()` on one branch stays pending until the other branch is also read or canceled. Release every branch:

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (isHttpError(error)) {
  const copy = error.clone();

  const json = await error.json();
  const text = await copy.text();

  console.log(json, text);
}
```

Cancel both branches when neither content is necessary:

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("/api/users/123");

if (isHttpError(error)) {
  const copy = error.clone();

  await Promise.all([error.cancel(), copy.cancel()]);
}
```

`cancel()` on one branch never cancels the other branch. Each branch has its own owner, and each owner releases its own branch.

This behavior is the native `ReadableStream` behavior. The library keeps it deliberately: an early resolution would report a release that did not happen.

## Network failure, abort, and timeout procedures

Three error classes represent a failure before an HTTP response:

| Class          | Cause                                              | Guard              |
| -------------- | -------------------------------------------------- | ------------------ |
| `NetworkError` | DNS failure, refused connection, or redirect error | `isNetworkError()` |
| `AbortedError` | `AbortController.abort()` aborted the request      | `isAbortError()`   |
| `TimeoutError` | `AbortSignal.timeout()` aborted the request        | `isTimeoutError()` |

Each class keeps the original Fetch error in `cause`. `AbortedError` and `TimeoutError` do not extend `NetworkError`, so `isNetworkError()` is `false` for both.

Each of these errors also has a `url` value. Use this value to identify a failed request among concurrent requests.

### Network failures

`NetworkError` also represents an error that occurs before a network connection. Examples include an invalid URL, a forbidden method, and an invalid header name.

These input errors are permanent. A DNS failure, a refused connection, and a reset connection are transient. `NetworkError` covers both kinds, and it does not tell you which one you hold.

No portable test separates them. `error.cause` holds the rejection that `fetch` produced, and that rejection is a `TypeError` for every kind of failure, so a `cause instanceof TypeError` check answers `true` in all of them. The platforms diverge further: on Deno every failure in this section arrives as a bare `TypeError` that carries no `cause` and no error code.

Put the retry policy in a layer that knows the request. That layer knows whether the URL is a constant of the program or a value that a user supplied, which is the fact that decides a retry.

```typescript
import {
  typedFetch,
  isNetworkError,
  isAbortError,
  isTimeoutError,
  isHttpError,
} from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://unreachable.example");

if (isNetworkError(error)) {
  console.log("Connection failed:", error.message);
  console.log(error.cause);
} else if (isAbortError(error)) {
  console.log("Request aborted");
  console.log(error.reason);
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
} else if (isHttpError(error)) {
  await error.cancel();
}
```

### Abort classification

The request signal controls the abort classification. The name of the rejected error does not control it.

The signal can be in `options.signal` or in a `Request` input. An options signal has priority over the signal in a `Request`.

An explicit `signal: null` detaches the signal in a `Request`. An absent or `undefined` signal does not detach it.

`typedFetch` resolves with an `AbortedError` when the signal reports an abort and one of these conditions is true:

- The rejected value is the signal reason itself. This is the normal path on a spec-compliant runtime, and it holds for any reason value.
- The rejected value is error-shaped and has the name `"AbortError"` or `"TimeoutError"`. This path covers a custom Fetch implementation that rejects with its own abort error instead of the signal reason.

An aborted signal alone is not sufficient. `typedFetch` resolves with a `NetworkError` when the rejection is unrelated to the abort. A `CONNECT` method or an invalid header name throws a `TypeError` during `Request` construction while the signal already reports an abort.

An error with the name `"AbortError"` stays a `NetworkError` when no signal reports an abort.

### Abort a request and read the reason

You can give a reason to `AbortController.abort()`.

```typescript
import { typedFetch, isAbortError, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const controller = new AbortController();
const promise = typedFetch<User[]>("/api/users", { signal: controller.signal });

controller.abort(new Error("route change"));

const { error } = await promise;

if (isAbortError(error) && error.reason instanceof Error) {
  console.log(error.reason.message);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

`error.reason` is the exact value from `controller.abort(reason)`. Its type is `unknown`, so check its type before use.

When you call `controller.abort()` without a reason, the platform supplies an `AbortError` `DOMException`.

### Timeouts

Use the standard `AbortSignal.timeout()` API. `typedFetch` resolves with a `TimeoutError` for this signal.

```typescript
import { typedFetch, isTimeoutError, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});

if (isTimeoutError(error)) {
  console.log("Request timed out after 5 seconds");
} else if (isHttpError(error)) {
  await error.cancel();
}
```

A timeout requires a `DOMException` with the name `"TimeoutError"`. `AbortSignal.timeout()` supplies this value.

A plain `Error` with the same name does not create a timeout. `typedFetch` resolves with an `AbortedError` and keeps that value in `reason`.

The library classifies the timeout from the signal reason first, and from the rejection second. Thus `typedFetch` still resolves with a `TimeoutError` for `AbortSignal.timeout()` under a custom Fetch implementation that rejects with its own abort error.

### Manual abort with a deadline

Use `AbortSignal.any()` when the code needs a manual abort and a deadline together.

```typescript
import { typedFetch, isAbortError, isTimeoutError, isHttpError } from "@pbpeterson/typed-fetch";

const controller = new AbortController();

const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);

const promise = typedFetch("/api/users", { signal });

controller.abort(new Error("route change"));

const { error } = await promise;

if (isAbortError(error)) {
  console.log("Request aborted:", error.reason);
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
} else if (isHttpError(error)) {
  await error.cancel();
}
```

The first signal that aborts decides the result. A manual abort resolves with `AbortedError`. The deadline resolves with `TimeoutError`.

`AbortSignal.any()` requires Node 20.3 or a later version. The package floor is Node 20, so this procedure is not available on Node 20.0 to 20.2.

On those versions, use one signal. Give `AbortSignal.timeout()` for a deadline, or a controller signal for a manual abort.

You can also combine the two manually. Make one controller, and abort it from a timer and from your own code:

```typescript
import { typedFetch, isAbortError, isHttpError } from "@pbpeterson/typed-fetch";

const controller = new AbortController();

const timer = setTimeout(() => controller.abort(new Error("deadline")), 5000);

const { error } = await typedFetch("/api/users", { signal: controller.signal });

clearTimeout(timer);

if (isAbortError(error)) {
  console.log("Request aborted:", error.reason);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

This form resolves with `AbortedError` for both cases. Read `error.reason` to identify the deadline.

## API reference

### `typedFetch<T>(url, options?)`

`T` sets the TypeScript result of `response.json()`. It does not validate the response data.

`url` accepts the same resource input as native `fetch`.

`options` extends `RequestInit`. It gives autocomplete for common request headers and methods, and it accepts every string that native Fetch accepts.

The optional `fetch` property sets a custom Fetch implementation. Use it for tests, dependency injection, or a custom agent.

When `options` has no custom `fetch` property, `typedFetch` gives the original object to native `fetch` without a change.

When `options` has a custom `fetch` property, `typedFetch` removes that property before it calls the implementation. It keeps the prototype, the inherited properties, and the WebIDL getters, because `fetch` reads `RequestInit` as a WebIDL dictionary.

A custom Fetch implementation is not trusted input. `typedFetch` inspects the resolved value inside the result envelope. When a read of `status` or `url` on that value throws, `typedFetch` resolves with a `NetworkError` that holds the original error in `cause`.

NOTE: A resolved value that is not a `Response` but answers a `status` read does not become a `NetworkError`. `typedFetch` compares `status` to 400, so a value without a numeric `status` stays on the success branch.

You can give a `Request` in the `url` position. `typedFetch` keeps its method, headers, signal, and Node.js body.

Do not give a body-carrying `Request` in the `options` position. Browsers reject this form because WebIDL requires `duplex`.

An augmented `Request` in the `options` position can carry a `fetch` property. The sanitized view keeps its WebIDL fields and hides the custom property.

`typedFetch` resolves with this union:

```typescript
import type { TypedResponse, TypedFetchError } from "@pbpeterson/typed-fetch";

type Result<T> = Promise<
  { response: TypedResponse<T>; error: null } | { response: null; error: TypedFetchError }
>;
```

The `error` value has the full `TypedFetchError` union. Use the type guards or `instanceof` to narrow it.

### `isHttpError(error): error is BaseHttpError`

This guard identifies all HTTP errors. It works across package copies and module formats.

It also accepts a consumer subclass of `BaseHttpError`.

### `isKnownHttpError(error): error is ClientErrors | ServerErrors`

This guard identifies the dedicated HTTP error classes of the library. It excludes `UnknownHttpError` and a consumer subclass of `BaseHttpError`.

The guard checks the status map of the current package version. An older package copy rejects a status that only a newer copy knows.

Use this guard before a status switch that must narrow to one dedicated class.

### `isNetworkError(error): error is NetworkError`

This guard identifies a `NetworkError`. It does not identify an `AbortedError` or a `TimeoutError`.

### `isAbortError(error): error is AbortedError`

This guard identifies a request that an `AbortSignal` aborted.

### `isTimeoutError(error): error is TimeoutError`

This guard identifies a request that `AbortSignal.timeout()` aborted.

### Exported types

The package exports public types for a typed wrapper:

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
- `HttpMethods` gives method suggestions. It omits `CONNECT` and `TRACE`, because the Fetch specification forbids them and native `fetch` throws a `TypeError` for them.
- `ClientErrors` is the union of the dedicated 4xx errors.
- `ServerErrors` is the union of the dedicated 5xx errors.
- `TypedFetchError` is the union of all error types that `typedFetch` resolves with.

`api<T>()` resolves with the whole result and transfers it to its caller. The caller then owns the error body, and the caller must read or cancel it.

Import only the error classes from `@pbpeterson/typed-fetch/errors` when you do not need `typedFetch`.

The `headers` and `method` types give autocomplete only. They do not validate a name or a value.

For example, an invalid content type or a misspelled header name still type-checks. The union ends in an open string type, and native Fetch accepts the underlying string record.

### Error class API

All HTTP error classes extend `BaseHttpError`.

A dedicated class uses literal types for `status` and `statusText`.

Instance properties:

- `status`: The HTTP status code.
- `statusText`: The canonical protocol label from the library.
- `url`: The response URL.
- `headers`: A copy of the response headers.
- `name`: The error class name.

`statusText` does not copy the reason phrase from the server. The reason phrase, when the server sends one, occurs in `error.message`.

`headers` is a copy, not the `Headers` object of the response. A write through `error.headers` never reaches the response. The copy keeps every header, including a repeated `set-cookie`.

Instance methods:

- `json<T = unknown>()`: Read the body as JSON.
- `text()`: Read the body as text.
- `blob()`: Read the body as a `Blob`.
- `arrayBuffer()`: Read the body as an `ArrayBuffer`.
- `cancel(reason?)`: Release the body without a read. After a `clone()`, release every branch.
- `clone(recreate?)`: Clone the error before the first body read.
- `toJSON()`: The record that `JSON.stringify(error)` produces.

The four readers are asynchronous, so a missing body rejects. `clone()` is the deliberate exception: it is synchronous, and it throws.

Do not call `clone()` after you read the body, after you cancel the body, or while a reader holds the stream. The method throws `TypeError`.

A failed `clone()` releases the branch that it made. Thus a later `cancel()` on the original error still completes.

Each dedicated class also has static `status` and `statusText` properties. For example, `NotFoundError.status` is `404`.

#### Serialize an error

An `Error` keeps `message` and `stack` as non-enumerable properties. A structured logger that serializes one therefore records everything except the message line. `toJSON()` supplies the record instead, so `JSON.stringify(error)` is complete.

The record of an HTTP error is `{ name, message, status, statusText, url, headers }`:

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://example.test/users/1");

if (isHttpError(error)) {
  console.log(JSON.stringify(error));
  // {"name":"NotFoundError","message":"HTTP 404 Not Found (https://example.test/users/1)",
  //  "status":404,"statusText":"Not Found","url":"https://example.test/users/1",
  //  "headers":[["content-type","application/json"]]}
  await error.cancel();
}
```

`headers` is a list of `[name, value]` pairs, not an object. A response can carry more than one `set-cookie` header, and an object keeps only the last one. The pair list is also a valid `HeadersInit`, so `new Headers(record.headers)` rebuilds the same headers.

The body and the stack are absent on purpose. The body is a single-use stream, and a read of it is asynchronous. The stack can carry local file paths of the process. Read `error.stack` when you want it.

#### Clone a consumer subclass

A built-in error does not need a recreation callback. A consumer subclass can also call `clone()` without a callback.

The no-callback form uses only the cloned `Response`. It cannot preserve other constructor state. A subclass constructor that takes more arguments receives `undefined` for them.

Give a callback when a consumer subclass holds other state:

```typescript
import { BaseHttpError } from "@pbpeterson/typed-fetch";

class TenantHttpError extends BaseHttpError {
  override readonly name = "TenantHttpError" as const;
  readonly status = 499 as const;
  readonly statusText = "Tenant Error" as const;

  constructor(
    response: Response,
    readonly tenant: string,
  ) {
    super(response);
  }
}

const error = new TenantHttpError(new Response("{}", { status: 499 }), "acme");

const copy = error.clone((response) => new TenantHttpError(response, error.tenant));

console.log(copy.tenant); // "acme"

await Promise.all([error.cancel(), copy.cancel()]);
```

The callback must give a new error. `clone()` throws `TypeError` when the callback gives the same error, because one instance cannot own two branches.

`clone()` wraps a failure of the callback in a `TypeError`. The no-callback form rethrows a failure of the subclass constructor without a change.

### `NetworkError`, `AbortedError`, and `TimeoutError`

These classes represent a failure before an HTTP response. They do not extend `BaseHttpError`, and they have no body methods.

All three classes have `message`, `cause`, and `url`. Thus code can read `error.url` from every member of `TypedFetchError`.

`AbortedError` also has `reason`.

The `url` value is an empty string when `typedFetch` cannot resolve the request URL.

The `reason` value has type `unknown`. Check its type before use.

The default `message` values are `"Network error"`, `"Request aborted"`, and `"Request timed out"`.

All three classes define `toJSON()`. The record is `{ name, message, url }`.

`cause` and `reason` are absent from the record on purpose. The cause holds the platform error that failed the request, and its chain carries transport detail, such as local and remote addresses and ports. The reason is the value that the caller passed to `controller.abort(reason)`, and it can be any value. Read either one from the error when you want it.

`cause` and `reason` are not enumerable, which matches `new Error(message, { cause })`. They do not occur in `JSON.stringify(error)`, in `{ ...error }`, or in `Object.keys(error)`. Reading `error.cause`, `error.reason`, and `"cause" in error` is unchanged, and both properties stay writable.

## Available error classes

<details>
<summary><strong>4xx client errors</strong> (29 classes of 40)</summary>

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
<summary><strong>5xx server errors</strong> (11 classes of 40)</summary>

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
| `AbortedError`     | Request aborted by `AbortController.abort()`    |
| `TimeoutError`     | Request aborted by `AbortSignal.timeout()`      |
| `BaseHttpError`    | Abstract base class for HTTP errors             |

## Limitations and non-goals

### Limitations

- `instanceof` is reliable only inside one package copy. Use the type guards across a package or format boundary. The library does not solve `instanceof` for a specific subclass across copies.
- The brand is not a security control. A forged brand passes a guard.
- `error.json<T>()` and `response.json<T>()` are unchecked compile-time casts. They perform no runtime validation.
- The `headers` and `method` types give autocomplete only. They validate no name and no value.
- A status of `0` stays on the success branch. Check `response.ok` or `response.type` for an opaque response.
- `AbortSignal.any()` requires Node 20.3 or a later version.
- Body semantics follow the runtime. On Bun a bare reader lock reports the body as used, so `cancel()` resolves instead of rejecting.

### Non-goals

This library does not include these features:

- Retries. Put the retry policy in a separate layer.
- Interceptors, hooks, or middleware. Wrap `typedFetch` in your code.
- Base URL or instance configuration. Write a small wrapper function.
- A query-string builder. Use `URL` and `URLSearchParams`.
- Request-body serialization. Give `body` and `headers` as native Fetch inputs.
- Response caching. Use a cache layer.
- Required runtime validation. The package can add an optional Standard Schema hook in a later release.
- A `rawStatusText` field. Read the reason phrase from `error.message`.
- Eager body buffering. Body readers keep the native streaming behavior.

## Semantic version contract

1. A new dedicated class in `ClientErrors` or `ServerErrors` requires a major release. It replaces `UnknownHttpError` for that status and widens the error union.
2. The human-readable `error.message` text is diagnostic. It can change in any release.
3. The canonical `statusText` value is public API. A change to it requires a major release.
4. Status 418 keeps `"I'm a teapot"`. Status 510 keeps `"Not Extended"`.
5. A removed or renamed export requires a major release.
6. A change to a `status` literal requires a major release.
7. A matching `vX.Y.Z` Git tag must start each npm release.
8. Node.js 20 is the minimum version. A higher minimum requires a major release.

Keep a `default` branch in a known-status switch. A newer package version can move a status from `UnknownHttpError` to a dedicated class, and the `default` branch keeps that code correct.

Read [`RELEASING.md`](https://github.com/pbpeterson/typed-fetch/blob/main/RELEASING.md) for the release procedure.

## Contribution and license

Read [`CONTRIBUTING.md`](https://github.com/pbpeterson/typed-fetch/blob/main/CONTRIBUTING.md) before you make a pull request.

That document gives the setup instructions, the required checks, and the procedure to add an HTTP status class.

The license is MIT. Read [`LICENSE`](./LICENSE).
