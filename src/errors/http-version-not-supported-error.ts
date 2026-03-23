import { BaseHttpError } from "./base-http-error";

const HTTP_VERSION_NOT_SUPPORTED_ERROR_STATUS = 505;
const ERROR_STATUS_TEXT = "HTTP Version Not Supported";
//https://developer.mozilla.org/en-us/docs/web/http/status/505

export class HttpVersionNotSupportedError extends BaseHttpError {
  public readonly status: 505 = HTTP_VERSION_NOT_SUPPORTED_ERROR_STATUS;
  public readonly statusText: "HTTP Version Not Supported" = ERROR_STATUS_TEXT;
  static readonly status: 505 = HTTP_VERSION_NOT_SUPPORTED_ERROR_STATUS;
  static readonly statusText: "HTTP Version Not Supported" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): HttpVersionNotSupportedError {
    return new HttpVersionNotSupportedError(this.response.clone());
  }
}