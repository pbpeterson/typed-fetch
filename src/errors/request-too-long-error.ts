import { BaseHttpError } from "./base-http-error";

const REQUEST_TOO_LONG_ERROR_STATUS = 413;
const ERROR_STATUS_TEXT = "Payload Too Large";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413 */
export class RequestTooLongError extends BaseHttpError {
  public readonly status: 413 = REQUEST_TOO_LONG_ERROR_STATUS;
  public readonly statusText: "Payload Too Large" = ERROR_STATUS_TEXT;
  static readonly status: 413 = REQUEST_TOO_LONG_ERROR_STATUS;
  static readonly statusText: "Payload Too Large" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestTooLongError {
    return new RequestTooLongError(this.response.clone());
  }
}