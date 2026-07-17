import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/422 */
export class UnprocessableEntityError extends KnownHttpError {
  override readonly name = "UnprocessableEntityError" as const;
  public readonly status = 422 as const;
  public readonly statusText = "Unprocessable Content" as const;
  static readonly status = 422 as const;
  static readonly statusText = "Unprocessable Content" as const;
}
