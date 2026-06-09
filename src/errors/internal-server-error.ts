import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500 */
export class InternalServerError extends BaseHttpError {
  public readonly status = 500 as const;
  public readonly statusText = "Internal Server Error" as const;
  static readonly status = 500 as const;
  static readonly statusText = "Internal Server Error" as const;
}
