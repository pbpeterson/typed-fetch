import { BaseHttpError } from "./base-http-error";

const PAYMENT_REQUIRED_ERROR_STATUS = 402;
const ERROR_STATUS_TEXT = "Payment Required";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402 */
export class PaymentRequiredError extends BaseHttpError {
  public readonly status: 402 = PAYMENT_REQUIRED_ERROR_STATUS;
  public readonly statusText: "Payment Required" = ERROR_STATUS_TEXT;
  static readonly status: 402 = PAYMENT_REQUIRED_ERROR_STATUS;
  static readonly statusText: "Payment Required" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): PaymentRequiredError {
    return new PaymentRequiredError(this.response.clone());
  }
}