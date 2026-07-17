import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/416 */
export class RequestedRangeNotSatisfiableError extends KnownHttpError {
  override readonly name = "RequestedRangeNotSatisfiableError" as const;
  public readonly status = 416 as const;
  public readonly statusText = "Range Not Satisfiable" as const;
  static readonly status = 416 as const;
  static readonly statusText = "Range Not Satisfiable" as const;
}
