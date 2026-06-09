/**
 * Represents a network-level failure (DNS, connection refused, timeout,
 * aborted request, etc.).
 *
 * Unlike HTTP errors, a `NetworkError` has no status code or response body
 * because the request never reached the server. The original error thrown
 * by `fetch` is preserved on {@link cause}.
 */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  /** The original error thrown by `fetch`, if any. */
  public override readonly cause?: unknown;

  constructor(message: string = "Network error", options?: { cause?: unknown }) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}
