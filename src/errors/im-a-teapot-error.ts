import { BaseHttpError } from "./base-http-error";

const IM_A_TEAPOT_ERROR_STATUS = 418;
const ERROR_STATUS_TEXT = "I'm a teapot";
//https://developer.mozilla.org/en-us/docs/web/http/status/418

export class ImATeapotError extends BaseHttpError {
  public readonly status: 418 = IM_A_TEAPOT_ERROR_STATUS;
  public readonly statusText: "I'm a teapot" = ERROR_STATUS_TEXT;
  static readonly status: 418 = IM_A_TEAPOT_ERROR_STATUS;
  static readonly statusText: "I'm a teapot" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ImATeapotError {
    return new ImATeapotError(this.response.clone());
  }
}