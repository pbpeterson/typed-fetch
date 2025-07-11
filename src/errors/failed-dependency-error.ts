import { BaseHttpError } from "./base-http-error";

const FAILED_DEPENDENCY_ERROR_STATUS = 424;
const ERROR_STATUS_TEXT = "Failed Dependency";
//https://developer.mozilla.org/en-us/docs/web/http/status/424

export class FailedDependencyError extends BaseHttpError {
  public readonly status: number = FAILED_DEPENDENCY_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = FAILED_DEPENDENCY_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): FailedDependencyError {
    return new FailedDependencyError(this.response.clone());
  }
}