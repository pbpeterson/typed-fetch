import { BaseHttpError } from "./base-http-error";

const TOO_MANY_REQUESTS_ERROR_STATUS = 429;
const ERROR_STATUS_TEXT = "Too Many Requests";
//https://developer.mozilla.org/en-us/docs/web/http/status/429

export class TooManyRequestsError extends BaseHttpError {
  public readonly status: number = TOO_MANY_REQUESTS_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = TOO_MANY_REQUESTS_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): TooManyRequestsError {
    return new TooManyRequestsError(this.response.clone());
  }
}