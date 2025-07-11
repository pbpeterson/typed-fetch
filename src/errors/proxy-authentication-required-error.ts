import { BaseHttpError } from "./base-http-error";

const PROXY_AUTHENTICATION_REQUIRED_ERROR_STATUS = 407;
const ERROR_STATUS_TEXT = "Proxy Authentication Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/407

export class ProxyAuthenticationRequiredError extends BaseHttpError {
  public readonly status: number = PROXY_AUTHENTICATION_REQUIRED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = PROXY_AUTHENTICATION_REQUIRED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ProxyAuthenticationRequiredError {
    return new ProxyAuthenticationRequiredError(this.response.clone());
  }
}