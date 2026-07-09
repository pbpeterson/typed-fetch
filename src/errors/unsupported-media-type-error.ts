import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/415 */
export class UnsupportedMediaTypeError extends BaseHttpError {
  override readonly name = "UnsupportedMediaTypeError" as const;
  public readonly status = 415 as const;
  public readonly statusText = "Unsupported Media Type" as const;
  static readonly status = 415 as const;
  static readonly statusText = "Unsupported Media Type" as const;
}
