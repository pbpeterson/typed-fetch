import { ClientErrors, ServerErrors, TypedFetchError } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import { NetworkError } from "./errors/network-error";
import { AbortedError } from "./errors/aborted-error";
import { TimeoutError } from "./errors/timeout-error";
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

/**
 * Realm-safe DOMException detection. `instanceof DOMException` is bound to the
 * current realm's constructor, so a DOMException created in another realm
 * (jsdom, node:vm, an iframe) fails it. Fall back to
 * `Object.prototype.toString`, which reads the platform-set
 * `Symbol.toStringTag` ("DOMException" on every implementation). Tradeoff:
 * the tag is forgeable via `Symbol.toStringTag` — accepted, the same class of
 * documented honesty as a hand-built `new DOMException("", "TimeoutError")`.
 * `typeof` guard keeps exotic runtimes without the global from throwing.
 */
function isDOMException(value: unknown): value is DOMException {
  return (
    (typeof DOMException !== "undefined" && value instanceof DOMException) ||
    Object.prototype.toString.call(value) === "[object DOMException]"
  );
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
 *   console.log("Request was cancelled");
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
 * Keyed on cross-copy brands — works across entry points and module formats.
 * Narrowing on `error.status` after this guard is exhaustive over the mapped
 * codes, and is the copy-proof way to reach a specific subclass (a raw
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
 *       // Keep a default: minor releases may add dedicated status classes.
 *       break;
 *   }
 * }
 * ```
 */
export function isKnownHttpError(error: unknown): error is ClientErrors | ServerErrors {
  return hasBrand(error, httpErrorBrand) && hasBrand(error, knownHttpErrorBrand);
}

/** A `Response` whose `json()` (and `clone()`) carry the expected body type. */
export interface TypedResponse<JsonReturnType> extends Response {
  json(): Promise<JsonReturnType>;
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

/** Request options accepted by {@link typedFetch} — `RequestInit` with typed `headers` and `method`. */
export type TypedFetchOptions = FetchParams[1] & {
  headers?: TypedHeaders;
  // fetch accepts any method string (and normalizes case); the union only
  // drives IntelliSense.
  method?: HttpMethods | (string & {});
  /** Override the fetch implementation (testing, DI, custom agents). */
  fetch?: typeof fetch;
};

/**
 * Type-safe wrapper around the native `fetch` API that returns errors as values
 * instead of throwing exceptions.
 *
 * @typeParam JsonReturnType - Expected response body type on success.
 *
 * @param url - The resource URL, same as `fetch()`.
 * @param options - Request options with typed `headers` and `method`.
 * @returns A discriminated union: `{ response, error: null }` on success,
 *   `{ response: null, error }` on failure. `error` is the full
 *   {@link TypedFetchError} union — narrow it with {@link isKnownHttpError}
 *   and `switch (error.status)`, or with `instanceof`.
 *
 * @example
 * ```ts
 * import { typedFetch } from "@pbpeterson/typed-fetch";
 *
 * interface User {
 *   id: number;
 * }
 *
 * const { response, error } = await typedFetch<User>("/api/users/1");
 * if (error) {
 *   console.log(error.name);
 * } else {
 *   const user = await response.json();
 * }
 * ```
 */
export async function typedFetch<JsonReturnType>(
  url: FetchInput,
  options: TypedFetchOptions = {},
): Promise<TypedFetchReturnType<JsonReturnType>> {
  const { fetch: fetchImpl = fetch, ...rest } = options;
  // A `Request` is a host exotic object: `method`, `headers`, `signal`, and
  // `body` are prototype getters, NOT own enumerable properties, so object
  // rest spread (`...rest`) copies NONE of them — it would silently downgrade
  // every request to a bodyless, header-less GET. Native `fetch` reads those
  // getters correctly, so a `Request` must be passed through untouched.
  //
  // Consequence: `options.fetch` injection and passing a `Request` **in the
  // options slot** are mutually exclusive — a `Request` has no `fetch`
  // property, and the spread above only strips `fetch` on the plain-object
  // path. That is intentional; `options.fetch` is for the plain-object path.
  // (A `Request` in the url slot combines freely with plain options that
  // carry `fetch`.)
  const init = options instanceof Request ? options : rest;

  // The AbortSignal can arrive via EITHER slot: the `options`/`init` (its
  // `.signal`), OR a `Request` passed as the first argument (`url.signal`) —
  // the canonical fetch pattern used by service workers, middleware, and
  // request factories. Resolve the signal that actually governs this call so
  // the catch block can key abort/timeout classification off it.
  //
  // Precedence matches native `fetch(request, init)`: when `init.signal` is
  // present it OVERRIDES `request.signal` entirely (the Request's own signal
  // is then ignored, verified against native fetch). So `init.signal` wins;
  // only when it is absent do we fall back to the Request's signal.
  //
  // `Request` is a global on every supported runtime (Node 20+, Bun, Deno,
  // browsers, edge). `instanceof Request` also narrows `url` (typed
  // `FetchInput`, which includes `Request`) so `url.signal` type-checks.
  // `signal: null` is a *present* init member per the fetch spec: it DETACHES
  // the Request's signal — no signal governs the call. Only an absent or
  // `undefined` `init.signal` falls back to the Request's own signal (WebIDL
  // treats an `undefined` dictionary member as absent).
  const signal =
    init.signal !== undefined
      ? (init.signal ?? undefined)
      : url instanceof Request
        ? url.signal
        : undefined;

  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    // The requested URL, so pre-response errors (which hold no `Response`) are
    // still distinguishable in logs — the correlation `BaseHttpError.url`
    // already gives HTTP errors. `FetchInput` is `string | URL | Request`; a
    // `Request` exposes the resolved absolute URL on `.url`, and `String()`
    // stringifies both a `string` (identity) and a `URL` (its `href`).
    const requestUrl = url instanceof Request ? url.url : String(url);
    // The AbortSignal is the authority on cancellation — NOT the rejected
    // error's `.name`. A caller can pass any reason to `controller.abort(reason)`
    // (a documented Web API pattern), and fetch rejects with THAT reason, whose
    // `.name` is rarely "AbortError". Conversely, an unrelated error that merely
    // happens to be named "AbortError" must NOT be treated as a cancellation.
    //
    // The signal being aborted is necessary but NOT sufficient: fetch can
    // reject for an unrelated reason even while the signal is already aborted
    // (e.g. `method: "CONNECT"` or a bad header name → TypeError thrown during
    // Request construction, before the abort is ever consulted). Only take the
    // abort path when the rejection IS the abort: spec-compliant runtimes
    // reject with `signal.reason` itself (bare `controller.abort()` sets a
    // DOMException "AbortError" as the reason, `controller.abort(reason)` sets
    // that exact reason — both satisfy `err === signal.reason`). The second
    // arm covers exotic/polyfilled signals whose `reason` is undefined but
    // whose abort still surfaces as one of the platform's abort DOMException
    // shapes (named "AbortError" or "TimeoutError"). The name check keeps an
    // unrelated DOMException failure (e.g. a "SecurityError" that happens to
    // reject while a reason-less signal is aborted) OUT of the abort path.
    // Anything else falls through to NetworkError with the real cause.
    if (
      signal?.aborted &&
      (err === signal.reason ||
        (signal.reason === undefined &&
          isDOMException(err) &&
          (err.name === "AbortError" || err.name === "TimeoutError")))
    ) {
      const reason = signal.reason;
      // Classify a timeout by the *shape the platform produces*, not by a name
      // a caller can forge on a plain error. `AbortSignal.timeout()` aborts
      // with a real `DOMException` named "TimeoutError". A caller's
      // `controller.abort(reason)` can set any `reason.name` — including
      // "TimeoutError" — on a plain `Error`; that stays an AbortedError because
      // it is not a DOMException. The DOMException tag IS the accepted boundary
      // here: `isDOMException` reads `Symbol.toStringTag`, so a caller who
      // hand-builds that exact shape (`new DOMException("", "TimeoutError")` or
      // an object tagged "DOMException") is opting into timeout classification,
      // the same documented honesty as forging any platform-shaped value.
      //
      // The `name` check stays load-bearing: a bare `controller.abort()` also
      // produces a `DOMException`, but named "AbortError" — it must remain an
      // AbortedError.
      //
      // Classify off `reason ?? err`: spec runtimes record the timeout
      // DOMException on `signal.reason` (arm 1, where `err === reason`), but a
      // polyfilled timeout signal can leave `reason` undefined while the
      // rejection itself (`err`, arm 2) is the DOMException named
      // "TimeoutError". Falling back to `err` classifies that case as a
      // TimeoutError instead of a generic AbortedError.
      const timeoutBasis = reason ?? err;
      if (isDOMException(timeoutBasis) && timeoutBasis.name === "TimeoutError") {
        return {
          response: null,
          error: new TimeoutError("Request timed out", { cause: timeoutBasis, url: requestUrl }),
        };
      }
      return {
        response: null,
        error: new AbortedError("Request aborted", { cause: err, reason, url: requestUrl }),
      };
    }
    const message = err instanceof Error ? err.message || err.name : "Network error";
    return {
      response: null,
      error: new NetworkError(message, { cause: err, url: requestUrl }),
    };
  }

  if (res.status >= 400) {
    const ErrorClass = statusCodeErrorMap.get(res.status);
    return {
      response: null,
      error: ErrorClass ? new ErrorClass(res) : new UnknownHttpError(res),
    };
  }

  return {
    response: res as TypedResponse<JsonReturnType>,
    error: null,
  };
}
