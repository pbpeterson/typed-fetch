import { BaseHttpError } from "./base-http-error";
import { brand, unknownHttpErrorBrand } from "./brand";
import { identityOf } from "./response-identity";

/**
 * HTTP error for status codes >= 400 that have no dedicated error class
 * (non-standard or vendor-specific codes such as 420, 444, or 599).
 *
 * Unlike the other error classes, `status` and `statusText` are not literal
 * types — they reflect whatever the server actually sent. They are the values
 * the response reported on the single read that selected this class, so they
 * agree with the message line and with the `toJSON()` record.
 *
 * `status` is always a `number`: the read is normalized with `Number`, so a
 * custom Fetch implementation that answers with a string cannot break the
 * declared type or make `isKnownHttpError` reject a status it recognizes.
 */
export class UnknownHttpError extends BaseHttpError {
  override readonly name = "UnknownHttpError" as const;
  public readonly status: number;
  public readonly statusText: string;

  constructor(response: Response) {
    super(response);
    // `identityOf`, NOT `response.status` and `response.statusText`. The base
    // constructor above already read this response, and `identityOf` answers
    // with those recorded values — zero further reads. A direct read here would
    // be the THIRD read of `status` on one construction path, and for an
    // injected `fetch` whose getter shifts it would answer a status this error
    // was never selected on, in the one class whose fields are not literals and
    // therefore the one class where the disagreement is visible.
    const identity = identityOf(response);
    this.status = identity.status;
    this.statusText = identity.statusText;
  }
}

// A second brand marking the catch-all subclass, so `isKnownHttpError` can
// exclude it across copies (it also carries the inherited `httpErrorBrand`).
brand(UnknownHttpError.prototype, unknownHttpErrorBrand);
