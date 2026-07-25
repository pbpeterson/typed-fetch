import { NetworkError } from "./errors/network-error";
import { AbortedError } from "./errors/aborted-error";
import { TimeoutError } from "./errors/timeout-error";

/**
 * Request-failure classification: the rules that turn a *rejected* fetch
 * attempt into one of this library's pre-response error values.
 *
 * ## Why this is its own module
 *
 * `typedFetch`'s promise is that a failed request resolves as a VALUE. Deciding
 * *which* value is the hardest reasoning in the package, and none of it is
 * about performing a request: it is a total function over two untrusted inputs
 * — whatever `fetch` rejected with, and whatever the governing `AbortSignal`
 * reports. Both can come from an injected implementation, another realm, a
 * polyfill, or an outright hostile object, so every read here is guarded and
 * this module never throws.
 *
 * Keeping those rules next to the request plumbing meant they could only be
 * reached by performing a request: a fake signal or a cross-realm rejection had
 * to be smuggled in through a stub `fetch`, and the classification could only
 * be observed through the `{ response, error }` envelope. Here the same rules
 * are addressable directly — the classifier's interface IS its test surface, so
 * the whole input space (rejection shape × signal state) is reachable without a
 * server, a stub, or a promise.
 *
 * ## The contract
 *
 * - Total: every input produces an error value. It never throws and never
 *   returns `undefined`, whatever the inputs do when read.
 * - The `AbortSignal` is the authority on an abort, never the rejection's
 *   `.name`.
 * - `url` arrives already resolved. This module never touches the request
 *   input (`string | URL | Request`); resolving it is the caller's job,
 *   because coercing a hostile input can itself throw.
 */

function readStringProperty(value: object, property: "message" | "name"): string | undefined {
  try {
    const result = (value as Record<"message" | "name", unknown>)[property];
    return typeof result === "string" ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Realm-safe error detection.
 *
 * `instanceof Error` is bound to the current realm's constructor, so an error
 * built in a `node:vm` context, an iframe, or a worker fails it — and an
 * injected fetch implementation is exactly the kind of code that can live in
 * another realm. Three layers, narrowest first:
 *
 *  1. `instanceof` — the same-realm fast path.
 *  2. The platform tag. `Object.prototype.toString` reports `[object Error]`
 *     for any object carrying the [[ErrorData]] slot, whatever realm made it,
 *     and `[object DOMException]` for platform exceptions.
 *  3. A subclass may override `Symbol.toStringTag` (node-fetch-shaped classes
 *     can report `[object AbortError]`), so the tag is not sufficient either.
 *     Fall back to structure — but tightly: require a real prototype and a
 *     string `stack`, so a hand-written `{ name: "AbortError" }` object literal
 *     can never claim to be an error.
 *
 * Every read is guarded: a hostile proxy or a throwing getter is not an error.
 */
function isError(value: unknown): value is Error {
  try {
    if (value instanceof Error) return true;
  } catch {
    // A hostile `Symbol.hasInstance` is not a platform error.
    return false;
  }
  if (value === null || typeof value !== "object") return false;
  try {
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Error]" || tag === "[object DOMException]") return true;
    if (Object.getPrototypeOf(value) === Object.prototype) return false;
    return typeof (value as { readonly stack?: unknown }).stack === "string";
  } catch {
    return false;
  }
}

function networkErrorMessage(value: unknown): string {
  if (!isError(value)) return "Network error";
  return (
    readStringProperty(value, "message") || readStringProperty(value, "name") || "Network error"
  );
}

/**
 * Realm-safe DOMException detection. `instanceof DOMException` is bound to the
 * current realm's constructor, so a DOMException created in another realm
 * (jsdom, node:vm, an iframe) fails it. Fall back to
 * `Object.prototype.toString`, which reads the platform-set
 * `Symbol.toStringTag` ("DOMException" on every implementation). Tradeoff:
 * the tag is forgeable via `Symbol.toStringTag` — accepted, the same class of
 * documented honesty as a hand-built `new DOMException("", "TimeoutError")`.
 * `typeof` guard keeps exotic runtimes without the global from throwing.
 */
function isDOMException(value: unknown): value is DOMException {
  try {
    return (
      (typeof DOMException !== "undefined" && value instanceof DOMException) ||
      Object.prototype.toString.call(value) === "[object DOMException]"
    );
  } catch {
    // Hostile proxies / Symbol.toStringTag getters are not platform exceptions.
    return false;
  }
}

function isDOMExceptionNamed(value: unknown, ...names: string[]): value is DOMException {
  return isDOMException(value) && names.includes(readStringProperty(value as object, "name") ?? "");
}

/**
 * Detect a rejection that carries a platform *abort* name.
 *
 * A spec-exact runtime rejects with `signal.reason` itself, which the
 * identity check already catches. Other implementations build their own error:
 * `whatwg-fetch` (the jsdom polyfill) rejects with a FRESH
 * `DOMException("Aborted", "AbortError")`, and `node-fetch@3` rejects with its
 * own `AbortError` class — a plain `Error` subclass, not a DOMException. Both
 * shapes are accepted here.
 *
 * Restricted to error-shaped values so an arbitrary object carrying a `name`
 * property cannot claim an abort. This is only ever consulted while the
 * governing signal reports `aborted`, which is what keeps an unrelated failure
 * (a `TypeError` from Request construction, a `SecurityError`) out of the abort
 * path.
 */
function isAbortShapedRejection(value: unknown): boolean {
  if (!isError(value) && !isDOMException(value)) return false;
  const name = readStringProperty(value as object, "name");
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * A single guarded snapshot of the governing signal.
 *
 * `aborted` and `reason` are read inside ONE `try` on purpose: a signal that
 * reports `aborted` but throws while its `reason` is read has told us nothing
 * trustworthy, and half a snapshot is worse than none — it would let an
 * abort-shaped rejection claim an abort the signal never confirmed.
 */
function abortState(signal: AbortSignal | undefined): {
  readonly aborted: boolean;
  readonly reason: unknown;
} {
  if (!signal) return { aborted: false, reason: undefined };
  try {
    return signal.aborted
      ? { aborted: true, reason: signal.reason }
      : { aborted: false, reason: undefined };
  } catch {
    // A hostile/polyfilled signal must not make the request envelope reject.
    // Without a trustworthy state snapshot, treat the original rejection as a
    // network/request-construction failure instead of guessing an abort.
    return { aborted: false, reason: undefined };
  }
}

/**
 * Classify a rejected request attempt as a timeout, an abort, or a
 * network/request-construction failure.
 *
 * @param rejection - The value `fetch` (or an injected implementation) rejected
 *   with. Untrusted: it may come from another realm, carry throwing getters, or
 *   not be an error at all.
 * @param signal - The signal that governed the call, already resolved from the
 *   `init`/`Request` slots (`undefined` when none governs it). Untrusted for
 *   the same reasons; it may be a polyfill or report a throwing `aborted`.
 * @param url - The requested URL, already resolved by the caller. The empty
 *   string when no URL could be resolved.
 * @returns The error value to hand back to the consumer. Never throws.
 */
export function classifyRequestFailure(
  rejection: unknown,
  signal: AbortSignal | undefined,
  url: string,
): NetworkError | AbortedError | TimeoutError {
  const { aborted, reason } = abortState(signal);
  // The AbortSignal is the authority on an abort — NOT the rejected
  // error's `.name`. A caller can pass any reason to `controller.abort(reason)`
  // (a documented Web API pattern), and fetch rejects with THAT reason, whose
  // `.name` is rarely "AbortError". Conversely, an unrelated error that merely
  // happens to be named "AbortError" must NOT be treated as an abort.
  //
  // The signal being aborted is necessary but NOT sufficient: fetch can
  // reject for an unrelated reason even while the signal is already aborted
  // (e.g. `method: "CONNECT"` or a bad header name → TypeError thrown during
  // Request construction, before the abort is ever consulted). Only take the
  // abort path when the rejection IS the abort.
  //
  // Arm 1 — identity. Spec-compliant runtimes reject with `signal.reason`
  // itself (bare `controller.abort()` sets a DOMException "AbortError" as the
  // reason, `controller.abort(reason)` sets that exact reason — both satisfy
  // `err === signal.reason`). It stays FIRST because it is total and touches
  // no property of the untrusted rejection.
  //
  // Arm 2 — abort shape. An injected or polyfilled fetch is under no
  // obligation to reject with `signal.reason`: `whatwg-fetch` builds a fresh
  // DOMException, `node-fetch@3` throws its own `AbortError` class, and an
  // exotic signal can report `aborted` while leaving `reason` undefined. When
  // the governing signal says the call was aborted AND the rejection
  // carries a platform abort name, this IS that abort. The name check
  // keeps an unrelated failure (a "SecurityError", a Request-construction
  // TypeError) OUT of the abort path, and the value must be error-shaped so a
  // bare object cannot claim an abort.
  //
  // Anything else falls through to NetworkError with the real cause.
  if (aborted && (rejection === reason || isAbortShapedRejection(rejection))) {
    // Classify a timeout by the *shape the platform produces*, not by a name
    // a caller can forge on a plain error. `AbortSignal.timeout()` aborts
    // with a real `DOMException` named "TimeoutError". A caller's
    // `controller.abort(reason)` can set any `reason.name` — including
    // "TimeoutError" — on a plain `Error`; that stays an AbortedError because
    // it is not a DOMException. The DOMException tag IS the accepted boundary
    // here: `isDOMException` reads `Symbol.toStringTag`, so a caller who
    // hand-builds that exact shape (`new DOMException("", "TimeoutError")` or
    // an object tagged "DOMException") is opting into timeout classification,
    // the same documented honesty as forging any platform-shaped value.
    //
    // The `name` check is required: a bare `controller.abort()` also
    // produces a `DOMException`, but named "AbortError" — it must remain an
    // AbortedError.
    //
    // Classify off `reason ?? rejection` — the signal's reason FIRST. It is the
    // only value that records WHY the call ended, and an injected fetch's own
    // rejection usually says just "aborted" even when the signal timed out.
    // Reading the reason first keeps `AbortSignal.timeout()` a TimeoutError
    // under such an implementation. The `rejection` fallback covers a polyfilled
    // timeout signal that leaves `reason` undefined while the rejection
    // itself is the DOMException named "TimeoutError".
    const timeoutBasis = reason ?? rejection;
    if (isDOMExceptionNamed(timeoutBasis, "TimeoutError")) {
      return new TimeoutError("Request timed out", { cause: timeoutBasis, url });
    }
    return new AbortedError("Request aborted", { cause: rejection, reason, url });
  }
  return new NetworkError(networkErrorMessage(rejection), { cause: rejection, url });
}
