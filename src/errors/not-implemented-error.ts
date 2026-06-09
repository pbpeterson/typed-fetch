import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/501 */
export class NotImplementedError extends BaseHttpError {
  public readonly status = 501 as const;
  public readonly statusText = "Not Implemented" as const;
  static readonly status = 501 as const;
  static readonly statusText = "Not Implemented" as const;
}
