import { BaseHttpError } from "./base-http-error";

const PRECONDITION_REQUIRED_ERROR_STATUS = 428;
const ERROR_STATUS_TEXT = "Precondition Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/428

export class PreconditionRequiredError extends BaseHttpError {
  public readonly status: number = PRECONDITION_REQUIRED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = PRECONDITION_REQUIRED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): PreconditionRequiredError {
    return new PreconditionRequiredError(this.response.clone());
  }
}