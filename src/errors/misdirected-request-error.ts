import { BaseHttpError } from "./base-http-error";

const MISDIRECTED_REQUEST_ERROR_STATUS = 421;
const ERROR_STATUS_TEXT = "Misdirected Request";
//https://developer.mozilla.org/en-us/docs/web/http/status/421

export class MisdirectedRequestError extends BaseHttpError {
  public readonly status: 421 = MISDIRECTED_REQUEST_ERROR_STATUS;
  public readonly statusText: "Misdirected Request" = ERROR_STATUS_TEXT;
  static readonly status: 421 = MISDIRECTED_REQUEST_ERROR_STATUS;
  static readonly statusText: "Misdirected Request" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): MisdirectedRequestError {
    return new MisdirectedRequestError(this.response.clone());
  }
}