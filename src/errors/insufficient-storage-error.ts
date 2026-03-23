import { BaseHttpError } from "./base-http-error";

const INSUFFICIENT_STORAGE_ERROR_STATUS = 507;
const ERROR_STATUS_TEXT = "Insufficient Storage";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/507 */
export class InsufficientStorageError extends BaseHttpError {
  public readonly status: 507 = INSUFFICIENT_STORAGE_ERROR_STATUS;
  public readonly statusText: "Insufficient Storage" = ERROR_STATUS_TEXT;
  static readonly status: 507 = INSUFFICIENT_STORAGE_ERROR_STATUS;
  static readonly statusText: "Insufficient Storage" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): InsufficientStorageError {
    return new InsufficientStorageError(this.response.clone());
  }
}