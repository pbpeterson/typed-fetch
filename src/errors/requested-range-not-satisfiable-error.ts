import { BaseHttpError } from "./base-http-error";

const REQUESTED_RANGE_NOT_SATISFIABLE_ERROR_STATUS = 416;
const ERROR_STATUS_TEXT = "Range Not Satisfiable";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/416 */
export class RequestedRangeNotSatisfiableError extends BaseHttpError {
  public readonly status: 416 = REQUESTED_RANGE_NOT_SATISFIABLE_ERROR_STATUS;
  public readonly statusText: "Range Not Satisfiable" = ERROR_STATUS_TEXT;
  static readonly status: 416 = REQUESTED_RANGE_NOT_SATISFIABLE_ERROR_STATUS;
  static readonly statusText: "Range Not Satisfiable" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): RequestedRangeNotSatisfiableError {
    return new RequestedRangeNotSatisfiableError(this.response.clone());
  }
}