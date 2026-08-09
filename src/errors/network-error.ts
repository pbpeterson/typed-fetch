import { networkErrorBrand } from "./brand";
import {
  installPreResponseError,
  preResponseFailureOf,
  preResponseRecord,
} from "./pre-response-error";

/**
 * Represents a request failure or an incompatible result from a custom Fetch
 * implementation. Aborts and timeouts have their own error classes.
 *
 * Unlike HTTP errors, a `NetworkError` has no status code or body methods.
 * Most cases have no response: DNS, connection refusal, TLS, redirect, and
 * request-construction failures. A custom Fetch can instead resolve a value
 * that does not satisfy the response contract. `typedFetch` releases any body
 * it can reach before it returns the error.
 *
 * For a rejected request, {@link cause} holds the original Fetch rejection.
 * For an incompatible resolved value, it holds the validation failure or the
 * exception thrown while inspecting that value. {@link url} holds the requested
 * URL.
 *
 * This class also covers permanent request-construction failures. Examples
 * include an invalid URL, a forbidden method, and a malformed header name.
 * They occur before a network operation.
 *
 * Transient failures use the same class. Examples include a DNS failure, a
 * refused connection, and a reset connection. `NetworkError` does not classify
 * the failure as permanent or transient.
 *
 * No portable test separates permanent and transient request rejections. Every
 * kind can use `TypeError`, so `cause instanceof TypeError` does not classify
 * the failure. Deno supplies no nested `cause` or error code.
 *
 * A blind retry loop repeats permanent failures forever. Put the retry policy
 * in a layer that knows whether the input is a program constant or user data.
 *
 * Carries a cross-copy brand so `isNetworkError` works across module copies —
 * prefer it over raw `instanceof` at package boundaries.
 */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  // `cause` is NOT redeclared as a class field on purpose. A field declaration
  // (even bare) would, under ES2022 class-field semantics, define an own
  // `cause: undefined` on every instance — making `"cause" in err` always true
  // and defeating the own-slot guard in `./pre-response-error`. The type is
  // inherited from `Error` (`cause?: unknown`); the constructor defines the own
  // property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent failures are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  declare public readonly url: string;

  constructor(message: string = "Network error", options?: { cause?: unknown; url?: string }) {
    // ONE read of the caller's options, for the whole construction: the message
    // is cleaned of the same `url` the error then carries. `./pre-response-error`
    // owns every step, and states why each one is what it is — the own-slot
    // reads, the normalization, and the descriptor each member is defined with.
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
   *
   * CREDENTIAL RESIDUAL, named rather than implied. That platform message can
   * quote the caller's own URL back, credentials included: undici rejects one
   * with `Request cannot be constructed from a URL that includes credentials:
   * http://alice:hunter2@host/x`. Every channel this library controls redacts
   * it, and the one it does not is Node's fatal-exception printer, which
   * renders `[cause]` on a crashing error and ignores every inspect hook. So
   * an unhandled rejection, or a `throw error`, can put a password in a crash
   * dump. Do not let a request failure terminate the process, and do not copy
   * `error.cause` into a log line.
   */
  toJSON(): { name: string; message: string; url: string } {
    return preResponseRecord(this);
  }
}

installPreResponseError(NetworkError.prototype, networkErrorBrand);
