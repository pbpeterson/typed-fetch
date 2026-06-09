import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/505 */
export class HttpVersionNotSupportedError extends BaseHttpError {
  public readonly status = 505 as const;
  public readonly statusText = "HTTP Version Not Supported" as const;
  static readonly status = 505 as const;
  static readonly statusText = "HTTP Version Not Supported" as const;
}
