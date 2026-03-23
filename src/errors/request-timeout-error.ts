import { BaseHttpError } from "./base-http-error";

const REQUEST_TIMEOUT_ERROR_STATUS = 408;
const ERROR_STATUS_TEXT = "Request Timeout";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408 */
export class RequestTimeoutError extends BaseHttpError {
  public readonly status: 408 = REQUEST_TIMEOUT_ERROR_STATUS;
  public readonly statusText: "Request Timeout" = ERROR_STATUS_TEXT;
  static readonly status: 408 = REQUEST_TIMEOUT_ERROR_STATUS;
  static readonly statusText: "Request Timeout" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestTimeoutError {
    return new RequestTimeoutError(this.response.clone());
  }
}