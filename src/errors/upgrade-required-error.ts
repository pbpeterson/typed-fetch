import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/426 */
export class UpgradeRequiredError extends KnownHttpError {
  override readonly name = "UpgradeRequiredError" as const;
  public readonly status = 426 as const;
  public readonly statusText = "Upgrade Required" as const;
  static readonly status = 426 as const;
  static readonly statusText = "Upgrade Required" as const;
}
