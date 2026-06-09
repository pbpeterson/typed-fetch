import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400 */
export class BadRequestError extends BaseHttpError {
  public readonly status = 400 as const;
  public readonly statusText = "Bad Request" as const;
  static readonly status = 400 as const;
  static readonly statusText = "Bad Request" as const;
}
