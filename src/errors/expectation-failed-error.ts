import { BaseHttpError } from "./base-http-error";

const EXPECTATION_FAILED_ERROR_STATUS = 417;
const ERROR_STATUS_TEXT = "Expectation Failed";
//https://developer.mozilla.org/en-us/docs/web/http/status/417

export class ExpectationFailedError extends BaseHttpError {
  public readonly status: 417 = EXPECTATION_FAILED_ERROR_STATUS;
  public readonly statusText: "Expectation Failed" = ERROR_STATUS_TEXT;
  static readonly status: 417 = EXPECTATION_FAILED_ERROR_STATUS;
  static readonly statusText: "Expectation Failed" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ExpectationFailedError {
    return new ExpectationFailedError(this.response.clone());
  }
}