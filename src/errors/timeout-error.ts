import { brand, timeoutErrorBrand } from "./brand";

/**
 * Represents a request that was aborted because it exceeded a timeout
 * (e.g. `signal: AbortSignal.timeout(ms)`).
 *
 * Unlike HTTP errors, a `TimeoutError` has no status code or response body
 * because the request never completed. The original error thrown by `fetch`
 * is preserved on {@link cause}, and the requested URL on {@link url}.
 *
 * Carries a cross-copy brand so `isTimeoutError` works across module copies —
 * prefer it over raw `instanceof` at package boundaries.
 */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";

  // `cause` is NOT redeclared as a class field on purpose. A field declaration
  // (even bare) would, under ES2022 class-field semantics, define an own
  // `cause: undefined` on every instance — making `"cause" in err` always true
  // and defeating the constructor's `if ("cause" in options)` guard. The type
  // is inherited from `Error` (`cause?: unknown`); the constructor assigns the
  // own property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent timeouts are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  public readonly url: string = "";

  constructor(message: string = "Request timed out", options?: { cause?: unknown; url?: string }) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    if (options && "url" in options && options.url !== undefined) {
      this.url = options.url;
    }
  }
}

brand(TimeoutError.prototype, timeoutErrorBrand);
