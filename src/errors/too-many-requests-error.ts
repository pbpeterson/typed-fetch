import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429 */
export class TooManyRequestsError extends BaseHttpError {
  public readonly status = 429 as const;
  public readonly statusText = "Too Many Requests" as const;
  static readonly status = 429 as const;
  static readonly statusText = "Too Many Requests" as const;
}
