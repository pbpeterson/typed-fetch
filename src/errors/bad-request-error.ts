import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400 */
export class BadRequestError extends KnownHttpError {
  override readonly name = "BadRequestError" as const;
  public readonly status = 400 as const;
  public readonly statusText = "Bad Request" as const;
  static readonly status = 400 as const;
  static readonly statusText = "Bad Request" as const;
}
