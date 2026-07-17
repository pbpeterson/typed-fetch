import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/425 */
export class TooEarlyError extends KnownHttpError {
  override readonly name = "TooEarlyError" as const;
  public readonly status = 425 as const;
  public readonly statusText = "Too Early" as const;
  static readonly status = 425 as const;
  static readonly statusText = "Too Early" as const;
}
