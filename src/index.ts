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
  networkErrorBrand,
  timeoutErrorBrand,
  unknownHttpErrorBrand,
} from "./errors/brand";
import { TypedHeaders } from "./headers";
import { HttpMethods } from "./methods";

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
 * if (isKnownHttpError(error)) {
 *   switch (error.status) {
 *     case 404:
 *       // error: NotFoundError
 *       break;
 *   }
 * }
 * ```
 */
export function isKnownHttpError(error: unknown): error is ClientErrors | ServerErrors {
  return hasBrand(error, httpErrorBrand) && !hasBrand(error, unknownHttpErrorBrand);
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
 * const { response, error } = await typedFetch<User>("/api/users/1");
 * if (error) {
 *   console.log(error.status);
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
  // Consequence: `options.fetch` injection and passing a `Request` are
  // mutually exclusive — a `Request` has no `fetch` property, and the spread
  // above only strips `fetch` on the plain-object path. That is intentional;
  // `options.fetch` is for the plain-object path.
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
  const signal = init.signal ?? (url instanceof Request ? url.signal : undefined);

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
    if (signal?.aborted) {
      const reason = signal.reason;
      // Classify a timeout by the *shape the platform produces*, not by a name
      // a caller can forge. `AbortSignal.timeout()` aborts with a real
      // `DOMException` named "TimeoutError"; a caller's
      // `controller.abort(reason)` can set any `reason.name` — including
      // "TimeoutError" — on a plain `Error`, but cannot make it a
      // `DOMException`. Requiring BOTH conditions keeps a forged name from
      // hijacking timeout classification (and from losing `error.reason`).
      //
      // The `name` check stays load-bearing: a bare `controller.abort()` also
      // produces a `DOMException`, but named "AbortError" — it must remain an
      // AbortedError. `DOMException` is a global on every fetch-capable runtime
      // (Node 20+, Bun, Deno, browsers, edge), but `signal?.aborted` above
      // gates an unconditional `instanceof`, so we `typeof`-guard it to degrade
      // gracefully (→ AbortedError, reason preserved) instead of throwing a
      // `ReferenceError` in a polyfilled/exotic environment that lacks it.
      if (
        typeof DOMException !== "undefined" &&
        reason instanceof DOMException &&
        reason.name === "TimeoutError"
      ) {
        return {
          response: null,
          error: new TimeoutError("Request timed out", { cause: reason, url: requestUrl }),
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
