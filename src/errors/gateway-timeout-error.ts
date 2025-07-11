import { BaseHttpError } from "./base-http-error";

const GATEWAY_TIMEOUT_ERROR_STATUS = 504;
const ERROR_STATUS_TEXT = "Gateway Timeout";
//https://developer.mozilla.org/en-us/docs/web/http/status/504

export class GatewayTimeoutError extends BaseHttpError {
  public readonly status: number = GATEWAY_TIMEOUT_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = GATEWAY_TIMEOUT_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): GatewayTimeoutError {
    return new GatewayTimeoutError(this.response.clone());
  }
}