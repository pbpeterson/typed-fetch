# @pbpeterson/typed-fetch

[![CI](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/pbpeterson/typed-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40pbpeterson%2Ftyped-fetch)](https://www.npmjs.com/package/@pbpeterson/typed-fetch)
[![license](https://img.shields.io/npm/l/%40pbpeterson%2Ftyped-fetch)](https://github.com/pbpeterson/typed-fetch/blob/main/LICENSE)

## Purpose

`typed-fetch` is a type-safe HTTP client for TypeScript. It uses the native Fetch API. It has no runtime dependencies.

Native `fetch` does not reject a request for an HTTP error status. The calling code must check `response.ok` after each request.

`typedFetch` checks the status. It resolves with a discriminated union that holds a response or a typed error.

`typedFetch` does not reject for an HTTP status, a network failure, an abort, or a timeout. It resolves with these failures in `error`.

Body readers are separate operations. `json()`, `text()`, `blob()`, and `arrayBuffer()` keep the native Fetch behavior, and they can reject.

### Upgrade from 1.x

Version 2.0 has breaking changes. Most affect runtime behavior. They reach a
consumer through logging, `clone()`, or a custom Fetch implementation.

- **`headers`, `url`, `cause`, and `reason` are no longer enumerable.** A log built from `{ ...error }` loses them. Call `error.toJSON()`, or read each field by name.
- **`error.headers` is a copy.** A write through it no longer reaches the response.
- **`clone(recreate)` refuses a callback result that cannot own the cloned body branch.**
  This includes a non-object, a wrapper, a different response, and an
  unconfirmed copy. Return the new error itself.
- **A custom Fetch implementation must resolve with a compatible `Response`.**
  A partial test double resolves with a `NetworkError`. The identity module
  records the first successful read of each field. A modified platform
  `Response` must expose the same compatible surface.
- **`TypedResponse` uses a stable Fetch baseline.** It no longer inherits new
  members from the ambient `Response` type.
- **`TypedFetchOptions["headers"]` rejects `undefined` as a header value.**
  Write `...(token ? { Authorization: token } : {})`.

The migration table is in
[CHANGELOG.md](https://github.com/pbpeterson/typed-fetch/blob/main/CHANGELOG.md#200---2026-07-26).
Read the `1.1.0` section too. That version was never published. A consumer
therefore upgrades from `1.0.0` to `2.0.0` through both change sets.

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

| Term                  | Meaning                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| resolves with         | A promise finishes normally and supplies a value.                                                                                      |
| rejects               | A promise finishes with an error.                                                                                                      |
| throws                | A synchronous operation raises an exception.                                                                                           |
| abort the request     | An `AbortSignal` stops a request.                                                                                                      |
| cancel the error body | `error.cancel()` releases the body of an HTTP error.                                                                                   |
| read the error body   | `json()`, `text()`, `blob()`, or `arrayBuffer()` consumes the body.                                                                    |
| known HTTP error      | A status code that has a dedicated error class.                                                                                        |
| unknown HTTP error    | A status code of 400 or more with no dedicated class. `UnknownHttpError` represents it.                                                |
| package copy          | One loaded instance of this package in a process.                                                                                      |
| reason phrase         | The status text that the server sends on the wire. It can differ from the library's `statusText`.                                      |
| error record          | The plain object that `error.toJSON()` returns. `JSON.stringify(error)` writes it, and `console.log(error)` prints it below the stack. |

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

Use Node.js 20.13.0 or later.

You can also use a browser, Deno, Bun, or an edge runtime with native Fetch.

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

> WARNING: Read or cancel every body you receive, on success as well as on failure. An unread body can keep its connection open.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { response, error } = await typedFetch<User[]>("https://api.example.com/users");

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

NOTE: Every example uses an absolute URL. A relative URL resolves against a document base, which exists in a browser and does not exist on Node. `fetch("/api/users")` rejects on Node with `TypeError: Failed to parse URL`.

The `<User[]>` type sets the TypeScript result of `response.json()`. It does not validate the response data.

Use a runtime validator when the response data is not trusted. You can use Zod, Valibot, or a Standard Schema validator.

### POST request

```typescript
import { typedFetch, isHttpError, BadRequestError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string; email: string };

const { error } = await typedFetch<User>("https://api.example.com/users", {
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

const { error } = await typedFetch("https://api.example.com/users/123");

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

`headers` and `url` are also not enumerable, which matches how the platform defines `Error.cause`. They do not occur in `{ ...error }`, in `Object.keys(error)`, or in a `for...in` loop. Reading `error.headers` and `error.url` is unchanged, and both stay writable.

They are hidden for two reasons. A logger that walks an error's own enumerable properties would otherwise record every header value and the full request URL. Node's crash output for an uncaught error walks exactly those properties and ignores every formatting hook, so enumerability is the only control over that channel.

`Object.keys(error)` on an HTTP error returns `["name", "status", "statusText"]`. Call `error.toJSON()` for the record.

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

const { error } = await typedFetch<User>("https://api.example.com/users/123");

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

const { error } = await typedFetch<User>("https://api.example.com/users/123");

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

const { error } = await typedFetch("https://api.example.com/legacy");

if (error instanceof UnknownHttpError) {
  console.log(error.status); // For example, 599.
  const body = await error.text();
  console.log(body);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

## Body procedures

Every response body is a one-use stream, on success and on failure. Every body needs a read or a cancel.

An unread body keeps the stream open. The open stream holds the connection open until the runtime collects it.

Code that logs only `error.message` and drops the error leaks one connection for each failed request. Code that discards a successful result without reading it leaks one connection for each successful request.

### The size dependence

A small body is fully buffered by the runtime, and it releases its connection on its own. A large one does not. The threshold is an internal buffer size, so the same code can be correct in a test and leak in production.

Measured on Node 20.15.0, with ten sequential requests to a local server. The number is the count of TCP connections the server accepted. Ten means every request opened its own connection.

| Body size | Body untouched, status 200 | Body untouched, status 500 |
| --------- | -------------------------- | -------------------------- |
| 512 B     | 2                          | 2                          |
| 8 KB      | 2                          | 2                          |
| 16 KB     | 10                         | 10                         |
| 32 KB     | 10                         | 10                         |
| 64 KB     | 10                         | 10                         |
| 1 MB      | 10                         | 10                         |

Success and failure behave the same way. The threshold sits between 8 KB and 16 KB on this runtime, and it is different on another one.

The same harness, with a 1 MB body, measures the two release actions:

| Action                          | Connections |
| ------------------------------- | ----------- |
| `await response.text()`         | 2           |
| `await response.body?.cancel()` | 12          |

A read preserves connection reuse. A cancel releases the body without downloading it, and the runtime then closes the connection instead of returning it to the pool.

### Release a success body

`typedFetch` hands you the `Response` and never reads it, so the success body is yours. Read it, or cancel it.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const { response, error } = await typedFetch<User>("https://api.example.com/users/1");

if (isHttpError(error)) {
  await error.cancel();
} else if (error) {
  console.log(error.message);
} else {
  await response.body?.cancel();
}
```

`TypedResponse` has no `cancel()` method. This asymmetry with `error.cancel()` is deliberate. An HTTP error is this library's own object, so it can own the lifecycle of its body. A success `Response` belongs to the Fetch implementation, and this library returns the same object unmodified.

### Own the body lifecycle in one module

**Purpose** — make the obligation impossible for a caller to forget.

Wrap `typedFetch` once, in one module, and let that module release every body. A caller then receives data or a plain failure record, and it owns no stream.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";
import type { TypedFetchOptions } from "@pbpeterson/typed-fetch";

const BASE_URL = "https://api.example.com";

type ApiFailure = { name: string; status: number | null; body: string };

type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiFailure };

function mergeHeaders(caller: TypedFetchOptions["headers"]): Headers {
  const merged = new Headers({ Accept: "application/json" });
  for (const [name, value] of new Headers(caller)) merged.set(name, value);
  return merged;
}

export async function api<T>(path: string, options?: TypedFetchOptions): Promise<ApiResult<T>> {
  const { response, error } = await typedFetch<T>(`${BASE_URL}${path}`, {
    ...options,
    headers: mergeHeaders(options?.headers),
  });

  if (isHttpError(error)) {
    const body = await error.text().catch(() => "");
    return { data: null, error: { name: error.name, status: error.status, body } };
  }

  if (error) {
    return { data: null, error: { name: error.name, status: null, body: "" } };
  }

  return { data: await response.json(), error: null };
}
```

Three rules make this module correct.

- It reads every error body, so no caller can hold one. It uses `catch` on the read, because a body read can reject.
- It reads every success body through `response.json()`, so no success stream stays open.
- It merges headers with `new Headers(caller)`. A spread does not work.
  `{ ...options?.headers }` produces `{}` for a `Headers` instance. That class
  has no enumerable own properties. `new Headers(options?.headers)` accepts
  every supported form without a cast.

The spread of `options` keeps an own `fetch` property, which is the form `typedFetch` reads. Read "API reference" for that rule.

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

const { error } = await typedFetch("https://api.example.com/users");

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

const { error } = await typedFetch("https://api.example.com/users/123");

if (isHttpError(error)) {
  console.log(error.status);
  await error.cancel();
}
```

Without a `clone()`, the promise from `cancel()` stays pending until the body is released. It resolves after the release.

`cancel()` resolves when the response has no body. It also resolves after a complete body read.

`cancel()` resolves when other code already read the body. This occurs when a custom Fetch implementation gives you its own `Response`.

`cancel()` resolves when the body stream failed. A truncated response, or a connection reset during the body transfer, puts the stream in a failed state. The stream released its source at that moment, so nothing remains to release. The failure gives you no information that you can act on.

`cancel()` rejects with `TypeError` in two conditions, and in no other.

1. An external reader holds the stream and read nothing from it. Release that reader first, then cancel through it.
2. The error carries no response, because the constructor never initialized it. A hand-built object with the right shape is assignable to `BaseHttpError`. The four body readers reject it, and `clone()` throws for the same reason. Build an error with `new NotFoundError(response)`, or call `super(response)` in a subclass constructor.

A repeated `cancel()` on the same error settles with the same outcome as the first call. It never reports success before the first call settles.

NOTE: Bun reports a body as used as soon as `getReader()` locks the stream. Node, Deno, and workerd keep that state unused until the stream is disturbed. On Bun a bare reader lock is indistinguishable from a consumed body, so `cancel()` resolves instead of rejecting.

After a `cancel()`, the four body readers reject with `TypeError`. `clone()` is synchronous, and it throws `TypeError`.

### Read one body two times

> CAUTION: Call `clone()` before the first body read.

`clone()` tees the body stream. The platform releases the source only after the release of every branch.

Thus `cancel()` on one branch stays pending until the other branch is also read or canceled. Release every branch:

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://api.example.com/users/123");

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

const { error } = await typedFetch("https://api.example.com/users/123");

if (isHttpError(error)) {
  const copy = error.clone();

  await Promise.all([error.cancel(), copy.cancel()]);
}
```

`cancel()` on one branch never cancels the other branch. Each branch has its own owner, and each owner releases its own branch.

This behavior is the native `ReadableStream` behavior. The library keeps it deliberately: an early resolution would report a release that did not happen.

## Network failure, abort, and timeout procedures

Three error classes represent a request attempt that produces no usable HTTP
response:

| Class          | Cause                                               | Guard              |
| -------------- | --------------------------------------------------- | ------------------ |
| `NetworkError` | Request failure or incompatible custom Fetch result | `isNetworkError()` |
| `AbortedError` | `AbortController.abort()` aborted the request       | `isAbortError()`   |
| `TimeoutError` | `AbortSignal.timeout()` aborted the request         | `isTimeoutError()` |

For a rejected request, each class keeps the original Fetch error in `cause`.
For an incompatible resolved value, `NetworkError.cause` holds the validation
or inspection failure.

`AbortedError` and `TimeoutError` do not extend `NetworkError`, so
`isNetworkError()` is `false` for both.

Each of these errors also has a `url` value. Use this value to identify a failed request among concurrent requests.

`error.url` holds the full href. For a hierarchical URL, the `toJSON()` record
holds the origin and path. It removes userinfo, query strings, and fragments.

WARNING: `error.message` for a request failure is a library constant, such as
`Network error`. This library does not copy the platform's message, because a
platform reports a request it refused by quoting the caller's value back: a
header value, the URL, the referrer, or the method. `error.cause` holds the
platform error, unmodified. Decide what a log line may carry before you copy
`error.cause` into one.

The path is kept because it names the resource, which is what tells concurrent
failures apart. That holds for `http:`, `https:`, `ws:`, `wss:`, `ftp:`, and
`file:`. An opaque scheme carries its payload in the path instead. The redactor
therefore keeps only `data:` or `blob:`.

### Network failures

`NetworkError` also represents an error that occurs before a network connection. Examples include an invalid URL, a forbidden method, and an invalid header name.

A custom Fetch implementation can also produce `NetworkError` after it
resolves. This happens when its value does not satisfy the response contract or
an identity getter throws. The library releases any reachable body first.

These input errors are permanent. A DNS failure, a refused connection, and a reset connection are transient. `NetworkError` covers both kinds, and it does not tell you which one you hold.

For rejected requests, no portable test separates permanent and transient
failures. `error.cause` holds the Fetch rejection. Every kind can produce a
`TypeError`, so `cause instanceof TypeError` does not classify the failure.

The platforms diverge further. On Deno, these failures use a bare `TypeError`
without a `cause` or error code.

Put the retry policy in a layer that knows the request. That layer can
distinguish a program constant from user input. This distinction decides
whether to retry.

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

`typedFetch` captures the signal state before it resolves the failure URL or inspects request headers. Caller code in those operations cannot reclassify an earlier failure.

An error with the name `"AbortError"` stays a `NetworkError` when no signal reports an abort.

### Abort a request and read the reason

You can give a reason to `AbortController.abort()`.

```typescript
import { typedFetch, isAbortError, isHttpError } from "@pbpeterson/typed-fetch";

type User = { id: number; name: string };

const controller = new AbortController();
const promise = typedFetch<User[]>("https://api.example.com/users", { signal: controller.signal });

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

const { error } = await typedFetch<User[]>("https://api.example.com/users", {
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

const promise = typedFetch("https://api.example.com/users", { signal });

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

`AbortSignal.any()` requires Node.js 20.3.0 or later. The package floor is Node.js 20.13.0, so this procedure is available on every supported version.

On an older runtime, use one signal. Give `AbortSignal.timeout()` for a deadline, or a controller signal for a manual abort.

You can also combine the two manually. Make one controller, and abort it from a timer and from your own code:

```typescript
import { typedFetch, isAbortError, isHttpError } from "@pbpeterson/typed-fetch";

const controller = new AbortController();

const timer = setTimeout(() => controller.abort(new Error("deadline")), 5000);

const { error } = await typedFetch("https://api.example.com/users", { signal: controller.signal });

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

The `method` and `headers` slots replace the native ones. They do not intersect with them. An intersection with `RequestInit["method"]`, which the platform types as `string`, collapses the union and suggests nothing.

`method` suggests seven values: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`.

The optional `fetch` property sets a custom Fetch implementation. Use it for tests, dependency injection, or a custom agent.

`typedFetch` reads `fetch` as an own property of `options`. A `fetch` that arrives through the prototype chain is ignored, and the request goes to the global `fetch`. Set the property with `{ ...options, fetch }` or with `Object.assign(options, { fetch })`. A `fetch` method on the prototype of a class you pass as `options` is not used.

This rule differs from every other option. `method`, `headers`, `body`, and
`signal` are WebIDL dictionary members. The platform reads them through the
prototype chain. `typedFetch` preserves that behavior for all four members.

`typedFetch` reads `signal` once. It materializes that value in the
`RequestInit` given to the transport. Classification and transport therefore
use the same signal.

`typedFetch` does not read `headers`. The transport is the only reader of that
slot, so a header getter runs once, as it does under a bare `fetch`.

`typedFetch` serializes the request input once. A `string` or a `URL` reaches
the transport as the string this library produced, and `error.url` holds that
same string. A `Request` reaches the transport unchanged, because it carries a
body, a signal, and internal slots that no string can stand for.

`fetch` is this library's extension. It selects the transport.

A single `Object.prototype.fetch = …` write anywhere in the process would otherwise redirect every request in it. That includes a call that passes no options object at all. The write would also hand the caller's `Authorization` header to whoever performed it.

Before the request, `typedFetch` creates a proxy that keeps the original
prototype and property descriptors. Reads delegate to the original object.
This preserves inherited properties and WebIDL getters.

When `options` has an own `fetch`, the proxy hides that property from the
implementation. The proxy replaces a `signal` read with the captured value.

`fetch` names `undefined` explicitly, so a value of type `typeof fetch | undefined` assigns to it under `exactOptionalPropertyTypes`.

```typescript
import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";

declare const injected: typeof fetch | undefined;

const { error } = await typedFetch("https://api.example.com/users", { fetch: injected });

if (isHttpError(error)) await error.cancel();
```

The other optional members do not name `undefined`. Under that flag,
`{ method: maybeString }` and `{ body: maybeBody }` still fail with TS2379. The
second is native `RequestInit` behavior.

A custom Fetch implementation is not trusted input. It must resolve with a
platform `Response` or a standards-compatible polyfill. A partial test double
or another value resolves with a `NetworkError` whose `cause` is a `TypeError`.

`typedFetch` accepts a platform `Response` through the platform's `status`
getter. A foreign implementation must tag itself `[object Response]`.

The visible response must include `body`, `bodyUsed`, `headers`, `ok`,
`redirected`, `status`, `statusText`, `type`, and `url`. Required methods include
`arrayBuffer`, `blob`, `clone`, `formData`, `json`, and `text`. The same checks
catch own properties or a replaced prototype that hides a platform response's
native surface.

Every response must report `bodyUsed` as a boolean. Before a success can escape,
`ok` and `redirected` must also be booleans, `status` must be a number,
`statusText` and `url` must be strings, and `type` must be a standard response
type. A mismatch resolves with `NetworkError`.

Before success, the `headers` value must expose the standard iterable `Headers`
operations, `getSetCookie()` among them: the success type names the ambient
`Headers`, so a member the type promises must be a member the value carries. A
standards-compatible polyfill without `getSetCookie` is refused on the success
path. The method has been on `Headers.prototype` since Node 20.0.0, and in
Chrome 113, Safari 17, and Firefox 112. An HTTP error can instead normalize any
`HeadersInit` that the platform's `Headers` constructor accepts. The body must
be `null` or a WHATWG `ReadableStream` on both paths.

These members form the stable `TypedResponse` baseline. The runtime value may
expose newer Fetch members, but the public type does not promise them.

Validation describes the handoff moment. `typedFetch` returns the same response
object; it does not freeze it or put it behind a Proxy. A custom implementation
that changes a validated getter or member afterwards violates the response
contract, just as one that mutates the object after returning it does.

When validation rejects a modified platform response, cleanup bypasses a
shadowed `body` or stream `cancel` member through captured platform operations.
This releases the body when the native slots remain reachable. Cleanup stays
best effort when a hostile object also refuses prototype inspection or repair.

`node-fetch` and `cross-fetch` use a Node stream in Node.js. They also omit
required members. `whatwg-fetch` exposes no WHATWG body stream. These
implementations do not satisfy the response contract.

`typedFetch` inspects the response inside the result envelope. If an identity
getter throws, `typedFetch` resolves with a `NetworkError`. Its `cause` holds
the thrown value.

`typedFetch` records each successful read of `status`, `statusText`, `url`, and
`headers` immediately. A later getter failure cannot cause an earlier field to
be read again. The first successful read decides the error identity.

On the HTTP-error path, `statusText` and `url` become empty strings when the
implementation answers with values that are not strings. `status` undergoes
numeric conversion before class selection. This normalization never lets an
incompatible success escape.

You can give a `Request` in the `url` position. `typedFetch` keeps its method, headers, signal, and Node.js body.

Do not give a body-carrying `Request` in the `options` position. Browsers reject this form because WebIDL requires `duplex`.

An augmented `Request` in the `options` position can carry an own `fetch` property. The sanitized view keeps its WebIDL fields and hides the custom property.

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
- `TypedResponse` names the Fetch response baseline available at the package
  floor, Node 20.13.0. `body` and `headers` are the ambient `ReadableStream` and
  `Headers`, so the success value forwards to a platform API without a cast, and
  so does streaming the body wherever your own lib configuration says that is
  valid. The runtime value remains the Fetch implementation's original response
  and may expose newer methods.

  WARNING: `new Response(r.body, { headers: r.headers })` is the line a proxy
  reaches for, and it emits a response that contradicts itself. The platform
  hands back a decoded body, while `content-encoding`, the wire
  `content-length`, and the hop-by-hop names stay on `headers`. Delete those
  names from a copy of the headers before you forward the body.

- `TypedResponse` is not `Response`. It does not promise `Response.bytes()`,
  which does not exist at the floor. Under `lib.dom` there is a second
  difference: `TypedResponse["body"]` is the ambient
  `ReadableStream<Uint8Array>`, where `Response["body"]` is
  `ReadableStream<Uint8Array<ArrayBuffer>>`. Handing the success value to a slot
  typed `(r: Response)` — a Workers, Hono, or Next handler — therefore still
  needs a cast, and adding `bytes()` alone does not remove it. Widening that far
  is a floor decision, not a typing one.
- `TypedFetchReturnType` is the result union from `typedFetch`.
- `TypedFetchOptions` extends `RequestInit` and adds the Fetch override.
- `HttpMethods` gives method suggestions. It omits `CONNECT` and `TRACE`, because the Fetch specification forbids them and native `fetch` throws a `TypeError` for them.
- `ClientErrors` is the union of the dedicated 4xx errors.
- `ServerErrors` is the union of the dedicated 5xx errors.
- `TypedFetchError` is the union of all error types that `typedFetch` resolves with.

`api<T>()` resolves with the whole result and transfers it to its caller. The caller then owns the error body and the success body, and the caller must read or cancel each one.

This form is correct, and it is the weaker of the two shapes. A wrapper that owns the body itself removes the obligation from every call site. Read "Own the body lifecycle in one module".

`api<T>()` also passes `options` through without a change. A wrapper that adds a header must merge, and `{ ...options?.headers }` is not a merge.

Import only the error classes from `@pbpeterson/typed-fetch/errors` when you do not need `typedFetch`.

The `headers` and `method` types give autocomplete only. They do not validate a name or a value.

The suggested header names are this library's own list in every lib profile. The list holds 16 names, in a canonical and a lowercase spelling each, plus the ten methods of a `Headers` instance. A consumer without `lib.dom` used to also see the runtime's own list, which included response-only names.

For example, an invalid content type or a misspelled header name still type-checks. The union ends in an open string type, and native Fetch accepts the underlying string record.

### Error class API

All HTTP error classes extend `BaseHttpError`.

A dedicated class uses literal types for `status` and `statusText`.

Instance properties:

- `status`: The HTTP status code.
- `statusText`: The canonical protocol label from the library.
- `url`: The response URL, as the full href. Not enumerable.
- `headers`: A copy of the response headers. Not enumerable.
- `name`: The error class name.

`statusText` does not copy the reason phrase from the server. The reason phrase, when the server sends one, occurs in `error.message`.

This holds for the 40 dedicated classes. `UnknownHttpError` has no canonical label to give, so its `statusText` is the reason phrase the server sent, filtered and bounded. See [Handle an unknown status](#handle-an-unknown-status).

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
  // {"name":"NotFoundError","message":"HTTP 404 \"Not Found\" (https://example.test/users/1)",
  //  "status":404,"statusText":"Not Found","url":"https://example.test/users/1",
  //  "headers":["content-type"]}
  await error.cancel();
}
```

`headers` holds header names, never values. A response carries values a log must not keep: `set-cookie` holds the session, and a custom header holds whatever the server chose to put there. A logger calls `toJSON()` on whatever it is handed, so the record cannot carry a value that nobody judged. A deny list does not solve this, because the dangerous name is the one this library has never heard of.

`url` follows the same rule. For a hierarchical URL, the record holds the
origin and path. It drops userinfo, the query string, and the fragment.

An opaque URL carries its payload in the path. The record therefore keeps only
its scheme. `error.url` still holds the full href.

A hierarchical path is kept, so a secret in a path segment reaches the record.
Dropping the path would reduce `url` to the origin and prevent request
correlation. Read [Known residuals](https://github.com/pbpeterson/typed-fetch/blob/main/SECURITY.md#known-residuals)
for the exact shapes that still reach the record.

A repeated `set-cookie` appears once per arrival, so `["set-cookie", "set-cookie"]` tells you the server sent two. Every other repeated name is combined into one entry by the platform, and its values are joined with a comma. Two `warning` headers therefore produce one `"warning"` entry. Read `error.headers` for the values, and `error.headers.getSetCookie()` for the cookies.

The body and the stack are absent for a neighboring reason. The body is a single-use stream, and a read of it is asynchronous. The stack can carry local file paths of the process. Read either one deliberately when you want it.

A consumer subclass inherits `toJSON()`, so a field the subclass adds does not reach `JSON.stringify(error)`. Override `toJSON()` in the subclass to add it. One override covers both `JSON.stringify(error)` and `console.log(error)`.

#### `console.log(error)` and `util.inspect`

`console.log`, `console.error`, and `util.inspect` do not call `toJSON()`. They print an error's own properties, and Node prints `cause` on an error whether or not it is enumerable. Every error class therefore installs `util.inspect.custom`, so these calls print the stack followed by the same record that `toJSON()` returns.

A developer keeps the stack, which the record omits. `cause` and `reason` are replaced by a marker that names the property that holds them. Read `error.cause` or `error.reason` when you want the value.

The hook is registered under `Symbol.for("nodejs.util.inspect.custom")`, which is what `util.inspect.custom` is. The library imports no Node module for it, and the hook works on Node, Deno, and Bun.

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

The callback must give a new error built from the `Response` it receives.
`clone()` throws `TypeError` in five conditions.

1. The callback gives a value that is not an object, such as `null`, `undefined`, a string, or a number. The declared return type forbids this, and a JavaScript caller or one `as any` still reaches it. `clone(() => null)` resolved with `null` before, and the cloned branch had no owner.
2. The callback gives the same error. One instance cannot own two branches.
3. The callback gives a value that claims this package copy and carries no
   body. Examples include a Proxy from instrumentation or an `Object.create`
   delegate. The wrapper cannot own the cloned branch. The response would stay
   open with no release path.
4. The callback gives an error built from a different `Response`. The cloned branch then has no owner.
5. The callback gives an error from a package copy that cannot confirm that it took the cloned branch. Each package copy keeps its own body table. `clone()` asks the new error directly, through a `Symbol.for` method that every copy of this package stamps.

An instance built by a different package copy is accepted when that copy confirms that it took the cloned branch. A package copy older than this one carries no such method, so it cannot confirm it, and `clone()` throws. Upgrade that copy, or build the new error with the copy that is cloning.

`clone()` releases the orphaned branch before it throws, so a later `cancel()` on the original error still completes.

`clone()` wraps a failure of the callback in a `TypeError`. The no-callback form rethrows a failure of the subclass constructor without a change.

### `NetworkError`, `AbortedError`, and `TimeoutError`

These classes represent an attempt that produces no usable HTTP response. They
do not extend `BaseHttpError`, and they have no body methods.

All three classes have `message`, `cause`, and `url`. For rejected requests,
`cause` holds the Fetch rejection. `NetworkError.cause` can instead hold a
custom-response validation or inspection failure.

Code can read `error.url` from every member of `TypedFetchError`.

`AbortedError` also has `reason`.

The `url` value is an empty string when `typedFetch` cannot resolve the request URL.

The `reason` value has type `unknown`. Check its type before use.

The default `message` values are `"Network error"`, `"Request aborted"`, and `"Request timed out"`.

All three constructors take a message and an options object. Every member of the options object is optional.

- `new NetworkError(message?, { cause?, url? })`
- `new AbortedError(message?, { cause?, reason?, url? })`
- `new TimeoutError(message?, { cause?, url? })`

Build one directly when a test needs a fixed failure.

```typescript
import { NetworkError, AbortedError, TimeoutError } from "@pbpeterson/typed-fetch";

const network = new NetworkError("Network error", {
  cause: new TypeError("fetch failed"),
  url: "https://api.example.com/users",
});

const aborted = new AbortedError("Request aborted", {
  cause: new DOMException("This operation was aborted", "AbortError"),
  reason: new Error("route change"),
  url: "https://api.example.com/users",
});

const timedOut = new TimeoutError("Request timed out", {
  cause: new DOMException("The operation timed out", "TimeoutError"),
  url: "https://api.example.com/users",
});

console.log(network.url, aborted.reason, timedOut.url);
```

`cause` and `reason` become own properties only when the options object carries the key. `url` defaults to the empty string.

`NetworkError.message` is a library constant. The platform rejection stays on `error.cause`, unmodified. When the request URL carries credentials, as in `https://user:password@host/`, that platform message contains the password. Read [Known residuals](https://github.com/pbpeterson/typed-fetch/blob/main/SECURITY.md#known-residuals) before you copy `error.cause` into a log line.

The three classes take a `message` and a `url` from the caller, and they remove the URL from the message they are given. A wrapper that passes a platform message through gets the same treatment `typedFetch` used to need.

All three classes define `toJSON()`. The record is `{ name, message, url }`.

`cause` and `reason` are absent from the record on purpose. The cause holds the platform error that failed the request, and its chain carries transport detail, such as local and remote addresses and ports. The reason is the value that the caller passed to `controller.abort(reason)`, and it can be any value. Read either one from the error when you want it.

The cause can also carry a credential, and this is the one residual the library cannot close. A platform quotes the URL it refused back in its own message, so undici rejects a credentialed URL with `Request cannot be constructed from a URL that includes credentials: http://alice:hunter2@host/x`. Every channel this library controls redacts that value. Node's fatal-exception printer does not: it renders `[cause]` on a crashing error and ignores every inspect hook. An unhandled rejection, or a `throw error`, can therefore put a password in a crash dump. Do not let a request failure terminate the process, and do not copy `error.cause` into a log line.

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
- `AbortSignal.any()` requires Node.js 20.3.0 or later. The package floor
  is Node.js 20.13.0, so every supported Node.js version provides it.
- Body semantics follow the runtime. On Bun a bare reader lock reports the body as used, so `cancel()` resolves instead of rejecting.
- A value typed `RequestInit` is not assignable to `TypedFetchOptions` without `lib.dom`. `@types/node` types `HeadersInit`'s record arm as all-optional, so its values are `string | undefined`, and this library rejects `undefined` on every header name — a header set to `undefined` reaches the wire as the literal string `"undefined"`. Type a wrapper's own parameter as `TypedFetchOptions` instead, which is what the examples above do. Passing an object literal is unaffected.

### Non-goals

This library does not include these features:

- Retries. Put the retry policy in a separate layer.
- Interceptors, hooks, or middleware. Wrap `typedFetch` in your code.
- Base URL or instance configuration. Write a small wrapper function.
- A query-string builder. Use `URL` and `URLSearchParams`.
- Request-body serialization. Give `body` and `headers` as native Fetch inputs.
- Response caching. Use a cache layer.
- Required runtime validation. The package can add an optional Standard Schema hook in a later release.
- A `rawStatusText` field on a dedicated class. Read the reason phrase from `error.message`. `UnknownHttpError.statusText` already carries it.
- Eager body buffering. Body readers keep the native streaming behavior.

## Semantic version contract

1. A new dedicated class in `ClientErrors` or `ServerErrors` requires a major release. It replaces `UnknownHttpError` for that status and widens the error union.
2. The human-readable `error.message` text is diagnostic. It can change in any release.
3. The canonical `statusText` value of a dedicated class is public API. A change to it requires a major release. `UnknownHttpError.statusText` is the server's value and carries no such promise.
4. Status 418 keeps `"I'm a teapot"`. Status 510 keeps `"Not Extended"`.
5. A removed or renamed export requires a major release.
6. A change to a `status` literal requires a major release.
7. A matching `vX.Y.Z` Git tag must start each npm release.
8. Node.js 20.13.0 is the minimum version. A higher minimum requires a major release.
9. A `Symbol.for` key that crosses package copies is a contract between package versions. Its meaning never changes, and a new question gets a new key. A change to an existing key makes `clone(recreate)` throw a `TypeError` for an install that holds two package copies.

Keep a `default` branch in a known-status switch. A newer package version can move a status from `UnknownHttpError` to a dedicated class, and the `default` branch keeps that code correct.

Read [`RELEASING.md`](https://github.com/pbpeterson/typed-fetch/blob/main/RELEASING.md) for the release procedure.

## Contribution and license

Read [`CONTRIBUTING.md`](https://github.com/pbpeterson/typed-fetch/blob/main/CONTRIBUTING.md) before you make a pull request.

That document gives the setup instructions, the required checks, and the procedure to add an HTTP status class.

The license is MIT. Read [`LICENSE`](https://github.com/pbpeterson/typed-fetch/blob/main/LICENSE).
