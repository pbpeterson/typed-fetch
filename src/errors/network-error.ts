import { brand, networkErrorBrand } from "./brand";

/**
 * Represents a network-level failure (DNS, connection refused, timeout,
 * aborted request, etc.).
 *
 * Unlike HTTP errors, a `NetworkError` has no status code or response body
 * because the request never reached the server. The original error thrown
 * by `fetch` is preserved on {@link cause}, and the requested URL on
 * {@link url}.
 *
 * Carries a cross-copy brand so `isNetworkError` works across module copies —
 * prefer it over raw `instanceof` at package boundaries.
 */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  /** The original error thrown by `fetch`, if any. */
  public override readonly cause?: unknown;

  /**
   * The requested URL, so concurrent failures are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  public readonly url: string = "";

  constructor(message: string = "Network error", options?: { cause?: unknown; url?: string }) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    if (options && "url" in options && options.url !== undefined) {
      this.url = options.url;
    }
  }
}

brand(NetworkError.prototype, networkErrorBrand);
