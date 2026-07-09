import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/418 */
export class ImATeapotError extends BaseHttpError {
  override readonly name = "ImATeapotError" as const;
  public readonly status = 418 as const;
  public readonly statusText = "I'm a teapot" as const;
  static readonly status = 418 as const;
  static readonly statusText = "I'm a teapot" as const;
}
