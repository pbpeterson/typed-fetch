import { isObjectLike } from "./untrusted-read";

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
   * Whether {@link branch} is the original response rather than an independent
   * branch. A custom `clone()` that returns its receiver did not tee anything;
   * the caller must refuse it before throwing. In that case {@link release} is
   * deliberately a no-op: there is no independent branch to release, and
   * canceling the returned value would cancel the original response.
   */
  isOriginal(): boolean;
  /** Whether the clone produced an independent body stream. */
  isIndependent(): boolean;
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
  locked?: boolean;
  cancel?: (reason?: unknown) => unknown;
  destroy?: () => unknown;
};

type ResponseBody = ReleasableBody | null | undefined;

type BodyLifecycle = {
  cancelled: boolean;
  readStarted: boolean;
  cancelling: Promise<void> | undefined;
  bodyObserved: boolean;
  observedBody: ResponseBody;
};

/**
 * The first body observed for a response is the body this module owns.
 *
 * A foreign `Response` is allowed to answer `body` with a different stream on
 * every read. Keeping the first answer makes cleanup and the public body handle
 * agree about custody. `response-verdict` can also file the body while it is
 * validating a value, before this module gets the error-body handle.
 */
const responseBodies = new WeakMap<object, ResponseBody>();
const bodyLifecycles = new WeakMap<object, BodyLifecycle>();

/**
 * Only file a body that can participate in cleanup. A structurally refused
 * response may briefly expose `{ locked: 1 }` or another non-stream value; if
 * that refusal poisoned the table, a later honest presentation of the same
 * mutable object would inherit the bogus lock forever.
 */
function isRememberableBody(body: unknown): body is ResponseBody {
  if (body === null) return true;
  if (!isObjectLike(body)) return false;
  try {
    return typeof Reflect.get(body, "locked", body) === "boolean";
  } catch {
    return false;
  }
}

/** Remember a body without widening the package's public surface. */
export function rememberResponseBody(response: Response, body: unknown): ResponseBody {
  if (!isObjectLike(response)) return undefined;
  if (responseBodies.has(response)) return responseBodies.get(response);
  const candidate = nativeBodyForSnapshot(response, body);
  if (!isRememberableBody(candidate)) return undefined;
  responseBodies.set(response, candidate);
  return responseBodies.get(response);
}

/** Forget a body after a refused presentation has released it. */
export function forgetResponseBody(response: Response, expected?: ResponseBody): void {
  if (!isObjectLike(response)) return;
  if (expected === undefined || responseBodies.get(response) === expected) {
    responseBodies.delete(response);
  }
}

/** Return the body filed by an earlier response-phase observation, if any. */
export function responseBodySnapshot(response: Response): ResponseBody | undefined {
  if (!isObjectLike(response)) return undefined;
  return responseBodies.get(response);
}

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
const nativeResponseBodyUsedGetter = (() => {
  const responseConstructor =
    typeof Response === "undefined" ? undefined : (Response as typeof globalThis.Response);
  const prototype = responseConstructor?.prototype;
  return prototype === undefined || prototype === null
    ? undefined
    : Object.getOwnPropertyDescriptor(prototype, "bodyUsed")?.get;
})();
const nativeResponsePrototype = typeof Response === "undefined" ? undefined : Response.prototype;
const nativeReadableStreamCancel =
  typeof ReadableStream === "undefined" ? undefined : ReadableStream.prototype.cancel;
const nativeReadableStreamLockedGetter =
  typeof ReadableStream === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(ReadableStream.prototype, "locked")?.get;

/** Promise operations whose prototype/static slots may be shadowed by input. */
const nativePromiseConstructor = Promise;
const nativePromiseResolve = Promise.resolve;
const nativePromiseThen = Promise.prototype.then;

const ignoreRejection = (): undefined => undefined;

function resolveWithNativePromise(value: unknown): Promise<unknown> {
  return Reflect.apply(nativePromiseResolve, nativePromiseConstructor, [value]) as Promise<unknown>;
}

/**
 * A few older Fetch doubles expose only `catch()` rather than a thenable. Keep
 * that compatibility fallback, but never use a replaceable `catch` on an
 * actual Promise: native `then` is the only operation trusted for promises.
 */
function legacyCatchOnly(value: unknown, normalized: Promise<unknown>): unknown {
  if (!isObjectLike(value) || normalized === value) return undefined;

  try {
    const then = Reflect.get(value, "then", value);
    if (typeof then === "function") return undefined;
    const catchMethod = Reflect.get(value, "catch", value);
    if (typeof catchMethod !== "function") return undefined;
    return Reflect.apply(catchMethod, value, [ignoreRejection]);
  } catch {
    return undefined;
  }
}

/** Attach a rejection handler through captured Promise intrinsics. */
function observePending(pending: unknown): Promise<unknown> {
  let normalized: Promise<unknown>;
  try {
    normalized = resolveWithNativePromise(pending);
  } catch {
    return resolveWithNativePromise(undefined);
  }

  let observed: Promise<unknown>;
  try {
    observed = Reflect.apply(nativePromiseThen, normalized, [
      undefined,
      ignoreRejection,
    ]) as Promise<unknown>;
  } catch {
    return resolveWithNativePromise(undefined);
  }

  const legacy = legacyCatchOnly(pending, normalized);
  if (legacy === undefined) return observed;

  try {
    const legacyPromise = resolveWithNativePromise(legacy);
    return Reflect.apply(nativePromiseThen, legacyPromise, [
      undefined,
      ignoreRejection,
    ]) as Promise<unknown>;
  } catch {
    return observed;
  }
}

/**
 * Read a captured Response slot without accepting a shadowing own property.
 *
 * The ordinary path needs no prototype mutation: Web IDL accessors read the
 * native internal slots even when a consumer installed an own `body` or
 * `bodyUsed`. The repair path mirrors `bodyForRelease` for a native Response
 * whose prototype chain was replaced after construction.
 */
function nativeResponseValue<T>(getter: unknown, response: Response): T | undefined {
  if (typeof getter !== "function") return undefined;

  try {
    return Reflect.apply(getter, response, []) as T;
  } catch {
    if (nativeResponsePrototype === undefined) return undefined;

    try {
      const originalPrototype = Object.getPrototypeOf(response) as object | null;
      Object.setPrototypeOf(response, nativeResponsePrototype);
      try {
        return Reflect.apply(getter, response, []) as T;
      } finally {
        Object.setPrototypeOf(response, originalPrototype);
      }
    } catch {
      // Foreign values and unrepairable proxies use their visible surface.
      return undefined;
    }
  }
}

/** Prefer native body slots over an own `body` shadow on a real Response. */
function nativeBodyForSnapshot(response: Response, visible: unknown): unknown {
  const native = nativeResponseValue<ResponseBody>(nativeResponseBodyGetter, response);
  return native === undefined ? visible : native;
}

/**
 * Preserve an explicit accessor override used by a Fetch runtime or subclass
 * to model its body-used semantics (for example, Bun reports a reader lock as
 * used). Data-property shadows are not overrides: those are untrusted values
 * and the native slot below wins over them.
 */
function responseBodyUsedOverride(response: Response): boolean | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(response, "bodyUsed");
    if (descriptor && ("get" in descriptor || "set" in descriptor)) {
      const value = response.bodyUsed;
      return typeof value === "boolean" ? value : undefined;
    }

    if (nativeResponsePrototype === undefined) return undefined;

    let prototype = Object.getPrototypeOf(response) as object | null;
    while (prototype && prototype !== nativeResponsePrototype) {
      const inherited = Object.getOwnPropertyDescriptor(prototype, "bodyUsed");
      if (
        inherited &&
        (typeof inherited.get === "function" || typeof inherited.set === "function")
      ) {
        const value = response.bodyUsed;
        return typeof value === "boolean" ? value : undefined;
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
  } catch {
    // Native slots remain authoritative when an own or inherited accessor is
    // hostile. Foreign values are treated as unavailable below.
  }

  return undefined;
}

/** Read body-used state from native slots, falling back for foreign Responses. */
function responseBodyUsed(response: Response): boolean {
  // A native consumed slot cannot be reopened by an accessor that lies false.
  // Return before consulting that accessor at all when the intrinsic already
  // knows the body is used.
  const native = nativeResponseValue<boolean>(nativeResponseBodyUsedGetter, response);
  if (native === true) return true;

  const override = responseBodyUsedOverride(response);
  if (override === true) return true;
  if (native === false) return false;

  try {
    const visible = response.bodyUsed;
    return typeof visible === "boolean" ? visible : true;
  } catch {
    // An unknown foreign body state must not reopen a stream for a read.
    return true;
  }
}

function bodyForRelease(response: Response): ResponseBody {
  if (!isObjectLike(response)) return undefined;
  if (responseBodies.has(response)) return responseBodies.get(response);

  let body: ResponseBody;
  if (typeof nativeResponseBodyGetter === "function") {
    try {
      body = Reflect.apply(nativeResponseBodyGetter, response, []) as ReleasableBody | null;
      return body;
    } catch {
      // Node's WebIDL brand check also requires Response.prototype in the
      // chain. A native object can keep its slots after that chain is replaced,
      // so make one scoped attempt with the captured prototype and restore it.
      //
      // The guard is REACHABLE, and the reason is worth stating: the two values
      // come from FOUR separate reads of a mutable global, not from one
      // condition. A `Response` global that answers the getter lookup with the
      // real class and the prototype lookup with anything else leaves this
      // module holding a getter and no prototype. The arm then falls through to
      // the visible members below, which is the right answer for an object this
      // module cannot repair.
      if (nativeResponsePrototype !== undefined) {
        try {
          const originalPrototype = Object.getPrototypeOf(response) as object | null;
          Object.setPrototypeOf(response, nativeResponsePrototype);
          try {
            body = Reflect.apply(nativeResponseBodyGetter, response, []) as ReleasableBody | null;
            return body;
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
    body = response.body;
    return body;
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
          body = Reflect.apply(descriptor.get, response, []) as ReleasableBody | null;
          return body;
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

/**
 * Read a stream's lock state from its intrinsic slot when it is native.
 * Foreign streams retain their visible `locked` member, including a getter
 * that may call back into this body; callers establish their re-entrancy guard
 * before reaching this helper.
 */
function bodyLocked(body: ReleasableBody | null | undefined): boolean | undefined {
  if (!body) return undefined;

  if (typeof nativeReadableStreamLockedGetter === "function") {
    try {
      return Reflect.apply(nativeReadableStreamLockedGetter, body, []) as boolean;
    } catch {
      // A foreign stream fails the native brand check; inspect its surface.
    }
  }

  return body.locked;
}

/** Start one cancellation and silence a rejection without retrying the call. */
function tryCancelBody(body: ReleasableBody, cancelMethod: unknown): Promise<unknown> | undefined {
  if (typeof cancelMethod !== "function") return undefined;

  let pending: unknown;
  try {
    pending = Reflect.apply(cancelMethod, body, []) as unknown;
  } catch {
    return undefined;
  }

  // Cancellation already started. Cleanup must not call it twice merely
  // because a hostile Promise hid its replaceable rejection handler.
  return observePending(pending);
}

/** Cancel a body, falling back to a Node-style destroy operation when needed. */
function releaseBodyWithFallback(body: ReleasableBody, reason?: unknown): Promise<unknown> {
  let started = false;
  let pending: unknown;

  try {
    if (isNativeReadableStream(body) && typeof nativeReadableStreamCancel === "function") {
      pending = Reflect.apply(nativeReadableStreamCancel, body, [reason]);
      started = true;
    } else {
      const cancelMethod = body.cancel;
      if (typeof cancelMethod === "function") {
        pending = Reflect.apply(cancelMethod, body, [reason]);
        started = true;
      }
    }
  } catch {
    // A missing or throwing cancel method may still have a destroy fallback.
  }

  if (!started) {
    try {
      const destroyMethod = body.destroy;
      if (typeof destroyMethod === "function") {
        pending = Reflect.apply(destroyMethod, body, []);
        started = true;
      }
    } catch {
      // The body is not usable enough to release.
    }
  }

  return observePending(started ? pending : undefined);
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
const responsesBeingReleased = new WeakSet<object>();
const bodiesBeingReleased = new WeakSet<object>();

export function releaseResponseBody(response: Response): void {
  if (!isObjectLike(response) || responsesBeingReleased.has(response)) return;
  responsesBeingReleased.add(response);

  try {
    const body = bodyForRelease(response);
    if (!body || !isObjectLike(body) || bodiesBeingReleased.has(body)) return;
    bodiesBeingReleased.add(body);

    let pendingRelease: Promise<unknown> | undefined;
    try {
      // Prefer the captured operation for a confirmed native stream. An own
      // callable can be just as broken as a missing one: it can throw after a
      // side effect or return without releasing anything.
      if (isNativeReadableStream(body)) {
        try {
          pendingRelease = observePending(
            Reflect.apply(
              nativeReadableStreamCancel as (...args: unknown[]) => unknown,
              body,
              [],
            ) as unknown,
          );
          return;
        } catch {
          // A native stream whose intrinsic cancel throws still gets the
          // visible/destroy fallback below.
        }
      }

      let visibleCancel: unknown;
      try {
        visibleCancel = body.cancel;
      } catch {
        // A foreign body can hide its release method. Try destroy() below.
      }
      pendingRelease = tryCancelBody(body, visibleCancel);
      if (pendingRelease !== undefined) return;

      try {
        const destroyMethod = body.destroy;
        if (typeof destroyMethod === "function") {
          pendingRelease = observePending(Reflect.apply(destroyMethod, body, []));
        }
      } catch {
        // The response or stream is not usable enough to release.
      }
    } finally {
      if (pendingRelease === undefined) {
        bodiesBeingReleased.delete(body);
      } else {
        const releaseComplete = (): void => {
          bodiesBeingReleased.delete(body);
        };
        void Reflect.apply(nativePromiseThen, pendingRelease, [releaseComplete, releaseComplete]);
      }
    }
  } finally {
    responsesBeingReleased.delete(response);
  }
}

export function errorBodyOf(response: Response): ErrorBody {
  const key = isObjectLike(response) ? response : undefined;
  const state: BodyLifecycle =
    key === undefined
      ? {
          cancelled: false,
          readStarted: false,
          cancelling: undefined,
          bodyObserved: false,
          observedBody: undefined,
        }
      : (bodyLifecycles.get(key) ?? {
          cancelled: false,
          readStarted: false,
          cancelling: undefined,
          bodyObserved: false,
          observedBody: undefined,
        });
  if (key !== undefined) bodyLifecycles.set(key, state);

  function ownedBody(): ResponseBody {
    if (responseBodies.has(response)) return responseBodies.get(response);
    if (!state.bodyObserved) {
      state.observedBody = bodyForRelease(response);
      state.bodyObserved = true;
    }
    return state.observedBody;
  }

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
    if (state.cancelled || state.readStarted || state.cancelling) return false;

    const stream = ownedBody();
    const used = responseBodyUsed(response);
    const locked = bodyLocked(stream);
    // A hostile getter may start cancellation or another read while the
    // predicate is running. Re-check custody after every untrusted read before
    // handing the body to the caller.
    if (state.cancelled || state.readStarted || state.cancelling) return false;
    return !(used || locked);
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
    state.readStarted = true;
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
      state.readStarted = false;
      throw cause;
    }
  }

  async function cancel(reason?: unknown): Promise<void> {
    // 1. A repeated cancel settles WITH the in-flight one. Returning early
    //    here would report success while the first call is still waiting for
    //    a teed sibling branch.
    if (state.cancelling) return state.cancelling;
    if (state.cancelled) return;

    // Publish the guard BEFORE reading body/bodyUsed/locked/cancel. Every one
    // of those members belongs to an injected response or stream and can call
    // back into this body synchronously. Publishing after the preflight let a
    // re-entrant call start a second cancellation against the same stream.
    let settleCancelling!: () => void;
    let rejectCancelling!: (cause: unknown) => void;
    let preflightFailed = false;
    const inFlight = new Promise<void>((resolve, reject) => {
      settleCancelling = resolve;
      rejectCancelling = reject;
    });
    // The owner receives the thrown preflight error directly. This handler
    // keeps the internal promise used by re-entrant callers from becoming an
    // unrelated unhandled rejection when there is no such caller.
    void Reflect.apply(nativePromiseThen, inFlight, [undefined, ignoreRejection]);
    state.cancelling = inFlight;

    try {
      // 2. This library already started the read, so the body is no longer available.
      //    Checked before the lock test because a completed read leaves the
      //    stream locked on some runtimes.
      if (state.readStarted) {
        state.cancelled = true;
        return;
      }

      // Read through the same captured/native-aware helper used by unreachable
      // response cleanup. A consumer or injected response may shadow `body` with
      // null even though a native Response still owns a live internal stream.
      // Foreign responses fall through to their visible body getter in
      // `bodyForRelease`, so this does not require native Response branding.
      const stream = ownedBody();
      const used = responseBodyUsed(response);
      const locked = bodyLocked(stream);

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
      if (locked && !used) {
        throw new TypeError(
          "Cannot cancel this error's body: its stream is locked by a reader. " +
            "Release the reader with reader.releaseLock(), or cancel the reader itself.",
        );
      }

      // 4. Nothing to release: no body, or it was consumed elsewhere.
      if (!stream || used) {
        state.cancelled = true;
        return;
      }

      // 5. Release it. The body is claimed from here on, whatever the stream does
      //    next: this await lasts as long as a teed sibling is held, and a reader
      //    admitted during that window would take a stream already going away.
      state.cancelled = true;

      // Reach the stream the way {@link releaseResponseBody} does, for the same
      // reason: the visible `cancel` is not necessarily the platform's. An own
      // callable can be a no-op that returns a resolved promise, and this call
      // would then report a released body while the source is still open —
      // the connection leak this module exists to prevent, reported as success.
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
      // `observePending` normalizes the result and attaches a rejection handler
      // through the captured intrinsic `Promise.prototype.then`. A cancel that
      // answers with a non-thenable therefore still resolves instead of
      // turning cleanup into an unhandled rejection.
      await releaseBodyWithFallback(stream, reason);
    } catch (cause) {
      preflightFailed = true;
      rejectCancelling(cause);
      throw cause;
    } finally {
      // `cancelling` names the IN-FLIGHT cancellation; a settled one is
      // `cancelled`. Clear it before releasing the waiters, so a waiter that
      // resumes and calls `cancel()` again takes step 2 rather than awaiting a
      // promise that has already settled.
      state.cancelling = undefined;
      if (!preflightFailed) settleCancelling();
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
    const hadResponseSnapshot = responseBodies.has(response);
    const sourceBody = ownedBody();
    const branch = response.clone();
    const branchBody = bodyForRelease(branch);
    const independent =
      branch !== response &&
      ((sourceBody === null && branchBody === null) || branchBody !== sourceBody);
    const refreshedOriginalBody =
      isNativeReadableStream(sourceBody as ReleasableBody) && nativeResponseBodyGetter !== undefined
        ? (nativeResponseValue<ResponseBody>(nativeResponseBodyGetter, response) ?? sourceBody)
        : sourceBody;

    // Native `Response.clone()` replaces the stream exposed by the original
    // response with a new tee branch. A snapshot from validation therefore
    // describes the pre-clone stream and must be refreshed for the original;
    // otherwise canceling the original would inspect the now-locked source.
    if (hadResponseSnapshot) {
      responseBodies.delete(response);
      rememberResponseBody(response, refreshedOriginalBody);
    } else {
      state.observedBody = refreshedOriginalBody;
      state.bodyObserved = true;
    }

    return {
      branch,
      isOriginal() {
        return branch === response;
      },
      isIndependent() {
        return independent;
      },
      release() {
        // Nobody can await this: the caller is receiving an exception, not a
        // copy. A clone implementation that returned the original did not
        // create a branch; releasing it must not cancel the original body.
        if (branch === response) return;
        // Otherwise cleanup is total and swallows a stream rejection.
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
