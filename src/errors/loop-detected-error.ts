import { BaseHttpError } from "./base-http-error";

const LOOP_DETECTED_ERROR_STATUS = 508;
const ERROR_STATUS_TEXT = "Loop Detected";
//https://developer.mozilla.org/en-us/docs/web/http/status/508

export class LoopDetectedError extends BaseHttpError {
  public readonly status: number = LOOP_DETECTED_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = LOOP_DETECTED_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): LoopDetectedError {
    return new LoopDetectedError(this.response.clone());
  }
}
