import { BaseHttpError } from "./base-http-error";

const BAD_REQUEST_ERROR_STATUS = 400;
const ERROR_STATUS_TEXT = "Bad Request";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400 */
export class BadRequestError extends BaseHttpError {
  public readonly status: 400 = BAD_REQUEST_ERROR_STATUS;
  public readonly statusText: "Bad Request" = ERROR_STATUS_TEXT;
  static readonly status: 400 = BAD_REQUEST_ERROR_STATUS;
  static readonly statusText: "Bad Request" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): BadRequestError {
    return new BadRequestError(this.response.clone());
  }
}
