import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/510 */
export class NotExtendedError extends BaseHttpError {
  public readonly status = 510 as const;
  public readonly statusText = "Not Extended" as const;
  static readonly status = 510 as const;
  static readonly statusText = "Not Extended" as const;
}
