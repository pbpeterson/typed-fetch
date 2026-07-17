import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402 */
export class PaymentRequiredError extends KnownHttpError {
  override readonly name = "PaymentRequiredError" as const;
  public readonly status = 402 as const;
  public readonly statusText = "Payment Required" as const;
  static readonly status = 402 as const;
  static readonly statusText = "Payment Required" as const;
}
