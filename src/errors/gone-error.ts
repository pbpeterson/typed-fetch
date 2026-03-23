import { BaseHttpError } from "./base-http-error";

const GONE_ERROR_STATUS = 410;
const ERROR_STATUS_TEXT = "Gone";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/410 */
export class GoneError extends BaseHttpError {
  public readonly status: 410 = GONE_ERROR_STATUS;
  public readonly statusText: "Gone" = ERROR_STATUS_TEXT;
  static readonly status: 410 = GONE_ERROR_STATUS;
  static readonly statusText: "Gone" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): GoneError {
    return new GoneError(this.response.clone());
  }
}