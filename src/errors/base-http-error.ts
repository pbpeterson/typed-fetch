import { brand, httpErrorBrand } from "./brand";
import { errorBodyOf, type ErrorBody } from "./error-body";

/**
 * Per-instance body custody, held OUTSIDE the class.
 *
 * ECMAScript `#private` fields would be the natural home, but TypeScript emits
 * a `#private;` marker into the declaration file for any class that has one,
 * and that marker is NOMINAL. `dist/index.d.ts` and `dist/index.d.mts` are two
 * files, so their `NotFoundError` declarations carry two distinct `#private`
 * brands: a CJS-typed wrapper package could not hand an error to an ESM app
 * without a cast (`TS2741: Property '#private' is missing`). That is the same
 * dual-package boundary the runtime `Symbol.for` brands exist to cross, so the
 * type layer must not reintroduce it. The same rule binds `./error-body`: it is
 * a factory over closures, not a class, for exactly this reason.
 *
 * A module-scoped `WeakMap` keyed by the instance gives the same guarantees the
 * `#private` fields gave — the body is not an own property, so it stays out of
 * `JSON.stringify(err)`, `{...err}`, `Object.keys(err)`, and structured
 * loggers — while emitting nothing into the declarations.
 *
 * TRADEOFF, accepted deliberately: without `#private` the classes are purely
 * structural, so a hand-built object with the right shape becomes assignable to
 * `BaseHttpError`. TypeScript is structural everywhere else, and this package
 * already documents the brand guards (`isHttpError`) — not `instanceof`, and
 * certainly not assignability — as the authority on "did this library make
 * this?". Cross-format assignability is worth more than nominal typing here.
 * The runtime consequence lands in {@link bodyOf}: a structurally-assignable
 * impostor has no entry here and every body method rejects it by name.
 */
const bodies = new WeakMap<BaseHttpError, ErrorBody>();

function bodyOf(error: BaseHttpError): ErrorBody {
  const body = bodies.get(error);
  if (!body) {
    throw new TypeError(
      "This error carries no response: it was not initialized by the BaseHttpError constructor. " +
        "A subclass must call super(response).",
    );
  }
  return body;
}

/**
 * Abstract base class for all HTTP error classes (4xx and 5xx).
 *
 * Provides access to the response body via {@link json}, {@link text},
 * {@link blob}, and {@link arrayBuffer}, as well as response {@link headers}.
 * Release a body you do not need with {@link cancel}.
 *
 * This class owns HTTP error IDENTITY — status, statusText, url, headers, and
 * the message line. The body's lifecycle — the single-use guard, the cancel
 * decision order, and the tee bookkeeping behind {@link clone} — lives in
 * `./error-body`; every method below is a delegation to it.
 *
 * Carries a cross-copy brand (see `./brand`) so `isHttpError` recognizes
 * instances even when they were created by a different copy of this class
 * (different entry point or module format). Raw `instanceof BaseHttpError`
 * still uses the normal prototype chain and is only reliable within a single
 * copy — prefer `isHttpError` across package boundaries.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
 */
export abstract class BaseHttpError extends Error {
  /** Response headers from the failed request. */
  public readonly headers: Headers;

  /** HTTP status code (literal type, e.g. `404`). */
  public abstract readonly status: number;

  /**
   * The library's canonical protocol label for {@link status} (normally the
   * current IANA phrase; literal-typed, e.g. `"Not Found"`) - not the server's
   * wire value. The status text received from the server, when present, is in
   * {@link Error.message | message}.
   */
  public abstract readonly statusText: string;

  /** The URL of the failed request (from `response.url`). */
  public readonly url: string;

  constructor(response: Response) {
    const line = response.statusText
      ? `HTTP ${response.status} ${response.statusText}`
      : `HTTP ${response.status}`;
    super(response.url ? `${line} (${response.url})` : line);
    this.url = response.url;
    this.headers = response.headers;
    bodies.set(this, errorBodyOf(response));
  }

  /**
   * Release the error response body without reading it.
   *
   * Every error body needs a read or a cancel. An unread body keeps its stream
   * open, which pins the underlying connection until the runtime collects it.
   * Code that logs only `error.message` and drops the error leaks one
   * connection per failed request.
   *
   * This does NOT buffer the payload. Cancelling releases the body, but it can
   * close the connection instead of returning it to the keep-alive pool: the
   * remaining bytes were never received, so the connection cannot be reused.
   * Read the body with {@link text} when connection reuse matters more than
   * the bytes.
   *
   * AFTER {@link clone}, the body stream is teed, and the platform releases the
   * source only once EVERY branch is read or canceled. The promise returned
   * here therefore stays pending until the sibling branch is released too.
   * That is native `ReadableStream` behavior, kept deliberately rather than
   * hidden: resolving early would report a release that did not happen.
   * Cancelling one branch never cancels the other — the consumer cloned it in
   * order to read it.
   *
   * @example
   * ```ts
   * import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";
   *
   * const { error } = await typedFetch("https://example.test/users/1");
   *
   * if (isHttpError(error)) {
   *   const copy = error.clone();
   *   await Promise.all([error.cancel(), copy.cancel()]);
   * }
   * ```
   *
   * It resolves when the response carries no body, when the body was already
   * consumed — including by a consumer holding the `Response` itself — and
   * when this library already started reading it. A repeated call settles with
   * the first one.
   *
   * It rejects with a `TypeError` when an EXTERNAL reader holds the stream and
   * has read nothing through it; release that reader and cancel through it
   * instead. On a runtime that reports `bodyUsed` for a bare `getReader()`
   * (Bun today), that state is indistinguishable from a consumed body, so this
   * call resolves rather than rejecting.
   *
   * @param reason - Passed to the underlying stream's `cancel()`.
   */
  async cancel(reason?: unknown): Promise<void> {
    return bodyOf(this).cancel(reason);
  }

  /**
   * Parse the error response body as JSON with an optional type parameter.
   *
   * Note: an empty or non-JSON body — common for 4xx/5xx responses, where many
   * servers send an empty body or an HTML page — still rejects with the
   * platform's `SyntaxError`. Use {@link text} when the body may not be JSON.
   */
  // The four readers and `cancel` stay `async` even though every body method
  // already returns a promise. A missing body entry (a structural impostor, or
  // a subclass that never ran this constructor) must REJECT, not throw
  // synchronously out of `error.text()` — the documented shape is
  // `await expect(error.text()).rejects.toThrow(...)`. `clone()` is the
  // deliberate exception: it is synchronous and throws.
  async json<T = unknown>(): Promise<T> {
    return bodyOf(this).json<T>();
  }

  /** Parse the error response body as text. */
  async text(): Promise<string> {
    return bodyOf(this).text();
  }

  /** Parse the error response body as a Blob. */
  async blob(): Promise<Blob> {
    return bodyOf(this).blob();
  }

  /** Parse the error response body as an ArrayBuffer. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return bodyOf(this).arrayBuffer();
  }

  /**
   * Clone the error so the response body can be read multiple times.
   *
   * Must be called BEFORE the body is read, canceled, or locked — cloning
   * duplicates the response body stream, which is impossible once it has been
   * consumed or a reader has been acquired. Calling it after
   * `json()`/`text()`/`blob()`/`arrayBuffer()`/{@link cancel}, or while a
   * reader holds the stream, throws a `TypeError` with a clear message
   * (instead of the platform's opaque "Body is unusable").
   *
   * Cloning tees the body stream. Both branches must then be read or
   * canceled: the platform releases the underlying source only once the last
   * one is done. See {@link cancel}.
   *
   * Built-in errors need no callback. Consumer subclasses can pass a
   * recreation callback to preserve custom constructor or private state.
   * Without a callback, cloning uses the compatible response-only constructor
   * behavior from version 1.0.0 and cannot preserve additional state: a
   * subclass whose constructor takes more arguments receives `undefined` for
   * them. Pass the callback whenever the subclass has such state.
   *
   * @example
   * ```ts
   * import { BaseHttpError } from "@pbpeterson/typed-fetch";
   *
   * class TenantHttpError extends BaseHttpError {
   *   override readonly name = "TenantHttpError" as const;
   *   readonly status = 499 as const;
   *   readonly statusText = "Tenant Error" as const;
   *
   *   constructor(
   *     response: Response,
   *     readonly tenant: string,
   *   ) {
   *     super(response);
   *   }
   * }
   *
   * const error = new TenantHttpError(new Response("{}", { status: 499 }), "acme");
   *
   * const copy = error.clone((response) => new TenantHttpError(response, error.tenant));
   *
   * console.log(copy.tenant); // "acme"
   *
   * // `clone()` tees the body. Release BOTH branches, or the source stays
   * // pinned. Release them together: one `cancel()` alone stays pending until
   * // the sibling branch is released too.
   * await Promise.all([error.cancel(), copy.cancel()]);
   * ```
   */
  clone(recreate?: (response: Response) => this): this {
    // Throws before anything is teed when the body is no longer available.
    const teed = bodyOf(this).tee();

    let copy: this;
    if (!recreate) {
      const Ctor = this.constructor as new (response: Response) => this;
      try {
        copy = new Ctor(teed.branch);
      } catch (cause) {
        teed.release();
        // Deliberately NOT wrapped: a consumer subclass constructor's own
        // error must reach the caller verbatim.
        throw cause;
      }
    } else {
      try {
        copy = recreate(teed.branch);
      } catch (cause) {
        teed.release();
        throw new TypeError(`Cannot clone ${this.name}: the recreate callback failed.`, { cause });
      }
    }

    // One instance cannot own two branches: releasing it would release only
    // one, and the source would stay pinned.
    if (copy === (this as unknown)) {
      teed.release();
      throw new TypeError(
        `Cannot clone ${this.name}: the recreate callback returned the same error instead of a ` +
          "new one. Build a new instance from the response it receives.",
      );
    }

    // `bodies.get`, NOT `bodyOf`: a `recreate` callback may legitimately return
    // an instance built by a different copy of this library, whose body lives
    // in that copy's table. There is nothing to mark here and nothing to fail
    // over — the branch has an owner either way.
    teed.adopt(bodies.get(copy));
    return copy;
  }
}

// Stamp the cross-copy brand on the prototype so every subclass (all 40 status
// classes + UnknownHttpError) inherits it. Keyed by a `Symbol.for`, it is
// identical across module copies, which is what makes the guards work across package copies.
brand(BaseHttpError.prototype, httpErrorBrand);
