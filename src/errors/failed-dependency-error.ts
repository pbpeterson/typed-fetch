import { BaseHttpError } from "./base-http-error";

const FAILED_DEPENDENCY_ERROR_STATUS = 424;
const ERROR_STATUS_TEXT = "Failed Dependency";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/424 */
export class FailedDependencyError extends BaseHttpError {
  public readonly status: 424 = FAILED_DEPENDENCY_ERROR_STATUS;
  public readonly statusText: "Failed Dependency" = ERROR_STATUS_TEXT;
  static readonly status: 424 = FAILED_DEPENDENCY_ERROR_STATUS;
  static readonly statusText: "Failed Dependency" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): FailedDependencyError {
    return new FailedDependencyError(this.response.clone());
  }
}