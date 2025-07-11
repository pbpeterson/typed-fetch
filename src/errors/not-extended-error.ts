import { BaseHttpError } from "./base-http-error";

const NOT_EXTENDED_ERROR_STATUS = 510;
const ERROR_STATUS_TEXT = "Not Extended";
//https://developer.mozilla.org/en-us/docs/web/http/status/510

export class NotExtendedError extends BaseHttpError {
  public readonly status: number = NOT_EXTENDED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = NOT_EXTENDED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): NotExtendedError {
    return new NotExtendedError(this.response.clone());
  }
}
