import { BaseHttpError } from "./base-http-error";

const REQUESTED_RANGE_NOT_SATISFIABLE_ERROR_STATUS = 416;
const ERROR_STATUS_TEXT = "Range Not Satisfiable";
//https://developer.mozilla.org/en-us/docs/web/http/status/416

export class RequestedRangeNotSatisfiableError extends BaseHttpError {
  public readonly status: number = REQUESTED_RANGE_NOT_SATISFIABLE_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = REQUESTED_RANGE_NOT_SATISFIABLE_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestedRangeNotSatisfiableError {
    return new RequestedRangeNotSatisfiableError(this.response.clone());
  }
}