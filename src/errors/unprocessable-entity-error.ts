import { BaseHttpError } from "./base-http-error";

const UNPROCESSABLE_ENTITY_ERROR_STATUS = 422;
const ERROR_STATUS_TEXT = "Unprocessable Entity";
//https://developer.mozilla.org/en-us/docs/web/http/status/422

export class UnprocessableEntityError extends BaseHttpError {
  public readonly status: 422 = UNPROCESSABLE_ENTITY_ERROR_STATUS;
  public readonly statusText: "Unprocessable Entity" = ERROR_STATUS_TEXT;
  static readonly status: 422 = UNPROCESSABLE_ENTITY_ERROR_STATUS;
  static readonly statusText: "Unprocessable Entity" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UnprocessableEntityError {
    return new UnprocessableEntityError(this.response.clone());
  }
}