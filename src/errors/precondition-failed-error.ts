import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/412 */
export class PreconditionFailedError extends BaseHttpError {
  public readonly status = 412 as const;
  public readonly statusText = "Precondition Failed" as const;
  static readonly status = 412 as const;
  static readonly statusText = "Precondition Failed" as const;
}
