import { BaseHttpError } from "./base-http-error";

const NOT_IMPLEMENTED_ERROR_STATUS = 501;
const ERROR_STATUS_TEXT = "Not Implemented";
//https://developer.mozilla.org/en-us/docs/web/http/status/501

export class NotImplementedError extends BaseHttpError {
  public readonly status: number = NOT_IMPLEMENTED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = NOT_IMPLEMENTED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): NotImplementedError {
    return new NotImplementedError(this.response.clone());
  }
}