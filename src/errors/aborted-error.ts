import { brand, abortedErrorBrand } from "./brand";
import { installInspect } from "./inspect";
import { redactUrl, redactUrlInMessage } from "./redact-url";

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
  // and defeating the constructor's `if ("cause" in options)` guard. The type
  // is inherited from `Error` (`cause?: unknown`); the constructor assigns the
  // own property only when a cause is actually supplied.

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
    // The url this error was told about, so the message can be cleaned of it
    // before it becomes the string every log line carries. undici rejects a
    // credentialed URL with a TypeError whose message contains the PASSWORD,
    // and that message is copied here verbatim. See `./redact-url`.
    //
    // OWN properties only, on every slot read here. See `./network-error` for
    // what a polluted `Object.prototype` otherwise puts into the record.
    const url = options && Object.hasOwn(options, "url") ? (options.url ?? "") : "";
    super(redactUrlInMessage(message, url));
    if (options && Object.hasOwn(options, "cause")) {
      // `defineProperty`, not an assignment: `cause` must be non-enumerable,
      // exactly as `new Error(message, { cause })` defines it. See
      // `./network-error` for what an enumerable one leaks.
      Object.defineProperty(this, "cause", {
        value: options.cause,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    if (options && Object.hasOwn(options, "reason")) {
      // Non-enumerable for the same reason, plus one of its own: the reason is
      // whatever the caller passed to `controller.abort(reason)`. It can be a
      // cyclic object, and an enumerable one makes `JSON.stringify(error)`
      // throw inside whatever logger reached for it.
      Object.defineProperty(this, "reason", {
        value: options.reason,
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
   * `cause` and `reason` are absent on purpose. The cause holds the platform
   * error that failed the request, whose chain carries transport detail. The
   * reason is whatever the caller passed to `controller.abort(reason)`, and it
   * can be any value, including a cyclic one. Log either one deliberately.
   */
  toJSON(): { name: string; message: string; url: string } {
    // Origin and path, never the query. `error.url` keeps the full href.
    return { name: this.name, message: this.message, url: redactUrl(this.url) };
  }
}

brand(AbortedError.prototype, abortedErrorBrand);

// `toJSON` covers `JSON.stringify`; this covers `console.log`/`util.inspect`
// and Node's fatal-exception printer, which prints `cause` regardless of
// enumerability. See `./inspect`.
installInspect(AbortedError.prototype);
