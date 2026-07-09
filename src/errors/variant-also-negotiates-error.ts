import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/506 */
export class VariantAlsoNegotiatesError extends BaseHttpError {
  override readonly name = "VariantAlsoNegotiatesError" as const;
  public readonly status = 506 as const;
  public readonly statusText = "Variant Also Negotiates" as const;
  static readonly status = 506 as const;
  static readonly statusText = "Variant Also Negotiates" as const;
}
