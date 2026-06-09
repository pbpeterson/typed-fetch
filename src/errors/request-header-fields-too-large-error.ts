import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/431 */
export class RequestHeaderFieldsTooLargeError extends BaseHttpError {
  public readonly status = 431 as const;
  public readonly statusText = "Request Header Fields Too Large" as const;
  static readonly status = 431 as const;
  static readonly statusText = "Request Header Fields Too Large" as const;
}
