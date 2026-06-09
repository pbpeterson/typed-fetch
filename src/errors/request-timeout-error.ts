import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408 */
export class RequestTimeoutError extends BaseHttpError {
  public readonly status = 408 as const;
  public readonly statusText = "Request Timeout" as const;
  static readonly status = 408 as const;
  static readonly statusText = "Request Timeout" as const;
}
