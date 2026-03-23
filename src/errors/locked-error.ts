import { BaseHttpError } from "./base-http-error";

const LOCKED_ERROR_STATUS = 423;
const ERROR_STATUS_TEXT = "Locked";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/423 */
export class LockedError extends BaseHttpError {
  public readonly status: 423 = LOCKED_ERROR_STATUS;
  public readonly statusText: "Locked" = ERROR_STATUS_TEXT;
  static readonly status: 423 = LOCKED_ERROR_STATUS;
  static readonly statusText: "Locked" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): LockedError {
    return new LockedError(this.response.clone());
  }
}