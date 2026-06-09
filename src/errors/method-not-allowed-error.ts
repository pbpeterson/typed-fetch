import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405 */
export class MethodNotAllowedError extends BaseHttpError {
  public readonly status = 405 as const;
  public readonly statusText = "Method Not Allowed" as const;
  static readonly status = 405 as const;
  static readonly statusText = "Method Not Allowed" as const;
}
