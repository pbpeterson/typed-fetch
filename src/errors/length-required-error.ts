import { BaseHttpError } from "./base-http-error";

const LENGTH_REQUIRED_ERROR_STATUS = 411;
const ERROR_STATUS_TEXT = "Length Required";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/411 */
export class LengthRequiredError extends BaseHttpError {
  public readonly status: 411 = LENGTH_REQUIRED_ERROR_STATUS;
  public readonly statusText: "Length Required" = ERROR_STATUS_TEXT;
  static readonly status: 411 = LENGTH_REQUIRED_ERROR_STATUS;
  static readonly statusText: "Length Required" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): LengthRequiredError {
    return new LengthRequiredError(this.response.clone());
  }
}