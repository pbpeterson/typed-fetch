import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413 */
export class RequestTooLongError extends BaseHttpError {
  public readonly status = 413 as const;
  public readonly statusText = "Payload Too Large" as const;
  static readonly status = 413 as const;
  static readonly statusText = "Payload Too Large" as const;
}
