import { ClientErrors, ServerErrors, TypedFetchError } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import type { NetworkError } from "./errors/network-error";
import type { AbortedError } from "./errors/aborted-error";
import type { TimeoutError } from "./errors/timeout-error";
import { UnknownHttpError } from "./errors/unknown-http-error";
import {
  abortedErrorBrand,
  hasBrand,
  httpErrorBrand,
  knownHttpErrorBrand,
  networkErrorBrand,
  timeoutErrorBrand,
} from "./errors/brand";
import { TypedHeaders } from "./headers";
import { HttpMethods } from "./methods";
import { classifyRequestFailure } from "./request-failure";
import { statusOf } from "./errors/response-identity";
import { releaseResponseBody } from "./errors/error-body";

/** Realm-safe Request detection for iframe, node:vm, and duplicated-runtime inputs. */
function isRequest(value: unknown): value is Request {
  try {
    return (
      (typeof Request !== "undefined" && value instanceof Request) ||
      Object.prototype.toString.call(value) === "[object Request]"
    );
  } catch {
    return false;
  }
}

/**
 * Realm-safe `Response` validation.
 *
 * Calling the native status getter avoids accepting an object that only spoofs
 * `[object Response]`. A structural fallback admits standards-compatible Fetch
 * polyfills from another implementation while rejecting partial test doubles.
 */
function isResponse(value: unknown): value is Response {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  try {
    if (typeof Response !== "undefined") {
      const getter = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get;
      if (typeof getter === "function") {
        Reflect.apply(getter, value, []);
        return true;
      }
    }
  } catch {
    // A foreign standards-compatible implementation has different internal
    // slots. Check its public Response shape below.
  }

  try {
    if (Object.prototype.toString.call(value) !== "[object Response]") return false;
    const fields = [
      "body",
      "bodyUsed",
      "headers",
      "ok",
      "redirected",
      "status",
      "statusText",
      "type",
      "url",
    ];
    const methods = ["arrayBuffer", "blob", "clone", "formData", "json", "text"];
    return (
      fields.every((field) => field in value) &&
      methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function")
    );
  } catch {
    return false;
  }
}

/**
 * Type guard that checks whether a value is an HTTP error (any {@link BaseHttpError} subclass).
 *
 * Keyed on a cross-copy brand rather than `instanceof`, so it returns `true`
 * even when the error was created by a *different copy* of the library — a
 * different entry point (`.` vs `./errors`) or a different module format
 * (ESM vs CJS). Always prefer this over `error instanceof BaseHttpError`,
 * which only holds within a single copy.
 *
 * @example
 * ```ts
 * import { isHttpError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isHttpError(error)) {
 *   console.log(error.status, error.statusText);
 *   // This example does not read the body, so it must cancel the body.
 *   await error.cancel();
 * }
 * ```
 */
export function isHttpError(error: unknown): error is BaseHttpError {
  return hasBrand(error, httpErrorBrand);
}

/**
 * Type guard that checks whether a value is a {@link NetworkError}.
 *
 * Keyed on a cross-copy brand — works across entry points and module formats.
 *
 * @example
 * ```ts
 * import { isNetworkError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isNetworkError(error)) {
 *   console.log("Connection failed:", error.message);
 * }
 * ```
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return hasBrand(error, networkErrorBrand);
}

/**
 * Type guard that checks whether a value is an {@link AbortedError}.
 *
 * Keyed on a cross-copy brand — works across entry points and module formats.
 *
 * Note: `AbortedError` does NOT extend `NetworkError` — {@link isNetworkError}
 * returns `false` for aborted requests. Use this guard instead.
 *
 * @example
 * ```ts
 * import { isAbortError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isAbortError(error)) {
 *   console.log("Request was aborted");
 * }
 * ```
 */
export function isAbortError(error: unknown): error is AbortedError {
  return hasBrand(error, abortedErrorBrand);
}

/**
 * Type guard that checks whether a value is a {@link TimeoutError}.
 *
 * Keyed on a cross-copy brand — works across entry points and module formats.
 *
 * Note: `TimeoutError` does NOT extend `NetworkError` — {@link isNetworkError}
 * returns `false` for timed-out requests. Use this guard instead.
 *
 * @example
 * ```ts
 * import { isTimeoutError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isTimeoutError(error)) {
 *   console.log("Request timed out");
 * }
 * ```
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return hasBrand(error, timeoutErrorBrand);
}

/**
 * Type guard for a *known*, dedicated HTTP error class (excludes {@link UnknownHttpError}).
 *
 * Keyed on cross-copy brands and restricted to the status map in this package
 * version — works across entry points and module formats without accepting a
 * dedicated status introduced by a newer copy. Narrowing on `error.status`
 * after this guard is exhaustive over this version's mapped codes, and is the
 * way to reach a specific subclass that works across package copies (a raw
 * `error instanceof NotFoundError` is NOT reliable across copies).
 *
 * @example
 * ```ts
 * import { isKnownHttpError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isKnownHttpError(error)) {
 *   switch (error.status) {
 *     case 404:
 *       // error: NotFoundError
 *       break;
 *     default:
 *       // Keep a default for forward compatibility and mixed package versions.
 *       break;
 *   }
 *   // No branch reads the body, so cancel the body once after the switch.
 *   await error.cancel();
 * }
 * ```
 */
export function isKnownHttpError(error: unknown): error is ClientErrors | ServerErrors {
  if (!hasBrand(error, httpErrorBrand) || !hasBrand(error, knownHttpErrorBrand)) {
    return false;
  }

  try {
    const status = (error as { readonly status?: unknown }).status;
    return typeof status === "number" && statusCodeErrorMap.has(status);
  } catch {
    // Hostile proxies/getters are not valid library errors.
    return false;
  }
}

/**
 * A `Response` whose `json()` (and `clone()`) carry the expected body type.
 *
 * {@link json} provides a compile-time type only; it does not validate the
 * payload. Body readers retain native `Response` behavior and may reject for
 * malformed/empty JSON or an already-consumed body.
 */
export interface TypedResponse<JsonReturnType> extends Response {
  /** Parse JSON with an unchecked compile-time result type; native body-read errors still reject. */
  json(): Promise<JsonReturnType>;
  /** Clone the response while preserving the typed {@link json} method. */
  clone(): TypedResponse<JsonReturnType>;
}

/** The discriminated union returned by {@link typedFetch}. */
export type TypedFetchReturnType<JsonReturnType> =
  | {
      response: TypedResponse<JsonReturnType>;
      error: null;
    }
  | {
      response: null;
      error: TypedFetchError;
    };

type FetchParams = Parameters<typeof fetch>;

type FetchInput = FetchParams[0];

function withoutFetchOverride(options: TypedFetchOptions): RequestInit {
  const descriptors = Object.getOwnPropertyDescriptors(options);
  delete descriptors.fetch;
  const sanitizedTarget = Object.create(Object.getPrototypeOf(options), descriptors) as RequestInit;

  // The proxy target exposes the same descriptors/prototype for reflection but
  // deliberately omits the extension. Ordinary reads delegate to the original
  // object with the original receiver: prototype getters backed by WebIDL
  // internal slots or JavaScript private fields would reject a descriptor-only
  // clone because that clone does not carry those slots.
  return new Proxy(sanitizedTarget, {
    get(_target, property) {
      return property === "fetch" ? undefined : Reflect.get(options, property, options);
    },
    has(_target, property) {
      return property === "fetch" ? false : Reflect.has(options, property);
    },
  });
}

function requestUrl(input: FetchInput): string {
  try {
    return isRequest(input) ? input.url : String(input);
  } catch {
    return "";
  }
}

/**
 * The options the ambient `fetch` accepts, minus the two slots this library
 * retypes.
 *
 * The slots are REMOVED and replaced, never intersected. An intersection makes
 * both types apply, and for `method` that erases the whole point: the platform
 * types it `string`, and `string & (HttpMethods | (string & {}))` reduces to
 * plain `string`, so `method: "…"` offered ZERO completions while the README
 * promised them. For `headers` the intersection dragged the PLATFORM's declared
 * header names into the suggestion list — under `@types/node` without DOM that
 * is undici's `HeaderRecord`, which reintroduced every response-only name this
 * library deliberately dropped (`Set-Cookie`, `ETag`) plus the three the
 * platform owns (`Content-Length`, `Host`, `Connection`).
 *
 * Derived from `fetch`'s own signature rather than written as
 * `Omit<RequestInit, …>`, for the same reason `NativeFetchHeaders` exists in
 * `src/headers.ts`: a `lib.dom` type name in the published declarations breaks
 * a Node consumer without DOM. `Omit` keeps every other member, including the
 * ones only one platform declares (`duplex`, `dispatcher`, `priority`,
 * `window`).
 */
type NativeRequestOptions = Omit<NonNullable<FetchParams[1]>, "headers" | "method">;

/** Request options accepted by {@link typedFetch} — `RequestInit` with typed `headers` and `method`. */
export type TypedFetchOptions = NativeRequestOptions & {
  headers?: TypedHeaders;
  // fetch accepts any method string (and normalizes case); the union only
  // drives IntelliSense.
  method?: HttpMethods | (string & {});
  /** Override the fetch implementation (testing, DI, custom agents). */
  fetch?: typeof fetch | undefined;
};

/**
 * Type-safe wrapper around the native `fetch` API that resolves network, HTTP,
 * abort, and timeout request failures as error values instead of rejecting.
 * Body readers on the returned response are separate native operations and
 * may still reject for malformed/empty data or a consumed body.
 *
 * @typeParam JsonReturnType - Expected response body type on success. This is
 *   a compile-time type only and does not perform runtime validation.
 *
 * @param url - The resource URL, same as `fetch()`.
 * @param options - Request options with typed `headers` and `method`.
 * @returns A discriminated union: `{ response, error: null }` on success,
 *   `{ response: null, error }` on failure. `error` is the full
 *   {@link TypedFetchError} union — narrow it with {@link isKnownHttpError}
 *   and `switch (error.status)`. Raw `instanceof` is only reliable when the
 *   producer and consumer share one loaded package copy; use the brand-based guards
 *   across duplicate package copies or ESM/CJS boundaries.
 *
 * @example
 * ```ts
 * import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";
 *
 * interface User {
 *   id: number;
 * }
 *
 * const { response, error } = await typedFetch<User>("https://api.example.com/users/1");
 * if (error) {
 *   console.log(error.name);
 *   // An HTTP error carries a body. This example does not read it, so it
 *   // cancels it. An unread body keeps its connection open.
 *   if (isHttpError(error)) await error.cancel();
 * } else {
 *   const user = await response.json();
 * }
 * ```
 */
export async function typedFetch<JsonReturnType>(
  url: FetchInput,
  options: TypedFetchOptions = {},
): Promise<TypedFetchReturnType<JsonReturnType>> {
  let signal: AbortSignal | undefined;
  try {
    // OWN property only. `fetch` is this library's own extension, not a WebIDL
    // dictionary member, and reading it off the prototype chain turns a single
    // `Object.prototype.fetch = ...` write anywhere in the process into a
    // redirect of every request — including a `typedFetch(url)` call that
    // passes no options object at all, whose default `{}` inherits it. The
    // whole transport, with the caller's credentials, is not a field a
    // polluted prototype gets to choose. The read below is guarded by the same
    // predicate, so an inherited `fetch` is neither used NOR stripped: it stays
    // on the object and the platform ignores it, because WebIDL reads only the
    // members it declares.
    const hasFetchOverride = Object.hasOwn(options, "fetch");
    const fetchImpl = (hasFetchOverride ? options.fetch : undefined) ?? fetch;
    // Fetch reads RequestInit as a WebIDL dictionary, so inherited properties
    // and prototype getters are part of the input. Preserve its prototype and
    // descriptors when removing this library's `fetch` extension; an object
    // spread would silently drop inherited `method`, `headers`, `body`, or
    // `signal` values. Without an override, pass the original object untouched.
    const init = hasFetchOverride ? withoutFetchOverride(options) : options;

    // The AbortSignal can arrive via EITHER slot: the `options`/`init` (its
    // `.signal`), OR a `Request` passed as the first argument (`url.signal`).
    // `signal: null` detaches the Request's signal; absent/undefined falls back.
    signal =
      init.signal !== undefined
        ? (init.signal ?? undefined)
        : isRequest(url)
          ? url.signal
          : undefined;

    const res = await fetchImpl(url, init);

    // Inside the envelope on purpose. `fetchImpl` can be an injected
    // implementation, so the resolved value is untrusted input. A non-Response
    // or a hostile identity getter must surface as an error VALUE instead of
    // rejecting or escaping through the typed success branch.
    //
    // `status` is read ONCE PER RESPONSE, by `statusOf`, which records the
    // value it read. The constructor and `UnknownHttpError` then answer with
    // that same value instead of reading the response again, so the status that
    // selected the error class is the status in `error.status`, in
    // `error.message`, and in the `toJSON()` record. Once matters because a
    // getter is free to report a different value on a second read, and a class
    // selected on one read whose fields come from another answers a status this
    // branch was never taken on.
    //
    // The read stays INSIDE the block below, because it can still throw — a
    // hostile getter, or a `valueOf` that throws during the numeric conversion
    // — and a throw here strands the body. See the catch.
    try {
      if (!isResponse(res)) {
        throw new TypeError("The fetch implementation resolved a value that is not a Response.");
      }
      const status = statusOf(res);
      if (status >= 400) {
        const ErrorClass = statusCodeErrorMap.get(status);
        return {
          response: null,
          error: ErrorClass ? new ErrorClass(res) : new UnknownHttpError(res),
        };
      }
    } catch (cause) {
      // The line above reads `status` (and converts it, which a hostile
      // `valueOf` can make throw), and the error class reads `statusText`,
      // `url`, and `headers`; any of them can throw for an injected
      // implementation. The catch below turns that into a NetworkError, but
      // `res` lives in the outer try block: the caller gets `response: null`
      // and never gets a handle to the body the network already opened.
      // Release it here, or it stays open with no owner.
      releaseResponseBody(res);
      throw cause;
    }

    // The success path releases nothing. `res` IS the returned response, and
    // the caller owns its body.
    return {
      response: res as TypedResponse<JsonReturnType>,
      error: null,
    };
  } catch (err) {
    // The requested URL, so pre-response errors (which hold no `Response`) are
    // still distinguishable in logs — the correlation `BaseHttpError.url`
    // already gives HTTP errors. `FetchInput` is `string | URL | Request`; a
    // `Request` exposes the resolved absolute URL on `.url`, and `String()`
    // stringifies both a `string` (identity) and a `URL` (its `href`).
    const resolvedRequestUrl = requestUrl(url);

    // `signal` is read from the OUTER binding and never re-derived from
    // `options` here: it was resolved before the request, and an `init.signal`
    // getter that threw is one of the reasons this catch runs at all. Reading
    // it again would rethrow and break the envelope's promise.
    //
    // Which failure this is — timeout, abort, or network — is decided by
    // `classifyRequestFailure`. The governing signal is the authority there,
    // never the rejection's `.name`.
    return {
      response: null,
      error: classifyRequestFailure(err, signal, resolvedRequestUrl),
    };
  }
}
