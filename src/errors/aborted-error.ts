import { abortedErrorBrand } from "./brand";
import {
  installPreResponseError,
  preResponseFailureOf,
  preResponseRecord,
} from "./pre-response-error";

/**
 * Represents a request that was aborted via `AbortSignal` (e.g.
 * `controller.abort()` or `controller.abort(reason)`).
 *
 * Unlike HTTP errors, an `AbortedError` has no status code or response body
 * because the request never completed. The original error thrown by `fetch`
 * is preserved on {@link cause}, the signal's abort reason on
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
  // and defeating the own-slot guard in `./pre-response-error`. The type is
  // inherited from `Error` (`cause?: unknown`); the constructor defines the own
  // property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent aborts are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  declare public readonly url: string;

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
    // ONE read of the caller's options, exactly as `./network-error` performs
    // it, plus the `reason` this class alone carries. The slot list is what
    // makes that difference explicit: a member absent from it is a member this
    // error never owns, which is what keeps `"reason" in error` honest for its
    // two siblings. `./pre-response-error` owns every step.
    const failure = preResponseFailureOf(message, options, ["cause", "reason"]);
    super(failure.message);
    failure.defineMembers(this);
  }

  /**
   * The record `JSON.stringify(error)` produces.
   *
   * `message` and `stack` are not enumerable own properties of an `Error`, so
   * a structured logger that serializes one records everything EXCEPT the line
   * a reader looks for first. This method supplies the record instead.
   *
   * `cause` and `reason` are absent on purpose. The cause holds the platform
   * error that failed the request, whose chain carries transport detail. The
   * reason is whatever the caller passed to `controller.abort(reason)`, and it
   * can be any value, including a cyclic one. Log either one deliberately.
   */
  toJSON(): { name: string; message: string; url: string } {
    return preResponseRecord(this);
  }
}

installPreResponseError(AbortedError.prototype, abortedErrorBrand);
