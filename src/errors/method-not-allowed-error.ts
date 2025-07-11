import { BaseHttpError } from "./base-http-error";

const METHOD_NOT_ALLOWED_ERROR_STATUS = 405;
const ERROR_STATUS_TEXT = "Method Not Allowed";
//https://developer.mozilla.org/en-us/docs/web/http/status/405

export class MethodNotAllowedError extends BaseHttpError {
  public readonly status: number = METHOD_NOT_ALLOWED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = METHOD_NOT_ALLOWED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): MethodNotAllowedError {
    return new MethodNotAllowedError(this.response.clone());
  }
}