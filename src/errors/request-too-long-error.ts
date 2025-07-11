import { BaseHttpError } from "./base-http-error";

const REQUEST_TOO_LONG_ERROR_STATUS = 413;
const ERROR_STATUS_TEXT = "Payload Too Large";
//https://developer.mozilla.org/en-us/docs/web/http/status/413

export class RequestTooLongError extends BaseHttpError {
  public readonly status: number = REQUEST_TOO_LONG_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = REQUEST_TOO_LONG_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestTooLongError {
    return new RequestTooLongError(this.response.clone());
  }
}