/**
 * Custody of the single-use body of a failed `Response`.
 *
 * Every error body needs a read or a cancel: an unread body keeps its stream
 * open, which pins the underlying connection until the runtime collects it.
 * That contract, and everything that enforces it, lives here rather than on the
 * error classes — they carry HTTP identity (status, statusText, url, headers,
 * message), this carries the one-shot stream. Past defects in this lifecycle
 * include a locked-body guard the readers missed, Bun's `bodyUsed` divergence,
 * a tee branch stranded by a failed clone, a body consumed outside the library,
 * and native cleanup hidden by shadowing. Each is reachable — and testable —
 * from this file alone, without constructing an error at all.
 *
 * The `Response` never leaves. It is captured in a closure, not stored as a
 * property, so nothing can route around the guards and nothing here is
 * reachable from the error instance a consumer holds.
 *
 * NO CLASS, and in particular no `#private` field. TypeScript emits a nominal
 * `#private;` marker into the declarations of any class that has one, and this
 * package ships two declaration files whose types must stay mutually
 * assignable — see the header of `./base-http-error` for the full rationale. A
 * factory returning a plain object emits a structural type, which crosses that
 * boundary by shape.
 *
 * This module is INTERNAL. It must never be re-exported from `./index` or the
 * root barrel: the public surface is frozen by snapshots on both the value and
 * the type axis (see `public-surface.spec.ts`), and nothing here is a consumer
 * concern.
 */

/**
 * One branch of a teed body, handed to the caller that is about to decide
 * whether the branch gets an owner.
 */
export interface TeedErrorBody {
  /**
   * The cloned `Response` carrying this branch. Give it to whoever will own it
   * — or, if that owner never comes into existence, {@link release} it.
   */
  readonly branch: Response;
  /**
   * Release a branch nobody took. The platform frees the teed source only once
   * EVERY branch is read or canceled, so a dropped branch leaves `cancel()`
   * on the surviving side waiting forever for an owner that never existed.
   */
  release(): void;
  /**
   * Record that both branches now have owners, and report whether they do.
   *
   * `sibling` is the body of whoever took {@link branch}. It is `undefined`
   * when that owner was built by a DIFFERENT copy of this library — a
   * `recreate` callback may return an instance whose class, and whose body
   * table, came from another loaded package copy. Marking what we can see is the
   * honest outcome; the flag is bookkeeping, never a guard.
   *
   * Do NOT turn this into a guard for the cross-copy case. Whether an owner
   * from another package copy really took the branch is asked in
   * `BaseHttpError.clone()`, through a `Symbol.for`-keyed query the other copy
   * answers — the only mechanism that crosses a copy seam. That question is
   * about identity and prototypes, which live ABOVE this module's seam; this
   * module owns a single-use stream and nothing else.
   *
   * Returns `false`, and records NOTHING, when `sibling` exists but does not
   * own {@link branch}: a `recreate` callback that ignores the response it
   * receives and builds from another one leaves the branch an orphan. The
   * caller must then {@link release} it. Marking `teed` there would record a
   * state that never happened — the two bodies do not share a source.
   */
  adopt(sibling: ErrorBody | undefined): boolean;
}

/** The lifecycle of one failed response body: read it once, release it, or split it. */
export interface ErrorBody {
  /**
   * Set on BOTH branches by {@link TeedErrorBody.adopt}: cloning tees the body
   * stream. Recorded so the documented contract — every branch of a teed body
   * must be read or canceled before the source is released — is inspectable.
   * Written only by `adopt`; nothing in this module branches on it.
   */
  teed: boolean;
  /**
   * Is `candidate` the response this body took custody of?
   *
   * Identity only, and the one question that can be asked about the captured
   * `Response` from outside: the response itself never leaves this module.
   * {@link TeedErrorBody.adopt} asks it of the body that claims to own a
   * branch, so a `recreate` callback that builds from a different response is
   * detected instead of silently orphaning the branch.
   */
  owns(candidate: Response): boolean;
  /** Read the body as JSON. Claims the body; an empty or non-JSON payload still rejects. */
  json<T = unknown>(): Promise<T>;
  /** Read the body as text. Claims the body. */
  text(): Promise<string>;
  /** Read the body as a Blob. Claims the body. */
  blob(): Promise<Blob>;
  /** Read the body as an ArrayBuffer. Claims the body. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /**
   * Release the body without reading it. Never buffers. Rejects only when an
   * EXTERNAL reader holds the stream and has read nothing through it — a
   * stream-level failure, such as a truncated response, resolves. After a
   * {@link tee}, stays pending until the sibling branch is released too.
   */
  cancel(reason?: unknown): Promise<void>;
  /**
   * Split the body in two. Claims nothing — but from the moment it returns,
   * the source has two branches and BOTH must be released. Throws if the body
   * is no longer available.
   */
  tee(): TeedErrorBody;
}

/**
 * Read a native body without trusting an own `body` property.
 *
 * An injected `Response.clone()` can return a real branch with a hostile own
 * getter or value. Its native prototype getter still owns the internal stream.
 */
type ReleasableBody = {
  cancel?: () => unknown;
  destroy?: () => unknown;
};

/**
 * Platform operations captured before an injected response can shadow them.
 *
 * A native object keeps its internal slots after `Object.setPrototypeOf`
 * removes the public prototype chain. Calling these operations directly still
 * reaches those slots. Foreign implementations fail the brand check and fall
 * through to their visible methods below.
 */
const nativeResponseBodyGetter =
  typeof Response === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(Response.prototype, "body")?.get;
const nativeResponsePrototype = typeof Response === "undefined" ? undefined : Response.prototype;
const nativeReadableStreamCancel =
  typeof ReadableStream === "undefined" ? undefined : ReadableStream.prototype.cancel;
const nativeReadableStreamLockedGetter =
  typeof ReadableStream === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(ReadableStream.prototype, "locked")?.get;

function bodyForRelease(response: Response): ReleasableBody | null | undefined {
  if (typeof nativeResponseBodyGetter === "function") {
    try {
      return Reflect.apply(nativeResponseBodyGetter, response, []) as ReleasableBody | null;
    } catch {
      // Node's WebIDL brand check also requires Response.prototype in the
      // chain. A native object can keep its slots after that chain is replaced,
      // so make one scoped attempt with the captured prototype and restore it.
      if (nativeResponsePrototype !== undefined) {
        try {
          const originalPrototype = Object.getPrototypeOf(response) as object | null;
          Object.setPrototypeOf(response, nativeResponsePrototype);
          try {
            return Reflect.apply(nativeResponseBodyGetter, response, []) as ReleasableBody | null;
          } finally {
            Object.setPrototypeOf(response, originalPrototype);
          }
        } catch {
          // Not a repairable native Response. Inspect its own chain.
        }
      }
    }
  }

  // Respect normal property resolution first. For a foreign response with
  // several inherited body getters, this is the same nearest getter validation
  // inspected. A cleanup walk must not silently switch to an ancestor's body.
  try {
    return response.body;
  } catch {
    // The visible getter is hostile. Search behind it for a usable fallback.
  }

  try {
    const seen = new Set<object>();
    let prototype = Object.getPrototypeOf(response) as object | null;
    while (prototype && !seen.has(prototype)) {
      seen.add(prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "body");
      if (typeof descriptor?.get === "function") {
        try {
          return Reflect.apply(descriptor.get, response, []) as ReleasableBody | null;
        } catch {
          // This getter is also hostile. Try the next ancestor.
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
  } catch {
    // A Proxy can refuse prototype inspection. Cleanup remains best effort.
  }

  return undefined;
}

/** Start one cancellation and silence a rejection without retrying the call. */
function tryCancelBody(body: ReleasableBody, cancelMethod: unknown): boolean {
  if (typeof cancelMethod !== "function") return false;

  let pending: unknown;
  try {
    pending = Reflect.apply(cancelMethod, body, []) as unknown;
  } catch {
    return false;
  }

  try {
    if (pending !== null && (typeof pending === "object" || typeof pending === "function")) {
      const catchMethod = Reflect.get(pending, "catch", pending) as unknown;
      if (typeof catchMethod === "function") {
        void Reflect.apply(catchMethod, pending, [() => {}]);
      }
    }
  } catch {
    // Cancellation already started. Cleanup must not call it twice merely
    // because a hostile thenable hid its rejection handler.
  }
  return true;
}

/** Whether this runtime's ReadableStream intrinsics accept the body. */
function isNativeReadableStream(body: ReleasableBody): boolean {
  if (typeof nativeReadableStreamLockedGetter !== "function") return false;
  try {
    Reflect.apply(nativeReadableStreamLockedGetter, body, []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release an unreachable body without allowing cleanup to replace the cause.
 *
 * A value rejected by `isResponse` can still carry a Node readable stream.
 * Such a stream has `destroy()` instead of the WHATWG `cancel()` method.
 *
 * @internal
 */
export function releaseResponseBody(response: Response): void {
  const body = bodyForRelease(response);
  if (!body) return;

  // Prefer the captured operation for a confirmed native stream. An own
  // callable can be just as broken as a missing one: it can throw after a side
  // effect or return without releasing anything.
  if (isNativeReadableStream(body) && tryCancelBody(body, nativeReadableStreamCancel)) {
    return;
  }

  let visibleCancel: unknown;
  try {
    visibleCancel = body.cancel;
  } catch {
    // A foreign body can hide its release method. Try destroy() below.
  }
  if (tryCancelBody(body, visibleCancel)) return;

  try {
    const destroyMethod = body.destroy;
    if (typeof destroyMethod === "function") Reflect.apply(destroyMethod, body, []);
  } catch {
    // The response or stream is not usable enough to release.
  }
}

export function errorBodyOf(response: Response): ErrorBody {
  /** Set by {@link ErrorBody.cancel}. */
  let cancelled = false;

  /**
   * Set by this library's own body readers. Tracked separately from
   * `response.bodyUsed` because that flag is runtime-specific: Bun reports it
   * as soon as `getReader()` locks the stream, while Node, Deno, and workerd
   * keep it `false` until the stream is disturbed. Keying "we already consumed
   * this" on `bodyUsed` therefore misreads an EXTERNAL reader as our own.
   */
  let readStarted = false;

  /**
   * The in-flight `cancel()`, so a repeated call settles WITH the first one
   * instead of reporting success while the first is still waiting. Cleared
   * once it settles; `canceled` then carries the state.
   */
  let cancelling: Promise<void> | undefined;

  /**
   * Is the body still ours to take?
   *
   * A `Response` body is a one-shot stream; a second read otherwise throws the
   * platform's opaque `TypeError: Body is unusable`. A canceled body and a
   * locked stream both count as unavailable. A locked stream is the case a
   * `bodyUsed`-only guard misses: a reader holds it while `bodyUsed` can still
   * be `false`.
   *
   * ONE predicate, TWO callers — {@link claim} and {@link ErrorBody.tee} —
   * which phrase the refusal differently because a consumer who called `json()`
   * needs different advice than one who called `clone()`. This used to be
   * written out twice, one edit away from the two copies disagreeing about
   * what "unusable" means.
   */
  function claimable(): boolean {
    return !(cancelled || readStarted || response.bodyUsed || response.body?.locked);
  }

  /** Take the body for a read, or refuse with the reader-flavoured message. */
  function claim(method: string): void {
    if (!claimable()) {
      throw new TypeError(
        `Cannot read this error's body with ${method}(): its response body has already been read, ` +
          "cancelled, or its stream is locked. Response bodies are single-use — call clone() BEFORE " +
          "the first read to read it more than once.",
      );
    }
    readStarted = true;
  }

  /**
   * Run the platform reader, and give the claim back if it never ran at all.
   *
   * `readStarted` is latched before the reader, because a read that HAS started
   * must refuse every later reader and make `cancel()` a no-op. A reader that
   * throws SYNCHRONOUSLY never touched the stream, so latching it there stranded
   * the body: `cancel()` took its `readStarted` early return and reported
   * success while the stream stayed unread, unlocked, and open.
   *
   * A REJECTED promise is not this case and is not rolled back — the read
   * genuinely started, and the bytes are gone whatever the rejection says.
   *
   * A no-op for a platform `Response`, whose readers do not throw synchronously.
   * It is the injected-`fetch` seam that admits one.
   */
  function startRead<T>(run: () => Promise<T>): Promise<T> {
    try {
      return run();
    } catch (cause) {
      readStarted = false;
      throw cause;
    }
  }

  async function cancel(reason?: unknown): Promise<void> {
    // 1. A repeated cancel settles WITH the in-flight one. Returning early
    //    here would report success while the first call is still waiting for
    //    a teed sibling branch.
    if (cancelling) return cancelling;
    if (cancelled) return;

    // 2. This library already started the read, so the body is no longer available.
    //    Checked before the lock test because a completed read leaves the
    //    stream locked on some runtimes.
    if (readStarted) {
      cancelled = true;
      return;
    }

    const stream = response.body;

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
    if (stream?.locked && !response.bodyUsed) {
      throw new TypeError(
        "Cannot cancel this error's body: its stream is locked by a reader. " +
          "Release the reader with reader.releaseLock(), or cancel the reader itself.",
      );
    }

    // 4. Nothing to release: no body, or it was consumed elsewhere.
    if (!stream || response.bodyUsed) {
      cancelled = true;
      return;
    }

    // 5. Release it. The body is claimed from here on, whatever the stream does
    //    next: this await lasts as long as a teed sibling is held, and a reader
    //    admitted during that window would take a stream already going away.
    cancelled = true;

    // Publish the in-flight cancellation BEFORE the stream can run any of it.
    // `ReadableStreamCancel` invokes the underlying source's cancel algorithm
    // SYNCHRONOUSLY, inside the `stream.cancel(reason)` call below. For a
    // consumer-constructed `ReadableStream` that algorithm is consumer code,
    // and it can call back in here. Assigning `cancelling` only after
    // `stream.cancel()` RETURNED left that re-entrant call looking at
    // `cancelled = true` and `cancelling = undefined`: it took step 2 and
    // reported success while this call was still waiting for the real release
    // — precisely what step 1 exists to prevent.
    //
    // A separate deferred, not the stream's own promise, because the stream's
    // promise does not exist yet at the moment it must already be observable.
    // It only ever resolves, so `return cancelling` cannot produce a rejection
    // for anyone to leave unhandled.
    let settleCancelling!: () => void;
    cancelling = new Promise<void>((resolve) => {
      settleCancelling = resolve;
    });

    try {
      // Reach the stream the way {@link releaseResponseBody} does, for the same
      // reason: the visible `cancel` is not necessarily the platform's. An own
      // callable can be a no-op that returns a resolved promise, and this call
      // would then report a released body while the source is still open —
      // the connection leak this module exists to prevent, reported as success.
      let pending: unknown;
      try {
        pending =
          isNativeReadableStream(stream as unknown as ReleasableBody) &&
          typeof nativeReadableStreamCancel === "function"
            ? Reflect.apply(nativeReadableStreamCancel, stream, [reason])
            : stream.cancel(reason);
      } catch {
        // The call itself failed, synchronously. There is no promise to await,
        // and a body whose own release method throws is one this library cannot
        // release — the same dead end `releaseResponseBody` accepts.
      }

      // Swallow a stream-level failure, the same as `tee().release()` below. A
      // truncated response or a connection reset mid-body errors the body
      // stream, and `stream.cancel()` then rejects with that stored error. The
      // caller asked to DISCARD these bytes, and an errored stream dropped its
      // source when it errored — nothing is left to release, and nothing here
      // is actionable.
      //
      // Swallow at the SOURCE, not around the `await`. `cancel` is an async
      // function, so the promise it returns and the derived promise the
      // repeated call gets from `return cancelling` are both distinct objects
      // from this one; a `.catch()` further out leaves those two unhandled.
      // Under Node's default `--unhandled-rejections=throw`, one dropped
      // cleanup call then ends the process.
      //
      // `Promise.resolve(pending)`, never `pending.catch(…)`: a `cancel` that
      // answers with a non-thenable used to make THIS function reject with a
      // `TypeError` about reading `catch` of undefined — turning the swallow
      // into the very unhandled rejection the paragraph above describes.
      await Promise.resolve(pending).catch(() => {});
    } finally {
      // `cancelling` names the IN-FLIGHT cancellation; a settled one is
      // `cancelled`. Clear it before releasing the waiters, so a waiter that
      // resumes and calls `cancel()` again takes step 2 rather than awaiting a
      // promise that has already settled.
      cancelling = undefined;
      settleCancelling();
    }
  }

  function tee(): TeedErrorBody {
    if (!claimable()) {
      throw new TypeError(
        "Cannot clone this error: its response body has already been read, cancelled, or its stream " +
          "is locked. Call clone() before json()/text()/blob()/arrayBuffer()/cancel().",
      );
    }
    // From here the body is TEED: two branches exist, and the platform frees
    // the source only once BOTH are released. Every failure path the caller
    // takes from here must release the branch it is about to drop, or
    // `cancel()` on this body would wait forever for an owner that never
    // existed.
    const branch = response.clone();
    return {
      branch,
      release() {
        // Nobody can await this: the caller is receiving an exception, not a
        // copy. Cleanup is total and swallows a stream rejection.
        releaseResponseBody(branch);
      },
      adopt(sibling) {
        // A sibling that took a DIFFERENT response never took this branch, so
        // the branch is an orphan and the caller must release it. Report it
        // before writing anything: `teed` would otherwise record a shared
        // source that does not exist.
        if (sibling && !sibling.owns(branch)) return false;
        // Both sides now share one teed source, and both must be released.
        body.teed = true;
        if (sibling) sibling.teed = true;
        return true;
      },
    };
  }

  // `tee` captures `body` but never reads it until a caller invokes `tee()`,
  // by which point this initializer has completed.
  const body: ErrorBody = {
    teed: false,
    owns(candidate: Response): boolean {
      return candidate === response;
    },
    async json<T = unknown>(): Promise<T> {
      claim("json");
      return startRead(() => response.json() as Promise<T>);
    },
    async text(): Promise<string> {
      claim("text");
      return startRead(() => response.text());
    },
    async blob(): Promise<Blob> {
      claim("blob");
      return startRead(() => response.blob());
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      claim("arrayBuffer");
      return startRead(() => response.arrayBuffer());
    },
    cancel,
    tee,
  };

  return body;
}
