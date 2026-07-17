import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/505 */
export class HttpVersionNotSupportedError extends KnownHttpError {
  override readonly name = "HttpVersionNotSupportedError" as const;
  public readonly status = 505 as const;
  public readonly statusText = "HTTP Version Not Supported" as const;
  static readonly status = 505 as const;
  static readonly statusText = "HTTP Version Not Supported" as const;
}
