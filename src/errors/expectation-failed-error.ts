import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/417 */
export class ExpectationFailedError extends BaseHttpError {
  public readonly status = 417 as const;
  public readonly statusText = "Expectation Failed" as const;
  static readonly status = 417 as const;
  static readonly statusText = "Expectation Failed" as const;
}
