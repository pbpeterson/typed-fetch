import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401 */
export class UnauthorizedError extends BaseHttpError {
  public readonly status = 401 as const;
  public readonly statusText = "Unauthorized" as const;
  static readonly status = 401 as const;
  static readonly statusText = "Unauthorized" as const;
}
