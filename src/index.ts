import { ClientErrors, ServerErrors, TypedFetchError } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import { NetworkError } from "./errors/network-error";
import { AbortedError } from "./errors/aborted-error";
import { TimeoutError } from "./errors/timeout-error";
import { UnknownHttpError } from "./errors/unknown-http-error";
import { TypedHeaders } from "./headers";
import { HttpMethods } from "./methods";

/**
 * Type guard that checks whether a value is an HTTP error (any {@link BaseHttpError} subclass).
 *
 * Prefer this over `instanceof` when the error may cross package boundaries.
 *
 * @example
 * ```ts
 * if (isHttpError(error)) {
 *   console.log(error.status, error.statusText);
 * }
 * ```
 */
export function isHttpError(error: unknown): error is BaseHttpError {
  return error instanceof BaseHttpError;
}

/**
 * Type guard that checks whether a value is a {@link NetworkError}.
 *
 * @example
 * ```ts
 * if (isNetworkError(error)) {
 *   console.log("Connection failed:", error.message);
 * }
 * ```
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Type guard that checks whether a value is an {@link AbortedError}.
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
  return error instanceof AbortedError;
}

/**
 * Type guard that checks whether a value is a {@link TimeoutError}.
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
  return error instanceof TimeoutError;
}

/**
 * Type guard for a *known*, dedicated HTTP error class (excludes {@link UnknownHttpError}).
 *
 * Narrowing on `error.status` after this guard is exhaustive over the mapped codes.
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
  return error instanceof BaseHttpError && !(error instanceof UnknownHttpError);
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
  const { fetch: fetchImpl = fetch, ...init } = options;

  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    // The AbortSignal is the authority on cancellation — NOT the rejected
    // error's `.name`. A caller can pass any reason to `controller.abort(reason)`
    // (a documented Web API pattern), and fetch rejects with THAT reason, whose
    // `.name` is rarely "AbortError". Conversely, an unrelated error that merely
    // happens to be named "AbortError" must NOT be treated as a cancellation.
    if (init.signal?.aborted) {
      const reason = init.signal.reason;
      // `AbortSignal.timeout()` aborts with a DOMException named "TimeoutError".
      if (reason instanceof Error && reason.name === "TimeoutError") {
        return {
          response: null,
          error: new TimeoutError("Request timed out", { cause: reason }),
        };
      }
      return {
        response: null,
        error: new AbortedError("Request aborted", { cause: err, reason }),
      };
    }
    const message = err instanceof Error ? err.message || err.name : "Network error";
    return {
      response: null,
      error: new NetworkError(message, { cause: err }),
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
