import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/451 */
export class UnavailableForLegalReasonsError extends BaseHttpError {
  public readonly status = 451 as const;
  public readonly statusText = "Unavailable For Legal Reasons" as const;
  static readonly status = 451 as const;
  static readonly statusText = "Unavailable For Legal Reasons" as const;
}
