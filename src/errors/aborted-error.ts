/**
 * Represents a request that was cancelled via `AbortSignal` (e.g.
 * `controller.abort()` or `controller.abort(reason)`).
 *
 * Unlike HTTP errors, an `AbortedError` has no status code or response body
 * because the request never completed. The original error thrown by `fetch`
 * is preserved on {@link cause}, and the signal's cancellation reason on
 * {@link reason}.
 */
export class AbortedError extends Error {
  override readonly name = "AbortedError";

  /** The original error thrown by `fetch`, if any. */
  public override readonly cause?: unknown;

  /**
   * The `AbortSignal`'s `reason` — whatever the caller passed to
   * `controller.abort(reason)`. When no reason was given, the platform
   * supplies a `DOMException` named `"AbortError"`.
   *
   * Typed `unknown` on purpose: the reason can be anything (an `Error`, a
   * string, an object). The consumer who supplied it must narrow it.
   */
  public readonly reason: unknown;

  constructor(
    message: string = "Request aborted",
    options?: { cause?: unknown; reason?: unknown },
  ) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    if (options && "reason" in options) {
      this.reason = options.reason;
    }
  }
}
