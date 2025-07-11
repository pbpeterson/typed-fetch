import { BaseHttpError } from "./base-http-error";

const UPGRADE_REQUIRED_ERROR_STATUS = 426;
const ERROR_STATUS_TEXT = "Upgrade Required";
//https://developer.mozilla.org/en-us/docs/web/http/status/426

export class UpgradeRequiredError extends BaseHttpError {
  public readonly status: number = UPGRADE_REQUIRED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = UPGRADE_REQUIRED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UpgradeRequiredError {
    return new UpgradeRequiredError(this.response.clone());
  }
}