import isNetworkErr from "is-network-error";
import { ClientErrors, ServerErrors } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import { NetworkError } from "./errors/network-error";
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

interface TypedResponse<JsonReturnType> extends Response {
  json(): Promise<JsonReturnType>;
}

type TypedFetchReturnType<
  JsonReturnType,
  ErrorType extends ClientErrors = ClientErrors,
> =
  | {
      response: TypedResponse<JsonReturnType>;
      error: null;
    }
  | {
      response: null;
      error: ErrorType | ServerErrors | NetworkError;
    };

type FetchParams = Parameters<typeof fetch>;

type URL = FetchParams[0];
type Options = FetchParams[1] & {
  headers?: TypedHeaders;
  method?: HttpMethods;
};

/**
 * Type-safe wrapper around the native `fetch` API that returns errors as values
 * instead of throwing exceptions.
 *
 * @typeParam JsonReturnType - Expected response body type on success.
 * @typeParam ErrorType - Specific client error types to expect (defaults to all 4xx).
 *   Server errors (5xx) and {@link NetworkError} are always included.
 *
 * @param url - The resource URL, same as `fetch()`.
 * @param options - Request options with typed `headers` and `method`.
 * @returns A discriminated union: `{ response, error: null }` on success,
 *   `{ response: null, error }` on failure.
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
export async function typedFetch<
  JsonReturnType,
  ErrorType extends ClientErrors = ClientErrors,
>(
  url: URL,
  options: Options = {},
): Promise<TypedFetchReturnType<JsonReturnType, ErrorType>> {
  let response: TypedFetchReturnType<JsonReturnType, ErrorType>["response"] =
    null;
  let error: TypedFetchReturnType<JsonReturnType, ErrorType>["error"] = null;

  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const ErrorClass = statusCodeErrorMap.get(res.status);
      if (ErrorClass) {
        throw new ErrorClass(res);
      }
    }

    response = res as TypedResponse<JsonReturnType>;
  } catch (err) {
    if (isHttpError(err) || err instanceof NetworkError) {
      error = err;
    } else if (isNetworkErr(err)) {
      error = new NetworkError(
        err instanceof Error ? err.message : "Network error",
      );
    } else {
      error = new NetworkError(
        err instanceof Error ? err.message : "Unknown error",
      );
    }

    return {
      response: null,
      error,
    };
  }

  return {
    response,
    error,
  };
}
