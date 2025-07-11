import { BaseHttpError } from "./base-http-error";

const PRECONDITION_FAILED_ERROR_STATUS = 412;
const ERROR_STATUS_TEXT = "Precondition Failed";
//https://developer.mozilla.org/en-us/docs/web/http/status/412

export class PreconditionFailedError extends BaseHttpError {
  public readonly status: number = PRECONDITION_FAILED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = PRECONDITION_FAILED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): PreconditionFailedError {
    return new PreconditionFailedError(this.response.clone());
  }
}