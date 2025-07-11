import { BaseHttpError } from "./base-http-error";

const PAYMENT_REQUIRED_ERROR_STATUS = 402;
const ERROR_STATUS_TEXT = "Payment Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/402

export class PaymentRequiredError extends BaseHttpError {
  public readonly status: number = PAYMENT_REQUIRED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = PAYMENT_REQUIRED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): PaymentRequiredError {
    return new PaymentRequiredError(this.response.clone());
  }
}