import { BaseHttpError } from "./base-http-error";

const METHOD_NOT_ALLOWED_ERROR_STATUS = 405;
const ERROR_STATUS_TEXT = "Method Not Allowed";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405 */
export class MethodNotAllowedError extends BaseHttpError {
  public readonly status: 405 = METHOD_NOT_ALLOWED_ERROR_STATUS;
  public readonly statusText: "Method Not Allowed" = ERROR_STATUS_TEXT;
  static readonly status: 405 = METHOD_NOT_ALLOWED_ERROR_STATUS;
  static readonly statusText: "Method Not Allowed" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): MethodNotAllowedError {
    return new MethodNotAllowedError(this.response.clone());
  }
}