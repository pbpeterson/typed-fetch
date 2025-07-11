import { BaseHttpError } from "./base-http-error";

const REQUEST_HEADER_FIELDS_TOO_LARGE_ERROR_STATUS = 431;
const ERROR_STATUS_TEXT = "Request Header Fields Too Large";
//https://developer.mozilla.org/en-us/docs/web/http/status/431

export class RequestHeaderFieldsTooLargeError extends BaseHttpError {
  public readonly status: number = REQUEST_HEADER_FIELDS_TOO_LARGE_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = REQUEST_HEADER_FIELDS_TOO_LARGE_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestHeaderFieldsTooLargeError {
    return new RequestHeaderFieldsTooLargeError(this.response.clone());
  }
}