import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409 */
export class ConflictError extends BaseHttpError {
  public readonly status = 409 as const;
  public readonly statusText = "Conflict" as const;
  static readonly status = 409 as const;
  static readonly statusText = "Conflict" as const;
}
