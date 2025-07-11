import { BaseHttpError } from "./base-http-error";

const LENGTH_REQUIRED_ERROR_STATUS = 411;
const ERROR_STATUS_TEXT = "Length Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/411

export class LengthRequiredError extends BaseHttpError {
  public readonly status: number = LENGTH_REQUIRED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = LENGTH_REQUIRED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): LengthRequiredError {
    return new LengthRequiredError(this.response.clone());
  }
}