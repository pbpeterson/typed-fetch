import { brand, networkErrorBrand } from "./brand";
import { installInspect } from "./inspect";
import { redactUrl, redactUrlInMessage } from "./redact-url";

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
  // and defeating the constructor's `if ("cause" in options)` guard. The type
  // is inherited from `Error` (`cause?: unknown`); the constructor assigns the
  // own property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent failures are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  declare public readonly url: string;

  constructor(message: string = "Network error", options?: { cause?: unknown; url?: string }) {
    // The url this error was told about, so the message can be cleaned of it
    // before it becomes the string every log line carries. undici rejects a
    // credentialed URL with a TypeError whose message contains the PASSWORD,
    // and that message is copied here verbatim. See `./redact-url`.
    //
    // OWN properties only, on both slots. A bare `options?.url` and a bare
    // `"cause" in options` each walk the prototype chain, so a single
    // `Object.prototype.url = ...` write anywhere in the process puts a URL
    // this request never touched into `toJSON()` — the record a logger ships
    // off-box — and a polluted `cause` forges the chain underneath it. This is
    // the guard `typedFetch` already applies to its `fetch` slot, applied to
    // the slots its siblings read. `typedFetch` itself is unaffected either
    // way: it always builds an own-property literal.
    const url = options && Object.hasOwn(options, "url") ? (options.url ?? "") : "";
    super(redactUrlInMessage(message, url));
    if (options && Object.hasOwn(options, "cause")) {
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
    // Non-enumerable, exactly like `cause` above: the full href can carry a
    // credential in its query, and an enumerable property puts it into
    // `{ ...error }`, `Object.keys(error)`, and Node's fatal-exception
    // printer, which ignores every inspect hook. The redacted form is in
    // `message` and in the `toJSON()` record.
    Object.defineProperty(this, "url", {
      value: url,
      writable: true,
      enumerable: false,
      configurable: true,
    });
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
    // Origin and path, never the query. `error.url` keeps the full href.
    return { name: this.name, message: this.message, url: redactUrl(this.url) };
  }
}

brand(NetworkError.prototype, networkErrorBrand);

// `toJSON` covers `JSON.stringify`; this covers `console.log`/`util.inspect`
// and Node's fatal-exception printer, which prints `cause` regardless of
// enumerability. See `./inspect`.
installInspect(NetworkError.prototype);
