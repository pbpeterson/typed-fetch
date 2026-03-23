import { BaseHttpError } from "./base-http-error";

const NOT_ACCEPTABLE_ERROR_STATUS = 406;
const ERROR_STATUS_TEXT = "Not Acceptable";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/406 */
export class NotAcceptableError extends BaseHttpError {
  public readonly status: 406 = NOT_ACCEPTABLE_ERROR_STATUS;
  public readonly statusText: "Not Acceptable" = ERROR_STATUS_TEXT;
  static readonly status: 406 = NOT_ACCEPTABLE_ERROR_STATUS;
  static readonly statusText: "Not Acceptable" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): NotAcceptableError {
    return new NotAcceptableError(this.response.clone());
  }
}