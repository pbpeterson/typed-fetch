import { BaseHttpError } from "./base-http-error";

const PRECONDITION_REQUIRED_ERROR_STATUS = 428;
const ERROR_STATUS_TEXT = "Precondition Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/428

export class PreconditionRequiredError extends BaseHttpError {
  public readonly status: 428 = PRECONDITION_REQUIRED_ERROR_STATUS;
  public readonly statusText: "Precondition Required" = ERROR_STATUS_TEXT;
  static readonly status: 428 = PRECONDITION_REQUIRED_ERROR_STATUS;
  static readonly statusText: "Precondition Required" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): PreconditionRequiredError {
    return new PreconditionRequiredError(this.response.clone());
  }
}