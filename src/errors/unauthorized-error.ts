import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401 */
export class UnauthorizedError extends KnownHttpError {
  override readonly name = "UnauthorizedError" as const;
  public readonly status = 401 as const;
  public readonly statusText = "Unauthorized" as const;
  static readonly status = 401 as const;
  static readonly statusText = "Unauthorized" as const;
}
