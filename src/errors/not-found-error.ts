import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 */
export class NotFoundError extends BaseHttpError {
  public readonly status = 404 as const;
  public readonly statusText = "Not Found" as const;
  static readonly status = 404 as const;
  static readonly statusText = "Not Found" as const;
}
