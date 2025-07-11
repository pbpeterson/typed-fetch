import { BaseHttpError } from "./base-http-error";

const NETWORK_AUTHENTICATION_REQUIRED_ERROR_STATUS = 511;
const ERROR_STATUS_TEXT = "Network Authentication Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/511

export class NetworkAuthenticationRequiredError extends BaseHttpError {
  public readonly status: number = NETWORK_AUTHENTICATION_REQUIRED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = NETWORK_AUTHENTICATION_REQUIRED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): NetworkAuthenticationRequiredError {
    return new NetworkAuthenticationRequiredError(this.response.clone());
  }
}