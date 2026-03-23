import { BaseHttpError } from "./base-http-error";

const GATEWAY_TIMEOUT_ERROR_STATUS = 504;
const ERROR_STATUS_TEXT = "Gateway Timeout";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504 */
export class GatewayTimeoutError extends BaseHttpError {
  public readonly status: 504 = GATEWAY_TIMEOUT_ERROR_STATUS;
  public readonly statusText: "Gateway Timeout" = ERROR_STATUS_TEXT;
  static readonly status: 504 = GATEWAY_TIMEOUT_ERROR_STATUS;
  static readonly statusText: "Gateway Timeout" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): GatewayTimeoutError {
    return new GatewayTimeoutError(this.response.clone());
  }
}