import { BaseHttpError } from "./base-http-error";

const REQUEST_URI_TOO_LONG_ERROR_STATUS = 414;
const ERROR_STATUS_TEXT = "URI Too Long";
//https://developer.mozilla.org/en-us/docs/web/http/status/414

export class RequestUriTooLongError extends BaseHttpError {
  public readonly status: number = REQUEST_URI_TOO_LONG_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = REQUEST_URI_TOO_LONG_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestUriTooLongError {
    return new RequestUriTooLongError(this.response.clone());
  }
}