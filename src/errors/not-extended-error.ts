import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/510 */
export class NotExtendedError extends KnownHttpError {
  override readonly name = "NotExtendedError" as const;
  public readonly status = 510 as const;
  public readonly statusText = "Not Extended" as const;
  static readonly status = 510 as const;
  static readonly statusText = "Not Extended" as const;
}
