import { asksOwnsResponse, brand, httpErrorBrand, stampOwnsResponse } from "./brand";
import { errorBodyOf, type ErrorBody } from "./error-body";
import { installInspect } from "./inspect";
import { redactUrl } from "./redact-url";
import { identityOf, lendIdentity, type ResponseIdentity } from "./response-identity";

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

/**
 * Per-instance identity, held OUTSIDE the class for exactly the reason the
 * header above gives for {@link bodies}: a `#private` field would emit a nominal
 * `#private;` marker into both declaration files and make the two declarations
 * of every error class mutually unassignable. Read that header for the full
 * rationale; nothing about it is different here.
 *
 * What IS new is why a second table exists at all. `clone()` tees the body and
 * builds the copy from the branch, and a branch produced by a real
 * `Response.clone()` reports the response's internal slots rather than the
 * hostile own-property getter that produced this error's identity. This table
 * lets `clone()` hand the copy the identity it INHERITS, so a copy built by THIS
 * package copy reports the identity of the error it was cloned from instead of
 * re-reading the branch.
 *
 * "Built by this package copy" is a real limit, not a hedge. The identity tables
 * are module-scoped, so they are per copy, exactly as this one is. A `recreate`
 * callback returning an instance from a DIFFERENT copy runs that copy's
 * constructor against tables that never saw the handoff, and that instance reads
 * the branch. See the residuals in `./response-identity`.
 */
const identities = new WeakMap<BaseHttpError, ResponseIdentity>();

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
 * Define an own property with the descriptor the platform uses for
 * `Error.cause`: readable and writable, but NOT enumerable, so it stays out of
 * `{ ...error }`, `Object.keys(error)`, `for...in`, and any printer that walks
 * own enumerable properties.
 */
function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Was this object built by THIS copy of the library?
 *
 * Guarded: `instanceof` consults the constructor's `Symbol.hasInstance` and the
 * value's prototype chain, and a hostile object can throw from either. A value
 * that cannot answer the question is treated as claiming this copy — the
 * conservative side, since the caller releases the branch on that answer.
 */
function claimsThisCopy(value: unknown): boolean {
  try {
    return value instanceof BaseHttpError;
  } catch {
    return true;
  }
}

/**
 * The cross-copy counterpart of `ErrorBody.owns`, stamped on the prototype so a
 * DIFFERENT copy of this library can ask it. See `./brand`.
 *
 * Total by construction, which the caller depends on.
 * `WeakMap.prototype.get` returns `undefined` for a key that is not an object
 * rather than throwing (verified on Node 20.15.0 for `1`, `undefined`, and
 * `null`), and `owns` is an identity comparison, so a detached call, a foreign
 * `this`, and a junk `candidate` all produce `false` instead of an exception.
 */
function ownsResponse(this: unknown, candidate: Response): boolean {
  return bodies.get(this as BaseHttpError)?.owns(candidate) === true;
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
  /**
   * Response headers from the failed request.
   *
   * NON-ENUMERABLE, defined exactly as the platform defines `Error.cause`.
   * This holds the raw server values — the session in `set-cookie`, whatever a
   * custom header carries — and an own ENUMERABLE property puts all of it into
   * `{ ...error }`, `Object.keys(error)`, `for...in`, and, decisively, Node's
   * fatal-exception printer, which renders a crashing error with
   * `customInspect: false` and therefore ignores every hook this library
   * installs. Reading `error.headers` is unchanged.
   */
  declare public readonly headers: Headers;

  /** HTTP status code (literal type, e.g. `404`). */
  public abstract readonly status: number;

  /**
   * The library's canonical protocol label for {@link status} (normally the
   * current IANA phrase; literal-typed, e.g. `"Not Found"`) - not the server's
   * wire value. The status text received from the server, when present, is in
   * {@link Error.message | message}.
   */
  public abstract readonly statusText: string;

  /**
   * The URL of the failed request (from `response.url`), as the FULL href.
   *
   * This is the escape hatch, the way `headers` is the escape hatch for header
   * values: `message` and the `toJSON()` record carry the redacted form
   * (origin and path, no query), and this carries everything. Non-enumerable
   * for the same reason as {@link headers} — a query string routinely holds a
   * credential.
   */
  declare public readonly url: string;

  constructor(response: Response) {
    // ONE read of each identity field, for the whole construction. Every line
    // below reads `identity`, never `response`: this constructor used to read
    // `statusText` twice, `status` twice, and `url` twice, and an injected
    // `fetch` whose getters answered differently on a second read produced an
    // error whose message, `url`, and `status` disagreed with each other and
    // with the read that selected the class. See `./response-identity`, which
    // also records the values so `UnknownHttpError` and `clone()` answer with
    // the same ones.
    const identity = identityOf(response);
    const line = identity.statusText
      ? `HTTP ${identity.status} ${identity.statusText}`
      : `HTTP ${identity.status}`;
    // The REDACTED url in the message, the full href on `this.url`. A query
    // string routinely carries a credential (`?access_token=`, a signed
    // `?X-Amz-Signature=`), and `message` is the one string every log line,
    // crash dump, and test failure carries. See `./redact-url`. Both forms come
    // from the SAME single read, so the message and the escape hatch can no
    // longer point at two different servers.
    const safeUrl = redactUrl(identity.url);
    super(safeUrl ? `${line} (${safeUrl})` : line);
    // `defineProperty`, not an assignment: an assignment creates an ENUMERABLE
    // own property. See the field docs above, and `./network-error` for the
    // same decision on `cause`.
    define(this, "url", identity.url);
    // A COPY, not the response's own `Headers`. The error outlives the request
    // and is handed to loggers and retry code; an alias would make
    // `error.headers.set(...)` edit the `Response` a consumer still holds
    // through an injected `fetch`, which the `readonly` here denies. One
    // allocation per error buys that. The copy is faithful: a `Headers` init
    // preserves every duplicate `set-cookie` entry. The identity record holds
    // the response's own `Headers` and never this copy, so two errors built
    // from one response get one copy each and cannot edit each other's.
    define(this, "headers", new Headers(identity.headers));
    bodies.set(this, errorBodyOf(response));
    identities.set(this, identity);
  }

  /**
   * The record `JSON.stringify(error)` produces: this error's identity, as
   * plain JSON data.
   *
   * `message` and `stack` are not enumerable own properties of an `Error`, so
   * a structured logger that serializes one records everything EXCEPT the line
   * a reader looks for first. This method supplies the record instead.
   *
   * `headers` holds header NAMES, never values. A response carries the values a
   * log must not keep: `set-cookie` holds the session, and a custom header
   * holds whatever the server chose to put there. This method exists to be
   * called by a logger that serializes whatever it is handed, so it cannot emit
   * a value it has not judged. A deny list does not work here, because the
   * dangerous name is the one this library has never heard of. Read
   * `error.headers` for the values.
   *
   * Three members are absent for the same reason or a neighboring one. The body
   * is a single-use stream and reading it is asynchronous — read it, or cancel
   * it, separately. The stack can carry local file paths of the process that
   * produced it. Log either one deliberately when you want it.
   *
   * A consumer subclass inherits this method, so a field the subclass adds does
   * not reach `JSON.stringify`. Override `toJSON` to add it.
   *
   * @example
   * ```ts
   * import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";
   *
   * const { error } = await typedFetch("https://example.test/users/1");
   *
   * if (isHttpError(error)) {
   *   console.log(JSON.stringify(error));
   *   // {"name":"NotFoundError","message":"HTTP 404 Not Found (https://example.test/users/1)",
   *   //  "status":404,"statusText":"Not Found","url":"https://example.test/users/1",
   *   //  "headers":["content-type"]}
   *   await error.cancel();
   * }
   * ```
   */
  toJSON(): {
    name: string;
    message: string;
    status: number;
    statusText: string;
    url: string;
    headers: string[];
  } {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      // Origin and path, never the query: see `./redact-url`. Read
      // `error.url` for the full href, as you read `error.headers` for the
      // header values.
      url: redactUrl(this.url),
      // Iterating a `Headers` yields one name per `set-cookie`, so a repeated
      // header still shows how many times the server sent it.
      headers: [...this.headers.keys()],
    };
  }

  /**
   * Release the error response body without reading it.
   *
   * Every error body needs a read or a cancel. An unread body keeps its stream
   * open, which pins the underlying connection until the runtime collects it.
   * Code that logs only `error.message` and drops the error leaks one
   * connection per failed request.
   *
   * This does NOT buffer the payload. Canceling releases the body, but it can
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
   * Canceling one branch never cancels the other — the consumer cloned it in
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
   * consumed — including by a consumer holding the `Response` itself — when
   * this library already started reading it, and when the body stream FAILED.
   * A truncated response or a connection reset mid-body errors the stream,
   * which dropped its source at that moment: nothing is left to release and
   * nothing about the failure is actionable here. A repeated call settles with
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
   * A recreation callback must return a NEW error built from its `Response`.
   * Five conditions refuse the result. Each condition releases the orphaned
   * branch before it throws, so the original error stays usable:
   *
   * 1. The callback returns a value that is not an object, such as `null`.
   * 2. The callback returns this same error instead of a new one.
   * 3. The callback returns a value that claims this package copy and carries
   *    no body, such as a Proxy or a delegate wrapped around the new error.
   * 4. The callback returns an error built from a different response.
   * 5. The callback returns an error from a package copy that cannot confirm it
   *    took the cloned branch. An instance built by a different package copy is
   *    accepted when that copy confirms it. A package copy older than this one
   *    cannot confirm it. Upgrade that copy, or build the new error with the
   *    copy that is cloning.
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

    // The copy INHERITS this error's identity instead of re-reading the branch.
    // A branch from a real `Response.clone()` reports the response's internal
    // slots, not the own-property getter that produced this error's identity,
    // so without this handoff `error.clone()` on an error built from a shifting
    // double would return a copy with a different status, message, and url. For
    // a real `Response` it changes nothing, because the platform clone already
    // carries the same values.
    //
    // "Instead of re-reading the branch" holds for every branch a platform
    // `Response.clone()` produces, and a double can still defeat it two ways.
    // A branch this library has ALREADY read keeps the identity it read:
    // `lendIdentity` refuses a loan over a record, so the copy reports the
    // record. And a `recreate` callback that calls `clone()` again, on an error
    // whose double answers with the SAME `Response` every time, puts both loans
    // on one key; the inner revoke removes the outer loan and the copy reads the
    // branch. Both are stated in `./response-identity`, with the reason a
    // per-key stack is refused.
    //
    // A missing entry is the structural impostor `bodyOf` refused on the line
    // above, so there is nothing to hand over and nothing to do.
    //
    // LENT, not recorded, and revoked in the `finally` below. `teed.branch` is
    // whatever `response.clone()` answered with, and a custom Fetch
    // implementation can answer with a `Response` it did not create — a real one
    // that a later, unrelated request will resolve. A permanent record would
    // bind that `Response` to THIS error's identity in a module-scoped table for
    // as long as it lives, so the later request would report this error's status
    // instead of its own. The loan lasts exactly as long as its reason: the
    // constructor reads it, `UnknownHttpError` reads it again, and nothing in
    // this library reads a branch's identity after that. See
    // `./response-identity`, which also records the three rejected alternatives.
    //
    // Neither `lendIdentity` nor the revoke can throw — both ignore a non-object
    // key, and the `WeakMap` operations they perform do not throw for one they
    // accept. That matters HERE specifically: the branch is already teed, so a
    // throw between the tee and the construction would orphan it, leaving
    // `cancel()` on this error waiting forever for an owner that never existed.
    const identity = identities.get(this);
    const revokeLoan = identity ? lendIdentity(teed.branch, identity) : undefined;

    let copy: this;
    // The `finally` is the guard, not the happy path. Every way out of the block
    // below is a way the loan must end: a copy that was built, a subclass
    // constructor that threw, and a `recreate` callback that threw. A revoke
    // written after the block, or repeated in each `catch`, is one edit away
    // from missing a path — and a missed path is exactly the permanent record
    // this loan exists to avoid. `BH-20` pins the path that only the `finally`
    // covers: a `recreate` callback that THROWS. Moving the revoke below the
    // block leaves that loan alive for the life of the process, and every later
    // error built from the branch then reports the double's identity.
    try {
      if (!recreate) {
        try {
          // Read INSIDE the try. `this.constructor` is a property read like any
          // other: an own accessor, or a Proxy `get` trap from an instrumentation
          // wrapper, can throw here — and the branch above is already teed, so a
          // throw outside this block strands it and `cancel()` never settles.
          const Ctor = this.constructor as new (response: Response) => this;
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
          throw new TypeError(`Cannot clone ${this.name}: the recreate callback failed.`, {
            cause,
          });
        }
      }
    } finally {
      revokeLoan?.();
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

    // The callback returned something that cannot own anything.
    //
    // TypeScript's `(response) => this` return type says this cannot happen. A
    // JavaScript consumer, a mocked callback in a test double, and one `as any`
    // all say it can — and it USED to be returned verbatim: `clone(() => null)`
    // resolved to `null`, the branch was stranded, and `cancel()` on the
    // original never settled. Checked here, beside the same-instance check,
    // because it is the same kind of failure (the callback returned the wrong
    // THING) rather than the wrong provenance.
    if (copy === null || (typeof copy !== "object" && typeof copy !== "function")) {
      teed.release();
      throw new TypeError(
        `Cannot clone ${this.name}: the recreate callback returned ` +
          `${copy === null ? "null" : typeof copy} instead of an error, so the cloned body branch ` +
          "has no owner. Build a new instance from the response it receives.",
      );
    }

    // `bodies.get`, NOT `bodyOf`: a `recreate` callback may legitimately return
    // an instance built by a different copy of this library, whose body lives
    // in that copy's table. That `undefined` is not consent on its own — the
    // block below asks the copy, across the seam, whether it took the branch —
    // but it is not a refusal either, and `bodyOf` would make it one.
    //
    // What this copy's table refuses on its own is a body we CAN see that took a
    // different response: the callback ignored the branch and built from
    // somewhere else, so the branch has no owner at all.
    // `undefined` from the table means one of two very different things, and
    // only one of them is safe. Raw `instanceof` — the single-copy question,
    // the one case where it is exactly the right tool — separates them: an
    // object that claims THIS copy's prototype chain was built by this copy's
    // constructor and MUST be in this copy's table. A Proxy wrapper (the
    // standard APM instrumentation pattern), an `Object.create` delegate, or a
    // membrane forwards `getPrototypeOf` and so answers `true` while being
    // unkeyable in the WeakMap. Accepting it pinned one connection and one
    // unreleased stream per cloned error, with no recovery path: `cancel()` on
    // this error waited forever, and the branch could not be released through
    // the copy either, because `this` inside `cancel` is the wrapper.
    if (claimsThisCopy(copy) && bodies.get(copy) === undefined) {
      teed.release();
      throw new TypeError(
        `Cannot clone ${this.name}: the new error claims this copy of the library but carries no ` +
          "body, so the cloned body branch has no owner. A Proxy or delegate wrapped around the " +
          "error cannot own one — return the instance itself.",
      );
    }

    const owner = bodies.get(copy);

    // The owner is not in this copy's table, so it lives in another copy's, or
    // nowhere. This is the ONLY path the two checks above leave open, and it is
    // the one that used to be accepted blind: `adopt(undefined)` returns `true`
    // unconditionally by its own documented contract, so a callback returning an
    // instance from a different package copy — built from a DIFFERENT response —
    // was accepted, the branch became an orphan, and `cancel()` on this error
    // never settled.
    //
    // Reachable only when `claimsThisCopy(copy)` is false: a value that claims
    // this copy and has no table entry was already refused above, with the
    // Proxy-flavoured message it needs. So this branch is exactly "an instance
    // from a genuinely different package copy" plus "an object pretending to be
    // one", which is why the question must be ASKED instead of assumed. The
    // only mechanism that crosses a copy seam is a `Symbol.for` key, which is
    // what `asksOwnsResponse` reads.
    if (owner === undefined) {
      const answer = asksOwnsResponse(copy, teed.branch);
      if (answer === undefined) {
        teed.release();
        throw new TypeError(
          `Cannot clone ${this.name}: the new error cannot confirm that it took the cloned body ` +
            "branch, so the branch has no owner. A copy of @pbpeterson/typed-fetch older than this " +
            "one cannot answer that question. Upgrade that copy, or build the new error with this " +
            "one.",
        );
      }
      // The message here is deliberately IDENTICAL to the different-response
      // message below. The two states are the same state — the callback ignored
      // the branch — and the consumer's fix is the same sentence.
      if (!answer) {
        teed.release();
        throw new TypeError(
          `Cannot clone ${this.name}: the new error was built from a different response, so the ` +
            "cloned body branch has no owner. Build a new instance from the response it receives.",
        );
      }
    }

    // `adopt(undefined)` is still the honest outcome for an owner this copy
    // cannot see: the branch HAS an owner, this copy only cannot mark it. It is
    // no longer the only thing that happens on that path.
    if (!teed.adopt(owner)) {
      teed.release();
      throw new TypeError(
        `Cannot clone ${this.name}: the new error was built from a different response, so the ` +
          "cloned body branch has no owner. Build a new instance from the response it receives.",
      );
    }
    return copy;
  }
}

// Stamp the cross-copy brand on the prototype so every subclass (all 40 status
// classes + UnknownHttpError) inherits it. Keyed by a `Symbol.for`, it is
// identical across module copies, which is what makes the guards work across package copies.
brand(BaseHttpError.prototype, httpErrorBrand);

// Stamped for the same reason and in the same way as the brand above: `toJSON`
// covers `JSON.stringify`, this covers `console.log`/`util.inspect` and Node's
// fatal-exception printer. See `./inspect`.
installInspect(BaseHttpError.prototype);

// Stamped, not declared, for the same reason and in the same way as the brand
// and the inspect hook above. Only BaseHttpError: the question is about a
// response body, and NetworkError, AbortedError, and TimeoutError have none.
stampOwnsResponse(BaseHttpError.prototype, ownsResponse);
