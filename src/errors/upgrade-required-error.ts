import { BaseHttpError } from "./base-http-error";

const UPGRADE_REQUIRED_ERROR_STATUS = 426;
const ERROR_STATUS_TEXT = "Upgrade Required";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/426 */
export class UpgradeRequiredError extends BaseHttpError {
  public readonly status: 426 = UPGRADE_REQUIRED_ERROR_STATUS;
  public readonly statusText: "Upgrade Required" = ERROR_STATUS_TEXT;
  static readonly status: 426 = UPGRADE_REQUIRED_ERROR_STATUS;
  static readonly statusText: "Upgrade Required" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UpgradeRequiredError {
    return new UpgradeRequiredError(this.response.clone());
  }
}