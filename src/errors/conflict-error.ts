import { BaseHttpError } from "./base-http-error";

const CONFLICT_ERROR_STATUS = 409;
const ERROR_STATUS_TEXT = "Conflict";
//https://developer.mozilla.org/en-us/docs/web/http/status/409

export class ConflictError extends BaseHttpError {
  public readonly status: number = CONFLICT_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = CONFLICT_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ConflictError {
    return new ConflictError(this.response.clone());
  }
}