import { BaseHttpError } from "./base-http-error";

const BAD_REQUEST_ERROR_STATUS = 400;
const ERROR_STATUS_TEXT = "Bad Request";
//https://developer.mozilla.org/en-us/docs/web/http/status/400

export class BadRequestError extends BaseHttpError {
  public readonly status: number = BAD_REQUEST_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = BAD_REQUEST_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): BadRequestError {
    return new BadRequestError(this.response.clone());
  }
}
