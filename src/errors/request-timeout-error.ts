import { BaseHttpError } from "./base-http-error";

const REQUEST_TIMEOUT_ERROR_STATUS = 408;
const ERROR_STATUS_TEXT = "Request Timeout";
//https://developer.mozilla.org/en-us/docs/web/http/status/408

export class RequestTimeoutError extends BaseHttpError {
  public readonly status: number = REQUEST_TIMEOUT_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = REQUEST_TIMEOUT_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestTimeoutError {
    return new RequestTimeoutError(this.response.clone());
  }
}