import { brand, timeoutErrorBrand } from "./brand";

/**
 * Represents a request that was aborted because it exceeded a timeout
 * (e.g. `signal: AbortSignal.timeout(ms)`).
 *
 * Unlike HTTP errors, a `TimeoutError` has no status code or response body
 * because the request never completed. The original error thrown by `fetch`
 * is preserved on {@link cause}.
 *
 * Carries a cross-copy brand so `isTimeoutError` works across module copies —
 * prefer it over raw `instanceof` at package boundaries.
 */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";

  /** The original error thrown by `fetch`, if any. */
  public override readonly cause?: unknown;

  constructor(message: string = "Request timed out", options?: { cause?: unknown }) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

brand(TimeoutError.prototype, timeoutErrorBrand);
