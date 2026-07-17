import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413 */
export class RequestTooLongError extends KnownHttpError {
  override readonly name = "RequestTooLongError" as const;
  public readonly status = 413 as const;
  public readonly statusText = "Content Too Large" as const;
  static readonly status = 413 as const;
  static readonly statusText = "Content Too Large" as const;
}
