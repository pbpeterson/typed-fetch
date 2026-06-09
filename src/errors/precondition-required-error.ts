import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/428 */
export class PreconditionRequiredError extends BaseHttpError {
  public readonly status = 428 as const;
  public readonly statusText = "Precondition Required" as const;
  static readonly status = 428 as const;
  static readonly statusText = "Precondition Required" as const;
}
