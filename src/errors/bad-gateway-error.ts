import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502 */
export class BadGatewayError extends KnownHttpError {
  override readonly name = "BadGatewayError" as const;
  public readonly status = 502 as const;
  public readonly statusText = "Bad Gateway" as const;
  static readonly status = 502 as const;
  static readonly statusText = "Bad Gateway" as const;
}
