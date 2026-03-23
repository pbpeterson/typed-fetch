import { BaseHttpError } from "./base-http-error";

const PROXY_AUTHENTICATION_REQUIRED_ERROR_STATUS = 407;
const ERROR_STATUS_TEXT = "Proxy Authentication Required";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/407 */
export class ProxyAuthenticationRequiredError extends BaseHttpError {
  public readonly status: 407 = PROXY_AUTHENTICATION_REQUIRED_ERROR_STATUS;
  public readonly statusText: "Proxy Authentication Required" = ERROR_STATUS_TEXT;
  static readonly status: 407 = PROXY_AUTHENTICATION_REQUIRED_ERROR_STATUS;
  static readonly statusText: "Proxy Authentication Required" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ProxyAuthenticationRequiredError {
    return new ProxyAuthenticationRequiredError(this.response.clone());
  }
}