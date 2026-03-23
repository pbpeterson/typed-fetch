import { BaseHttpError } from "./base-http-error";

const SERVICE_UNAVAILABLE_ERROR_STATUS = 503;
const ERROR_STATUS_TEXT = "Service Unavailable";
//https://developer.mozilla.org/en-us/docs/web/http/status/503

export class ServiceUnavailableError extends BaseHttpError {
  public readonly status: 503 = SERVICE_UNAVAILABLE_ERROR_STATUS;
  public readonly statusText: "Service Unavailable" = ERROR_STATUS_TEXT;
  static readonly status: 503 = SERVICE_UNAVAILABLE_ERROR_STATUS;
  static readonly statusText: "Service Unavailable" = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): ServiceUnavailableError {
    return new ServiceUnavailableError(this.response.clone());
  }
}