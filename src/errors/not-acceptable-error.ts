import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/406 */
export class NotAcceptableError extends BaseHttpError {
  public readonly status = 406 as const;
  public readonly statusText = "Not Acceptable" as const;
  static readonly status = 406 as const;
  static readonly statusText = "Not Acceptable" as const;
}
