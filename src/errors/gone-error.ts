import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/410 */
export class GoneError extends BaseHttpError {
  public readonly status = 410 as const;
  public readonly statusText = "Gone" as const;
  static readonly status = 410 as const;
  static readonly statusText = "Gone" as const;
}
