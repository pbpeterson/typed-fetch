import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/426 */
export class UpgradeRequiredError extends BaseHttpError {
  public readonly status = 426 as const;
  public readonly statusText = "Upgrade Required" as const;
  static readonly status = 426 as const;
  static readonly statusText = "Upgrade Required" as const;
}
