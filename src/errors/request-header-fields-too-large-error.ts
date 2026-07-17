import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/431 */
export class RequestHeaderFieldsTooLargeError extends KnownHttpError {
  override readonly name = "RequestHeaderFieldsTooLargeError" as const;
  public readonly status = 431 as const;
  public readonly statusText = "Request Header Fields Too Large" as const;
  static readonly status = 431 as const;
  static readonly statusText = "Request Header Fields Too Large" as const;
}
