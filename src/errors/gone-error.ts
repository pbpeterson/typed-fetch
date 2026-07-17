import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/410 */
export class GoneError extends KnownHttpError {
  override readonly name = "GoneError" as const;
  public readonly status = 410 as const;
  public readonly statusText = "Gone" as const;
  static readonly status = 410 as const;
  static readonly statusText = "Gone" as const;
}
