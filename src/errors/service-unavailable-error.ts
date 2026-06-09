import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503 */
export class ServiceUnavailableError extends BaseHttpError {
  public readonly status = 503 as const;
  public readonly statusText = "Service Unavailable" as const;
  static readonly status = 503 as const;
  static readonly statusText = "Service Unavailable" as const;
}
