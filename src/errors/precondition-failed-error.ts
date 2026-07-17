import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/412 */
export class PreconditionFailedError extends KnownHttpError {
  override readonly name = "PreconditionFailedError" as const;
  public readonly status = 412 as const;
  public readonly statusText = "Precondition Failed" as const;
  static readonly status = 412 as const;
  static readonly statusText = "Precondition Failed" as const;
}
