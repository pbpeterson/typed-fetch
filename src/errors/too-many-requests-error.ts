import { BaseHttpError } from "./base-http-error";

const TOO_MANY_REQUESTS_ERROR_STATUS = 429;
const ERROR_STATUS_TEXT = "Too Many Requests";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429 */
export class TooManyRequestsError extends BaseHttpError {
  public readonly status: 429 = TOO_MANY_REQUESTS_ERROR_STATUS;
  public readonly statusText: "Too Many Requests" = ERROR_STATUS_TEXT;
  static readonly status: 429 = TOO_MANY_REQUESTS_ERROR_STATUS;
  static readonly statusText: "Too Many Requests" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): TooManyRequestsError {
    return new TooManyRequestsError(this.response.clone());
  }
}