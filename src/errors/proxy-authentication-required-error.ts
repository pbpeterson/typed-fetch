import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/407 */
export class ProxyAuthenticationRequiredError extends BaseHttpError {
  public readonly status = 407 as const;
  public readonly statusText = "Proxy Authentication Required" as const;
  static readonly status = 407 as const;
  static readonly statusText = "Proxy Authentication Required" as const;
}
