import { ClientErrors, ServerErrors } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import { NetworkError } from "./errors/network-error";
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
      error: ErrorType | ServerErrors | UnknownHttpError | NetworkError;
    };

type FetchParams = Parameters<typeof fetch>;

type FetchInput = FetchParams[0];
type Options = FetchParams[1] & {
  headers?: TypedHeaders;
  // fetch accepts any method string (and normalizes case); the union only
  // drives IntelliSense.
  method?: HttpMethods | (string & {});
};

/**
 * Type-safe wrapper around the native `fetch` API that returns errors as values
 * instead of throwing exceptions.
 *
 * @typeParam JsonReturnType - Expected response body type on success.
 * @typeParam ErrorType - Specific client error types to expect (defaults to all 4xx).
 *   Server errors (5xx), {@link UnknownHttpError} (unmapped status codes >= 400),
 *   and {@link NetworkError} are always included.
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
  url: FetchInput,
  options: Options = {},
): Promise<TypedFetchReturnType<JsonReturnType, ErrorType>> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    const message =
      err instanceof Error ? err.message || err.name : "Network error";
    return {
      response: null,
      error: new NetworkError(message, { cause: err }),
    };
  }

  if (res.status >= 400) {
    const ErrorClass = statusCodeErrorMap.get(res.status);
    return {
      response: null,
      error: ErrorClass
        ? (new ErrorClass(res) as ErrorType | ServerErrors)
        : new UnknownHttpError(res),
    };
  }

  return {
    response: res as TypedResponse<JsonReturnType>,
    error: null,
  };
}
