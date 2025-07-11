import { BaseHttpError } from "./base-http-error";

const VARIANT_ALSO_NEGOTIATES_ERROR_STATUS = 506;
const ERROR_STATUS_TEXT = "Variant Also Negotiates";
//https://developer.mozilla.org/en-us/docs/web/http/status/506

export class VariantAlsoNegotiatesError extends BaseHttpError {
  public readonly status: number = VARIANT_ALSO_NEGOTIATES_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = VARIANT_ALSO_NEGOTIATES_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): VariantAlsoNegotiatesError {
    return new VariantAlsoNegotiatesError(this.response.clone());
  }
}
