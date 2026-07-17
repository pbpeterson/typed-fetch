import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/423 */
export class LockedError extends KnownHttpError {
  override readonly name = "LockedError" as const;
  public readonly status = 423 as const;
  public readonly statusText = "Locked" as const;
  static readonly status = 423 as const;
  static readonly statusText = "Locked" as const;
}
