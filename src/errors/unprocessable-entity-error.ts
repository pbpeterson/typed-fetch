import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/422 */
export class UnprocessableEntityError extends BaseHttpError {
  public readonly status = 422 as const;
  public readonly statusText = "Unprocessable Entity" as const;
  static readonly status = 422 as const;
  static readonly statusText = "Unprocessable Entity" as const;
}
