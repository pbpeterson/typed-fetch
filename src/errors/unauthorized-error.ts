import { BaseHttpError } from "./base-http-error";

const UNAUTHORIZED_ERROR_STATUS = 401;
const ERROR_STATUS_TEXT = "Unauthorized";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401 */
export class UnauthorizedError extends BaseHttpError {
  public readonly status: 401 = UNAUTHORIZED_ERROR_STATUS;
  public readonly statusText: "Unauthorized" = ERROR_STATUS_TEXT;
  static readonly status: 401 = UNAUTHORIZED_ERROR_STATUS;
  static readonly statusText: "Unauthorized" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UnauthorizedError {
    return new UnauthorizedError(this.response.clone());
  }
}