import { BaseHttpError } from "./base-http-error";

const REQUEST_URI_TOO_LONG_ERROR_STATUS = 414;
const ERROR_STATUS_TEXT = "URI Too Long";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/414 */
export class RequestUriTooLongError extends BaseHttpError {
  public readonly status: 414 = REQUEST_URI_TOO_LONG_ERROR_STATUS;
  public readonly statusText: "URI Too Long" = ERROR_STATUS_TEXT;
  static readonly status: 414 = REQUEST_URI_TOO_LONG_ERROR_STATUS;
  static readonly statusText: "URI Too Long" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestUriTooLongError {
    return new RequestUriTooLongError(this.response.clone());
  }
}