import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402 */
export class PaymentRequiredError extends BaseHttpError {
  public readonly status = 402 as const;
  public readonly statusText = "Payment Required" as const;
  static readonly status = 402 as const;
  static readonly statusText = "Payment Required" as const;
}
