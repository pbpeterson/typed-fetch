import { BaseHttpError } from "./base-http-error";

/**
 * HTTP error for status codes >= 400 that have no dedicated error class
 * (non-standard or vendor-specific codes such as 420, 444, or 599).
 *
 * Unlike the other error classes, `status` and `statusText` are not literal
 * types — they reflect whatever the server actually sent.
 */
export class UnknownHttpError extends BaseHttpError {
  public readonly status: number;
  public readonly statusText: string;

  constructor(response: Response) {
    super(response);
    this.status = response.status;
    this.statusText = response.statusText;
  }

  clone(): UnknownHttpError {
    return new UnknownHttpError(this.response.clone());
  }
}
