import { BaseHttpError } from "./base-http-error";

const UNAUTHORIZED_ERROR_STATUS = 401;
const ERROR_STATUS_TEXT = "Unauthorized";
//https://developer.mozilla.org/en-us/docs/web/http/status/401

export class UnauthorizedError extends BaseHttpError {
  public readonly status: number = UNAUTHORIZED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = UNAUTHORIZED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UnauthorizedError {
    return new UnauthorizedError(this.response.clone());
  }
}