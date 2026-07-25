import { brand, networkErrorBrand } from "./brand";

/**
 * Represents a network-level failure (DNS, connection refused, TLS handshake,
 * redirect, etc.). Aborts and timeouts have their own error classes.
 *
 * Unlike HTTP errors, a `NetworkError` has no status code or response body
 * because the request never reached the server. The original error thrown
 * by `fetch` is preserved on {@link cause}, and the requested URL on
 * {@link url}.
 *
 * This class also covers *permanent, non-retryable* request-construction
 * failures: `fetch` throws a `TypeError` (surfaced here on `cause`) for an
 * invalid URL, a forbidden method (`CONNECT`/`TRACE`), or a malformed header
 * name — before touching the network. A blind retry-on-`NetworkError` loop will
 * retry these forever; inspect `cause` before retrying.
 *
 * Carries a cross-copy brand so `isNetworkError` works across module copies —
 * prefer it over raw `instanceof` at package boundaries.
 */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  // `cause` is NOT redeclared as a class field on purpose. A field declaration
  // (even bare) would, under ES2022 class-field semantics, define an own
  // `cause: undefined` on every instance — making `"cause" in err` always true
  // and defeating the constructor's `if ("cause" in options)` guard. The type
  // is inherited from `Error` (`cause?: unknown`); the constructor assigns the
  // own property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent failures are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  public readonly url: string = "";

  constructor(message: string = "Network error", options?: { cause?: unknown; url?: string }) {
    super(message);
    if (options && "cause" in options) {
      // `defineProperty`, not `this.cause = ...`. A plain assignment creates an
      // ENUMERABLE own property, while `new Error(message, { cause })` creates
      // a non-enumerable one. The difference is not cosmetic: an enumerable
      // `cause` enters `JSON.stringify(error)`, `{ ...error }`, and
      // `Object.keys(error)`, and the cause of a failed `fetch` is a platform
      // error whose own chain carries socket detail — local and remote
      // addresses and ports on undici. That reaches any structured log that
      // serializes the error. The descriptor below is the one the platform
      // writes: writable and configurable, never enumerable.
      Object.defineProperty(this, "cause", {
        value: options.cause,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    if (options && "url" in options && options.url !== undefined) {
      this.url = options.url;
    }
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
    return { name: this.name, message: this.message, url: this.url };
  }
}

brand(NetworkError.prototype, networkErrorBrand);
