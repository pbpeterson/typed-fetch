import { BaseHttpError } from "./base-http-error";

const UNSUPPORTED_MEDIA_TYPE_ERROR_STATUS = 415;
const ERROR_STATUS_TEXT = "Unsupported Media Type";
//https://developer.mozilla.org/en-us/docs/web/http/status/415

export class UnsupportedMediaTypeError extends BaseHttpError {
  public readonly status: number = UNSUPPORTED_MEDIA_TYPE_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = UNSUPPORTED_MEDIA_TYPE_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UnsupportedMediaTypeError {
    return new UnsupportedMediaTypeError(this.response.clone());
  }
}