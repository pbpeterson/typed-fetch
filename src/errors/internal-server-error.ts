import { BaseHttpError } from "./base-http-error";

const INTERNAL_SERVER_ERROR_STATUS = 500;
const ERROR_STATUS_TEXT = "Internal Server Error";
//https://developer.mozilla.org/en-us/docs/web/http/status/500

export class InternalServerError extends BaseHttpError {
  public readonly status: number = INTERNAL_SERVER_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = INTERNAL_SERVER_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): InternalServerError {
    return new InternalServerError(this.response.clone());
  }
}
