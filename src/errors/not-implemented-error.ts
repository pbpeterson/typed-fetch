import { BaseHttpError } from "./base-http-error";

const NOT_IMPLEMENTED_ERROR_STATUS = 501;
const ERROR_STATUS_TEXT = "Not Implemented";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/501 */
export class NotImplementedError extends BaseHttpError {
  public readonly status: 501 = NOT_IMPLEMENTED_ERROR_STATUS;
  public readonly statusText: "Not Implemented" = ERROR_STATUS_TEXT;
  static readonly status: 501 = NOT_IMPLEMENTED_ERROR_STATUS;
  static readonly statusText: "Not Implemented" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): NotImplementedError {
    return new NotImplementedError(this.response.clone());
  }
}