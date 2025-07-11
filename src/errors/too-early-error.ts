import { BaseHttpError } from "./base-http-error";

const TOO_EARLY_ERROR_STATUS = 425;
const ERROR_STATUS_TEXT = "Too Early";
//https://developer.mozilla.org/en-us/docs/web/http/status/425

export class TooEarlyError extends BaseHttpError {
  public readonly status: number = TOO_EARLY_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = TOO_EARLY_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): TooEarlyError {
    return new TooEarlyError(this.response.clone());
  }
}
