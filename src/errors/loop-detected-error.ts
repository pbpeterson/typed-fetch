import { BaseHttpError } from "./base-http-error";

const LOOP_DETECTED_ERROR_STATUS = 508;
const ERROR_STATUS_TEXT = "Loop Detected";
/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/508 */
export class LoopDetectedError extends BaseHttpError {
  public readonly status: 508 = LOOP_DETECTED_ERROR_STATUS;
  public readonly statusText: "Loop Detected" = ERROR_STATUS_TEXT;
  static readonly status: 508 = LOOP_DETECTED_ERROR_STATUS;
  static readonly statusText: "Loop Detected" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): LoopDetectedError {
    return new LoopDetectedError(this.response.clone());
  }
}
