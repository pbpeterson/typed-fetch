/**
 * Represents a request that was cancelled via `AbortSignal` (e.g.
 * `controller.abort()`).
 *
 * Unlike HTTP errors, an `AbortedError` has no status code or response body
 * because the request never completed. The original error thrown by `fetch`
 * is preserved on {@link cause}.
 */
export class AbortedError extends Error {
  override readonly name = "AbortedError";

  /** The original error thrown by `fetch`, if any. */
  public override readonly cause?: unknown;

  constructor(message: string = "Request aborted", options?: { cause?: unknown }) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}
