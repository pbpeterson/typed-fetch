import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409 */
export class ConflictError extends KnownHttpError {
  override readonly name = "ConflictError" as const;
  public readonly status = 409 as const;
  public readonly statusText = "Conflict" as const;
  static readonly status = 409 as const;
  static readonly statusText = "Conflict" as const;
}
