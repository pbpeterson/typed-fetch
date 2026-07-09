import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/511 */
export class NetworkAuthenticationRequiredError extends BaseHttpError {
  override readonly name = "NetworkAuthenticationRequiredError" as const;
  public readonly status = 511 as const;
  public readonly statusText = "Network Authentication Required" as const;
  static readonly status = 511 as const;
  static readonly statusText = "Network Authentication Required" as const;
}
