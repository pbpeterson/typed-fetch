/**
 * Custody of the single-use body of a failed `Response`.
 *
 * Every error body needs a read or a cancel: an unread body keeps its stream
 * open, which pins the underlying connection until the runtime collects it.
 * That contract, and everything that enforces it, lives here rather than on the
 * error classes — they carry HTTP identity (status, statusText, url, headers,
 * message), this carries the one-shot stream. Three consecutive rounds of
 * defects lived in this lifecycle (a locked-body guard the readers missed,
 * Bun's `bodyUsed` divergence, a tee branch stranded by a failed clone, a body
 * consumed outside the library); all four are now reachable — and testable —
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
    // Swallow a stream-level failure, the same as `tee().release()` below. A
    // truncated response or a connection reset mid-body errors the body stream,
    // and `stream.cancel()` then rejects with that stored error. The caller
    // asked to DISCARD these bytes, and an errored stream dropped its source
    // when it errored — nothing is left to release, and nothing here is
    // actionable.
    //
    // Swallow at the SOURCE, not around the `await`. `cancel` is an async
    // function, so the promise it returns and the derived promise the repeated
    // call gets from `return cancelling` are both distinct objects from
    // `pending`; a `.catch()` on `pending` alone leaves those two unhandled.
    // Under Node's default `--unhandled-rejections=throw`, one dropped cleanup
    // call then ends the process.
    const pending = stream.cancel(reason).catch(() => {});
    cancelling = pending;
    await pending;
    // `cancelling` names the IN-FLIGHT cancellation; a settled one is `cancelled`.
    cancelling = undefined;
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
        // copy. Swallow the rejection so it cannot surface as unhandled.
        branch.body?.cancel().catch(() => {});
      },
      adopt(sibling) {
        // A sibling that took a DIFFERENT response never took this branch, so
        // the branch is an orphan and the caller has to release it. Report it
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
      return response.json();
    },
    async text(): Promise<string> {
      claim("text");
      return response.text();
    },
    async blob(): Promise<Blob> {
      claim("blob");
      return response.blob();
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      claim("arrayBuffer");
      return response.arrayBuffer();
    },
    cancel,
    tee,
  };

  return body;
}
