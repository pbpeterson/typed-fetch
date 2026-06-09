import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/416 */
export class RequestedRangeNotSatisfiableError extends BaseHttpError {
  public readonly status = 416 as const;
  public readonly statusText = "Range Not Satisfiable" as const;
  static readonly status = 416 as const;
  static readonly statusText = "Range Not Satisfiable" as const;
}
