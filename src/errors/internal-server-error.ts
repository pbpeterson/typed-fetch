import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500 */
export class InternalServerError extends KnownHttpError {
  override readonly name = "InternalServerError" as const;
  public readonly status = 500 as const;
  public readonly statusText = "Internal Server Error" as const;
  static readonly status = 500 as const;
  static readonly statusText = "Internal Server Error" as const;
}
