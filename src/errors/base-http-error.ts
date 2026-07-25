import { brand, httpErrorBrand } from "./brand";

/**
 * Per-instance state, held OUTSIDE the class.
 *
 * ECMAScript `#private` fields would be the natural home, but TypeScript emits
 * a `#private;` marker into the declaration file for any class that has one,
 * and that marker is NOMINAL. `dist/index.d.ts` and `dist/index.d.mts` are two
 * files, so their `NotFoundError` declarations carry two distinct `#private`
 * brands: a CJS-typed wrapper package could not hand an error to an ESM app
 * without a cast (`TS2741: Property '#private' is missing`). That is the same
 * dual-package boundary the runtime `Symbol.for` brands exist to cross, so the
 * type layer must not reintroduce it.
 *
 * A module-scoped `WeakMap` keyed by the instance gives the same guarantees the
 * `#private` fields gave — the response is not an own property, so it stays out
 * of `JSON.stringify(err)`, `{...err}`, `Object.keys(err)`, and structured
 * loggers — while emitting nothing into the declarations.
 *
 * TRADEOFF, accepted deliberately: without `#private` the classes are purely
 * structural, so a hand-built object with the right shape becomes assignable to
 * `BaseHttpError`. TypeScript is structural everywhere else, and this package
 * already documents the brand guards (`isHttpError`) — not `instanceof`, and
 * certainly not assignability — as the authority on "did this library make
 * this?". Cross-format assignability is worth more than nominal typing here.
 */
type BaseHttpErrorState = {
  /** The failed response. Reachable only through this module. */
  readonly response: Response;
  /** Set by {@link BaseHttpError.cancel}. */
  cancelled: boolean;
  /**
   * Set by this library's own body readers. Tracked separately from
   * `response.bodyUsed` because that flag is runtime-specific: Bun reports it
   * as soon as `getReader()` locks the stream, while Node, Deno, and workerd
   * keep it `false` until the stream is disturbed. Keying "we already consumed
   * this" on `bodyUsed` therefore misreads an EXTERNAL reader as our own.
   */
  readStarted: boolean;
  /**
   * Set on BOTH sides by {@link BaseHttpError.clone}: cloning tees the body
   * stream. Recorded so the documented contract — every branch of a teed body
   * must be read or cancelled before the source is released — is inspectable.
   */
  teed: boolean;
  /**
   * The in-flight `cancel()`, so a repeated call settles WITH the first one
   * instead of reporting success while the first is still waiting. Cleared
   * once it settles; `cancelled` then carries the state.
   */
  cancelling: Promise<void> | undefined;
};

const states = new WeakMap<BaseHttpError, BaseHttpErrorState>();

function stateOf(error: BaseHttpError): BaseHttpErrorState {
  const state = states.get(error);
  if (!state) {
    throw new TypeError(
      "This error carries no response: it was not initialized by the BaseHttpError constructor. " +
        "A subclass must call super(response).",
    );
  }
  return state;
}

/**
 * Guard the single-use body readers with a clear message, mirroring
 * {@link BaseHttpError.clone}. A `Response` body is a one-shot stream; a second
 * read otherwise throws the platform's opaque `TypeError: Body is unusable`.
 *
 * A cancelled body and a locked stream both count as unavailable. A locked
 * stream is the case a `bodyUsed`-only guard misses: a reader holds it while
 * `bodyUsed` can still be `false`.
 */
function assertBodyReadable(state: BaseHttpErrorState, method: string): void {
  if (
    state.cancelled ||
    state.readStarted ||
    state.response.bodyUsed ||
    state.response.body?.locked
  ) {
    throw new TypeError(
      `Cannot read this error's body with ${method}(): its response body has already been read, ` +
        "cancelled, or its stream is locked. Response bodies are single-use — call clone() BEFORE " +
        "the first read to read it more than once.",
    );
  }
  state.readStarted = true;
}

/**
 * Abstract base class for all HTTP error classes (4xx and 5xx).
 *
 * Provides access to the response body via {@link json}, {@link text},
 * {@link blob}, and {@link arrayBuffer}, as well as response {@link headers}.
 * Release a body you do not need with {@link cancel}.
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
   * wire value. The server's wire phrase, when present, is in
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
    states.set(this, {
      response,
      cancelled: false,
      readStarted: false,
      teed: false,
      cancelling: undefined,
    });
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
   * source only once EVERY branch is read or cancelled. The promise returned
   * here therefore stays pending until the sibling branch is released too.
   * That is native `ReadableStream` behavior, kept deliberately rather than
   * papered over: resolving early would report a release that did not happen.
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
    const state = stateOf(this);

    // 1. A repeated cancel settles WITH the in-flight one. Returning early
    //    here would report success while the first call is still waiting for
    //    a teed sibling branch.
    if (state.cancelling) return state.cancelling;
    if (state.cancelled) return;

    // 2. This library already started the read, so the body is spoken for.
    //    Checked before the lock test because a completed read leaves the
    //    stream locked on some runtimes.
    if (state.readStarted) {
      state.cancelled = true;
      return;
    }

    const body = state.response.body;

    // 3. An EXTERNAL reader holds the stream and has read nothing through it.
    //    Not ours to release.
    //
    //    `bodyUsed` is what separates this from a body the consumer already
    //    READ (step 4). Measured on Node 20/24, Bun 1.3, and Deno: a completed
    //    external `text()` leaves the stream `locked` AND `bodyUsed`, exactly
    //    like a bare `getReader()` does on Bun. So a `locked`-only test would
    //    reject on a body that is simply gone — the common case whenever a
    //    consumer holds the `Response` through an injected `fetch`.
    //
    //    DOCUMENTED DIVERGENCE: on a runtime that reports `bodyUsed` for a mere
    //    reader lock (Bun today), the two states are indistinguishable, and
    //    this call resolves via step 4 instead of rejecting. Resolving on the
    //    runtime that says the body is used beats rejecting on every runtime
    //    for a case that is far more common.
    if (body?.locked && !state.response.bodyUsed) {
      throw new TypeError(
        "Cannot cancel this error's body: its stream is locked by a reader. " +
          "Release the reader with reader.releaseLock(), or cancel the reader itself.",
      );
    }

    // 4. Nothing to release: no body, or it was consumed elsewhere.
    if (!body || state.response.bodyUsed) {
      state.cancelled = true;
      return;
    }

    // 5. Release it.
    state.cancelled = true;
    const cancelling = body.cancel(reason);
    // A teed branch can settle long after this call returns, and the repeated
    // call path hands the same promise to a caller who may not await it. Keep
    // a rejection from ever becoming an unhandled rejection; the awaiting
    // caller below still receives it.
    cancelling.catch(() => {});
    state.cancelling = cancelling;
    try {
      await cancelling;
    } finally {
      state.cancelling = undefined;
    }
  }

  /**
   * Parse the error response body as JSON with an optional type parameter.
   *
   * Note: an empty or non-JSON body — common for 4xx/5xx responses, where many
   * servers send an empty body or an HTML page — still rejects with the
   * platform's `SyntaxError`. Use {@link text} when the body may not be JSON.
   */
  async json<T = unknown>(): Promise<T> {
    const state = stateOf(this);
    assertBodyReadable(state, "json");
    return state.response.json();
  }

  /** Parse the error response body as text. */
  async text(): Promise<string> {
    const state = stateOf(this);
    assertBodyReadable(state, "text");
    return state.response.text();
  }

  /** Parse the error response body as a Blob. */
  async blob(): Promise<Blob> {
    const state = stateOf(this);
    assertBodyReadable(state, "blob");
    return state.response.blob();
  }

  /** Parse the error response body as an ArrayBuffer. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    const state = stateOf(this);
    assertBodyReadable(state, "arrayBuffer");
    return state.response.arrayBuffer();
  }

  /**
   * Clone the error so the response body can be read multiple times.
   *
   * Must be called BEFORE the body is read, cancelled, or locked — cloning
   * duplicates the response body stream, which is impossible once it has been
   * consumed or a reader has been acquired. Calling it after
   * `json()`/`text()`/`blob()`/`arrayBuffer()`/{@link cancel}, or while a
   * reader holds the stream, throws a `TypeError` with a clear message
   * (instead of the platform's opaque "Body is unusable").
   *
   * Cloning tees the body stream. Both branches must then be read or
   * cancelled: the platform releases the underlying source only once the last
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
   * ```
   */
  clone(recreate?: (response: Response) => this): this {
    const state = stateOf(this);
    if (
      state.cancelled ||
      state.readStarted ||
      state.response.bodyUsed ||
      state.response.body?.locked
    ) {
      throw new TypeError(
        "Cannot clone this error: its response body has already been read, cancelled, or its stream " +
          "is locked. Call clone() before json()/text()/blob()/arrayBuffer()/cancel().",
      );
    }
    // From here the body is TEED: two branches exist, and the platform frees
    // the source only once BOTH are released. Every failure path below must
    // therefore release the branch it is about to drop, or `cancel()` on this
    // error would wait forever for an owner that never existed.
    const clonedResponse = state.response.clone();
    const releaseOrphan = (): void => {
      // Nobody can await this: the caller is receiving an exception, not a
      // copy. Swallow the rejection so it cannot surface as unhandled.
      clonedResponse.body?.cancel().catch(() => {});
    };

    let copy: this;
    if (!recreate) {
      const Ctor = this.constructor as new (response: Response) => this;
      try {
        copy = new Ctor(clonedResponse);
      } catch (cause) {
        releaseOrphan();
        // Deliberately NOT wrapped: a consumer subclass constructor's own
        // error must reach the caller verbatim.
        throw cause;
      }
    } else {
      try {
        copy = recreate(clonedResponse);
      } catch (cause) {
        releaseOrphan();
        throw new TypeError(`Cannot clone ${this.name}: the recreate callback failed.`, { cause });
      }
    }

    // One instance cannot own two branches: releasing it would release only
    // one, and the source would stay pinned.
    if (copy === (this as unknown)) {
      releaseOrphan();
      throw new TypeError(
        `Cannot clone ${this.name}: the recreate callback returned the same error instead of a ` +
          "new one. Build a new instance from the response it receives.",
      );
    }

    // Both sides now share one teed source, and both must be released.
    state.teed = true;
    const copyState = states.get(copy);
    if (copyState) copyState.teed = true;
    return copy;
  }
}

// Stamp the cross-copy brand on the prototype so every subclass (all 40 status
// classes + UnknownHttpError) inherits it. Keyed by a `Symbol.for`, it is
// identical across module copies, which is what makes the guards copy-proof.
brand(BaseHttpError.prototype, httpErrorBrand);
