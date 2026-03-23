import { BaseHttpError } from "./base-http-error";

const BAD_GATEWAY_ERROR_STATUS = 502;
const ERROR_STATUS_TEXT = "Bad Gateway";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502 */
export class BadGatewayError extends BaseHttpError {
  public readonly status: 502 = BAD_GATEWAY_ERROR_STATUS;
  public readonly statusText: "Bad Gateway" = ERROR_STATUS_TEXT;
  static readonly status: 502 = BAD_GATEWAY_ERROR_STATUS;
  static readonly statusText: "Bad Gateway" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): BadGatewayError {
    return new BadGatewayError(this.response.clone());
  }
}
