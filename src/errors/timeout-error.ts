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

  /** The original error thrown by `fetch`, if any. */
  public override readonly cause?: unknown;

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
