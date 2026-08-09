import { timeoutErrorBrand } from "./brand";
import {
  installPreResponseError,
  preResponseFailureOf,
  preResponseRecord,
} from "./pre-response-error";

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
  // and defeating the own-slot guard in `./pre-response-error`. The type is
  // inherited from `Error` (`cause?: unknown`); the constructor defines the own
  // property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent timeouts are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  declare public readonly url: string;

  constructor(message: string = "Request timed out", options?: { cause?: unknown; url?: string }) {
    // ONE read of the caller's options, exactly as `./network-error` performs
    // it. `./pre-response-error` owns every step and states why each one is what
    // it is.
    const failure = preResponseFailureOf(message, options, ["cause"]);
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
   * `cause` is absent on purpose. It holds the platform error that failed the
   * request, and its own chain carries transport detail — local and remote
   * addresses and ports on undici. Log `error.cause` deliberately when you
   * want it.
   */
  toJSON(): { name: string; message: string; url: string } {
    return preResponseRecord(this);
  }
}

installPreResponseError(TimeoutError.prototype, timeoutErrorBrand);
