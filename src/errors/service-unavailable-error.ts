import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503 */
export class ServiceUnavailableError extends KnownHttpError {
  override readonly name = "ServiceUnavailableError" as const;
  public readonly status = 503 as const;
  public readonly statusText = "Service Unavailable" as const;
  static readonly status = 503 as const;
  static readonly statusText = "Service Unavailable" as const;
}
