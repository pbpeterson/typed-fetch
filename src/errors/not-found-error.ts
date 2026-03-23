import { BaseHttpError } from "./base-http-error";

const NOT_FOUND_ERROR_STATUS = 404;
const ERROR_STATUS_TEXT = "Not Found";
//https://developer.mozilla.org/en-us/docs/web/http/status/404

export class NotFoundError extends BaseHttpError {
  public readonly status: 404 = NOT_FOUND_ERROR_STATUS;
  public readonly statusText: "Not Found" = ERROR_STATUS_TEXT;
  static readonly status: 404 = NOT_FOUND_ERROR_STATUS;
  static readonly statusText: "Not Found" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): NotFoundError {
    return new NotFoundError(this.response.clone());
  }
}