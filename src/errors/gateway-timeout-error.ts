import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504 */
export class GatewayTimeoutError extends BaseHttpError {
  public readonly status = 504 as const;
  public readonly statusText = "Gateway Timeout" as const;
  static readonly status = 504 as const;
  static readonly statusText = "Gateway Timeout" as const;
}
