import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/414 */
export class RequestUriTooLongError extends BaseHttpError {
  public readonly status = 414 as const;
  public readonly statusText = "URI Too Long" as const;
  static readonly status = 414 as const;
  static readonly statusText = "URI Too Long" as const;
}
