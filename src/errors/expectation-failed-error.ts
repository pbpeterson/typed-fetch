import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/417 */
export class ExpectationFailedError extends KnownHttpError {
  override readonly name = "ExpectationFailedError" as const;
  public readonly status = 417 as const;
  public readonly statusText = "Expectation Failed" as const;
  static readonly status = 417 as const;
  static readonly statusText = "Expectation Failed" as const;
}
