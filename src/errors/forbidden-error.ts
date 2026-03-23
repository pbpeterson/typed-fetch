import { BaseHttpError } from "./base-http-error";

const FORBIDDEN_ERROR_STATUS = 403;
const ERROR_STATUS_TEXT = "Forbidden";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403 */
export class ForbiddenError extends BaseHttpError {
  public readonly status: 403 = FORBIDDEN_ERROR_STATUS;
  public readonly statusText: "Forbidden" = ERROR_STATUS_TEXT;
  static readonly status: 403 = FORBIDDEN_ERROR_STATUS;
  static readonly statusText: "Forbidden" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ForbiddenError {
    return new ForbiddenError(this.response.clone());
  }
}