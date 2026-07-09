import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/508 */
export class LoopDetectedError extends BaseHttpError {
  override readonly name = "LoopDetectedError" as const;
  public readonly status = 508 as const;
  public readonly statusText = "Loop Detected" as const;
  static readonly status = 508 as const;
  static readonly statusText = "Loop Detected" as const;
}
