import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/421 */
export class MisdirectedRequestError extends BaseHttpError {
  override readonly name = "MisdirectedRequestError" as const;
  public readonly status = 421 as const;
  public readonly statusText = "Misdirected Request" as const;
  static readonly status = 421 as const;
  static readonly statusText = "Misdirected Request" as const;
}
