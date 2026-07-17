import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/501 */
export class NotImplementedError extends KnownHttpError {
  override readonly name = "NotImplementedError" as const;
  public readonly status = 501 as const;
  public readonly statusText = "Not Implemented" as const;
  static readonly status = 501 as const;
  static readonly statusText = "Not Implemented" as const;
}
