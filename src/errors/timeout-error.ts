import { brand, timeoutErrorBrand } from "./brand";
import { installInspect } from "./inspect";
import { redactUrl, redactUrlInMessage } from "./redact-url";
import { ownSlot, textOf } from "./response-identity";

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
  // and defeating the constructor's `if ("cause" in options)` guard. The type
  // is inherited from `Error` (`cause?: unknown`); the constructor assigns the
  // own property only when a cause is actually supplied.

  /**
   * The requested URL, so concurrent timeouts are distinguishable in logs.
   * Empty string only if no URL could be resolved from the request input.
   */
  declare public readonly url: string;

  constructor(message: string = "Request timed out", options?: { cause?: unknown; url?: string }) {
    // The url this error was told about, so the message can be cleaned of it
    // before it becomes the string every log line carries. undici rejects a
    // credentialed URL with a TypeError whose message contains the PASSWORD.
    // `typedFetch` no longer passes that text on — every message it writes is a
    // library constant — but this constructor is public API, and a consumer
    // wrapping an adapter passes whatever it holds. See `./redact-url`.
    //
    // OWN properties only, on every slot read here. See `./network-error` for
    // what a polluted `Object.prototype` otherwise puts into the record.
    //
    // NORMALIZED, not trusted. `url?: string` is a compile-time claim, and this
    // constructor is public API: a consumer building a mock, an adapter, or a
    // re-wrap passes whatever it holds. An unchecked value made the constructor
    // THROW — `hasRedactableSlot` calls `.includes` on it — in a library whose
    // premise is that errors are values. An array has `.includes`, so it got
    // through instead and sat in a `readonly string` slot. `typedFetch` already
    // applies this rule to its own resolved url.
    //
    // The READ is normalized too, not only the value: `ownSlot` reports a slot
    // that throws as absent. See `./network-error`.
    const cause = ownSlot(options, "cause");
    const url = textOf(ownSlot(options, "url").value);
    super(redactUrlInMessage(message, url));
    if (cause.present) {
      // `defineProperty`, not an assignment: `cause` must be non-enumerable,
      // exactly as `new Error(message, { cause })` defines it. See
      // `./network-error` for what an enumerable one leaks.
      Object.defineProperty(this, "cause", {
        value: cause.value,
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

brand(TimeoutError.prototype, timeoutErrorBrand);

// `toJSON` covers `JSON.stringify`; this covers `console.log`/`util.inspect`
// and Node's fatal-exception printer, which prints `cause` regardless of
// enumerability. See `./inspect`.
installInspect(TimeoutError.prototype);
