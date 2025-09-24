import isNetworkError from "is-network-error";
import {
  ClientErrors,
  HttpErrors,
  httpErrors,
  ServerErrors,
} from "./errors/helpers";
import { statusCodeErrorMap } from "./http-status-codes";
import { NetworkError } from "./errors/network-error";
import { TypedHeaders } from "./headers";
import { HttpMethods } from "./methods";

export function isHttpError<ErrorType extends InstanceType<HttpErrors>>(
  error: unknown,
): error is ErrorType {
  return httpErrors.some((HttpError) => error instanceof HttpError);
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
    if (isHttpError<ErrorType>(err) || err instanceof NetworkError) {
      error = err;
    } else if (isNetworkError(err)) {
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
