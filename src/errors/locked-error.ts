import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/423 */
export class LockedError extends BaseHttpError {
  public readonly status = 423 as const;
  public readonly statusText = "Locked" as const;
  static readonly status = 423 as const;
  static readonly statusText = "Locked" as const;
}
