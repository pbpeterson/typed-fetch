import { BaseHttpError } from "./base-http-error";

const VARIANT_ALSO_NEGOTIATES_ERROR_STATUS = 506;
const ERROR_STATUS_TEXT = "Variant Also Negotiates";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/506 */
export class VariantAlsoNegotiatesError extends BaseHttpError {
  public readonly status: 506 = VARIANT_ALSO_NEGOTIATES_ERROR_STATUS;
  public readonly statusText: "Variant Also Negotiates" = ERROR_STATUS_TEXT;
  static readonly status: 506 = VARIANT_ALSO_NEGOTIATES_ERROR_STATUS;
  static readonly statusText: "Variant Also Negotiates" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): VariantAlsoNegotiatesError {
    return new VariantAlsoNegotiatesError(this.response.clone());
  }
}
