import { brand, abortedErrorBrand } from "./brand";

/**
 * Represents a request that was cancelled via `AbortSignal` (e.g.
 * `controller.abort()` or `controller.abort(reason)`).
 *
 * Unlike HTTP errors, an `AbortedError` has no status code or response body
 * because the request never completed. The original error thrown by `fetch`
 * is preserved on {@link cause}, the signal's cancellation reason on
 * {@link reason}, and the requested URL on {@link url}.
 *
 * Carries a cross-copy brand so `isAbortError` works across module copies —
 * prefer it over raw `instanceof` at package boundaries.
 */
export class AbortedError extends Error {
  override readonly name = "AbortedError";

  // `cause` is NOT redeclared as a class field on purpose. A field declaration
  // (even bare) would, under ES2022 class-field semantics, define an own
  // `cause: undefined` on every instance — making `"cause" in err` always true
  // and defeating the constructor's `if ("cause" in options)` guard. The type
  // is inherited from `Error` (`cause?: unknown`); the constructor assigns the
  // own property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent aborts are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  public readonly url: string = "";

  /**
   * The `AbortSignal`'s `reason` — whatever the caller passed to
   * `controller.abort(reason)`. When no reason was given, the platform
   * supplies a `DOMException` named `"AbortError"`.
   *
   * Typed `unknown` on purpose: the reason can be anything (an `Error`, a
   * string, an object). The consumer who supplied it must narrow it.
   *
   * `declare` for the same reason as {@link cause}: keep `"reason" in err`
   * honest — an own property only when the constructor assigns it.
   */
  declare public readonly reason: unknown;

  constructor(
    message: string = "Request aborted",
    options?: { cause?: unknown; reason?: unknown; url?: string },
  ) {
    super(message);
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    if (options && "reason" in options) {
      this.reason = options.reason;
    }
    if (options && "url" in options && options.url !== undefined) {
      this.url = options.url;
    }
  }
}

brand(AbortedError.prototype, abortedErrorBrand);
