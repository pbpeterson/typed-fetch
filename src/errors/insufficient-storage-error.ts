import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/507 */
export class InsufficientStorageError extends BaseHttpError {
  public readonly status = 507 as const;
  public readonly statusText = "Insufficient Storage" as const;
  static readonly status = 507 as const;
  static readonly statusText = "Insufficient Storage" as const;
}
