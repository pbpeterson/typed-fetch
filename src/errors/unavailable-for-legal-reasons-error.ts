import { BaseHttpError } from "./base-http-error";

const UNAVAILABLE_FOR_LEGAL_REASONS_ERROR_STATUS = 451;
const ERROR_STATUS_TEXT = "Unavailable For Legal Reasons";
//https://developer.mozilla.org/en-us/docs/web/http/status/451

export class UnavailableForLegalReasonsError extends BaseHttpError {
  public readonly status: number = UNAVAILABLE_FOR_LEGAL_REASONS_ERROR_STATUS;
  public readonly statusText: string = ERROR_STATUS_TEXT;
  static readonly status: number = UNAVAILABLE_FOR_LEGAL_REASONS_ERROR_STATUS;
  static readonly statusText: string = ERROR_STATUS_TEXT;

  constructor(response: Response) {
    super(response);
  }

  clone(): UnavailableForLegalReasonsError {
    return new UnavailableForLegalReasonsError(this.response.clone());
  }
}