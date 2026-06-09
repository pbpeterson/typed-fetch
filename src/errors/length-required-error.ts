import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/411 */
export class LengthRequiredError extends BaseHttpError {
  public readonly status = 411 as const;
  public readonly statusText = "Length Required" as const;
  static readonly status = 411 as const;
  static readonly statusText = "Length Required" as const;
}
