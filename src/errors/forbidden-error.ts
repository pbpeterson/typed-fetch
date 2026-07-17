import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403 */
export class ForbiddenError extends KnownHttpError {
  override readonly name = "ForbiddenError" as const;
  public readonly status = 403 as const;
  public readonly statusText = "Forbidden" as const;
  static readonly status = 403 as const;
  static readonly statusText = "Forbidden" as const;
}
