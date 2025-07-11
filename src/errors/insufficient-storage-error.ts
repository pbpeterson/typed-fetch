import { BaseHttpError } from "./base-http-error";

const INSUFFICIENT_STORAGE_ERROR_STATUS = 507;
const ERROR_STATUS_TEXT = "Insufficient Storage";
//https://developer.mozilla.org/en-us/docs/web/http/status/507

export class InsufficientStorageError extends BaseHttpError {
  public readonly status: number = INSUFFICIENT_STORAGE_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = INSUFFICIENT_STORAGE_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): InsufficientStorageError {
    return new InsufficientStorageError(this.response.clone());
  }
}