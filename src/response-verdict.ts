import { statusCodeErrorMap } from "./http-status-codes";
import { UnknownHttpError } from "./errors/unknown-http-error";
import type { ClientErrors, ServerErrors } from "./errors/helpers";
import {
  hasTypedResponseIdentityScalars,
  headersOf,
  stageIdentity,
  statusOf,
} from "./errors/response-identity";
import { isObjectLike } from "./errors/untrusted-read";
import { releaseResponseBody } from "./errors/error-body";

/**
 * The response phase: what a resolved value becomes.
 *
 * ## Why this is its own module
 *
 * A transport is a seam a consumer is invited to use, so the value it resolves
 * is untrusted input. Deciding what that value is — a success, an HTTP error
 * for its status, or a refusal — is a total function over one argument, and
 * none of it performs a request. Behind a call it is addressable directly: a
 * hostile getter, a partial polyfill, and a foreign `Response` are all one
 * argument away, with no transport and no envelope in between.
 *
 * ## The contract
 *
 * - Total. Every input produces a verdict. It never throws, whatever the value
 *   does when read.
 * - The ORDER is load-bearing: the structural verdict first, then the status
 *   dispatch, then the success surface. See {@link isResponse}.
 * - On success the value is returned UNMODIFIED. This module never wraps,
 *   freezes, or proxies it — ADR 0003, out-of-scope item 3.
 * - A refusal files nothing against the value and releases its body. ADR 0003
 *   row H-14: a value refused once has no identity filed against it.
 * - A refusal is a `NetworkError` at the caller, never an `AbortedError` and
 *   never a `TimeoutError`. This module never consults a signal.
 */

/**
 * The members a foreign `Response` must expose to be accepted.
 *
 * The success branch returns this value as `TypedResponse`, so validation
 * must cover the standard response surface promised to the caller, not only
 * the members this library reads before returning it. `node-fetch@2` lacks
 * `formData`, `type`, and a WHATWG body stream. Accepting it makes
 * `error.cancel()` fail and leaves a success value without members its type
 * promises.
 *
 * A `Request` also lacks `status`, `statusText`, `ok`, `redirected`, and
 * `type`, so this set excludes one.
 */
const FOREIGN_RESPONSE_FIELDS = [
  "body",
  "bodyUsed",
  "headers",
  "ok",
  "redirected",
  "status",
  "statusText",
  "type",
  "url",
];
const FOREIGN_RESPONSE_METHODS = [
  "arrayBuffer",
  "blob",
  "clone",
  "formData",
  "json",
  "text",
] as const;
const FOREIGN_RESPONSE_BODY_METHODS = [
  "cancel",
  "getReader",
  "pipeThrough",
  "pipeTo",
  "tee",
] as const;
// `getSetCookie` is here because `TypedResponse` PROMISES it: the success
// headers are typed as the ambient `Headers`, so a member the type names has to
// be a member the accepted value carries. A standards-compatible polyfill
// without it is refused on the success path. The method has been on
// `Headers.prototype` since Node 20.0.0, the package floor.
const FOREIGN_RESPONSE_HEADERS_METHODS = [
  "append",
  "delete",
  "entries",
  "forEach",
  "get",
  "getSetCookie",
  "has",
  "keys",
  "set",
  "values",
] as const;
const FOREIGN_RESPONSE_TYPES = new Set([
  "basic",
  "cors",
  "default",
  "error",
  "opaque",
  "opaqueredirect",
]);

/** Values whose full operational baseline `isResponse` already checked. */
const validatedResponseStructures = new WeakSet<object>();

function hasCallableMethods(value: unknown, methods: readonly PropertyKey[]): boolean {
  if (!isObjectLike(value)) return false;
  return methods.every((method) => typeof Reflect.get(value, method, value) === "function");
}

function hasCompatibleForeignBody(value: object): boolean {
  const body = Reflect.get(value, "body", value) as unknown;
  if (body === null) return true;
  return (
    isObjectLike(body) &&
    typeof Reflect.get(body, "locked", body) === "boolean" &&
    hasCallableMethods(body, FOREIGN_RESPONSE_BODY_METHODS)
  );
}

function hasCompatibleForeignHeaders(headers: unknown): boolean {
  return (
    hasCallableMethods(headers, FOREIGN_RESPONSE_HEADERS_METHODS) &&
    isObjectLike(headers) &&
    typeof Reflect.get(headers, Symbol.iterator, headers) === "function"
  );
}

/**
 * Validate the complete visible surface before a response escapes as success.
 *
 * Identity fields pass through their first-read cache, so this check cannot
 * consume one getter answer and return a later one. `isResponse` already checked
 * the non-scalar surface. HTTP errors do not call this helper, so they retain
 * identity normalization. This is a handoff check, not a membrane: typedFetch
 * returns this same object, and its implementation must keep the accepted
 * surface compatible afterwards.
 */
function hasCompatibleSuccessSurface(response: Response): boolean {
  // UNREACHABLE, kept as this function's statement of its own precondition:
  // `isResponse` adds every value it accepts to `validatedResponseStructures`
  // before it answers true, and the only caller runs behind that acceptance
  // with the same object.
  /* v8 ignore start */
  if (!validatedResponseStructures.has(response)) return false;
  /* v8 ignore stop */
  if (!hasCompatibleForeignHeaders(headersOf(response))) return false;
  if (!hasTypedResponseIdentityScalars(response)) return false;

  return (
    typeof Reflect.get(response, "ok", response) === "boolean" &&
    typeof Reflect.get(response, "redirected", response) === "boolean" &&
    FOREIGN_RESPONSE_TYPES.has(Reflect.get(response, "type", response) as string)
  );
}

/**
 * Realm-safe `Response` validation.
 *
 * Calling the native status getter avoids accepting an object that only spoofs
 * `[object Response]`. A structural fallback admits standards-compatible Fetch
 * polyfills from another implementation while rejecting partial test doubles.
 */
function isResponse(value: unknown): value is Response {
  if (!isObjectLike(value)) return false;

  let hasPlatformSlots = false;
  try {
    if (typeof Response !== "undefined") {
      const getter = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get;
      if (typeof getter === "function") {
        Reflect.apply(getter, value, []);
        hasPlatformSlots = true;
      }
    }
  } catch {
    // A foreign standards-compatible implementation has different internal
    // slots. Check its public Response shape below.
  }

  if (!hasPlatformSlots && Object.prototype.toString.call(value) !== "[object Response]") {
    return false;
  }
  if (!FOREIGN_RESPONSE_FIELDS.every((field) => field in value)) return false;

  // EVERY structural verdict comes first, and the identity reads come after.
  //
  // The reads below RECORD what they read, permanently and per value, so that
  // the status which selects the error class is the same one that reaches
  // `error.status`, `error.message`, and `toJSON()`. Recording before the
  // verdict meant recording for a value this function then REFUSED: an
  // injected implementation could resolve a response-shaped object missing
  // `json`, take the NetworkError it earned, and — having had `status: 200`
  // filed against that object — later present the same object, now complete
  // and reporting `404`, and be answered with the recorded 200. The success
  // branch validates the RECORDED scalars, so it could not catch it either.
  //
  // The rule the recording implements is "the first successful read fixes A
  // RESPONSE's identity". A value that is not a response has no identity to
  // fix, so nothing may be filed against it.
  if (!hasCallableMethods(value, FOREIGN_RESPONSE_METHODS)) return false;
  if (!hasCompatibleForeignBody(value)) return false;
  // `bodyUsed` drives body ownership on both success and error paths. Let its
  // getter's own exception reach the envelope instead of replacing that cause
  // with the generic incompatible-Response error.
  if (typeof Reflect.get(value, "bodyUsed", value) !== "boolean") return false;

  // `headers` is part of HTTP error identity. Read it through the same cache the
  // constructor uses, so validation cannot consume the first answer and then
  // build the error from a second one. An HTTP error deliberately accepts every
  // HeadersInit the Headers constructor accepts; the success-surface check later
  // requires the iterable Headers operations. Let the getter's own exception
  // escape to the envelope instead of hiding the real cause.
  //
  // Each of these reads is ALSO a refusal point — a throwing getter is how
  // H-13 refuses a value — so they are STAGED. Ordering them alone cannot fix
  // this: whichever runs first is filed before the second can refuse, and the
  // refused value keeps it. Reading `headers` first and `status` last only
  // moved which field was stranded, and a stranded `headers` is not harmless:
  // `hasCompatibleSuccessSurface` reads through this same cache, so the stale
  // copy from a refused call let a value escape as a typed success whose
  // `headers` had no `get`.
  //
  // The rollback drops only what this call recorded, so a field fixed by an
  // earlier ACCEPTED call is still that response's identity.
  const rollback = stageIdentity(value as Response);
  try {
    headersOf(value as Response);
    statusOf(value as Response);
  } catch (cause) {
    rollback();
    // Let the getter's own exception escape to the envelope instead of hiding
    // the real cause behind the generic incompatible-Response error.
    throw cause;
  }

  validatedResponseStructures.add(value);
  return true;
}

/** What a resolved value is. Exactly one of three things. */
export type ResponseVerdict =
  | {
      /** The value satisfies the whole contract. It is returned unmodified. */
      readonly kind: "success";
      readonly response: Response;
    }
  | {
      /** The value reported a status of 400 or more. */
      readonly kind: "http";
      readonly error: ClientErrors | ServerErrors | UnknownHttpError;
    }
  | {
      /** The value is not a usable response. Its body is already released. */
      readonly kind: "refused";
      readonly cause: unknown;
    };

/**
 * Decide what the transport's resolved value is.
 *
 * @param value - Whatever the transport resolved. Untrusted: it may be a
 *   primitive, a partial polyfill, a foreign `Response`, or an object whose
 *   every read throws.
 * @returns The verdict. Never throws.
 */
export function classifyResolvedValue(value: unknown): ResponseVerdict {
  // The first successful `status` read is recorded per response by `statusOf`.
  // The constructor and `UnknownHttpError` reuse that value, so the status that
  // selects the class also reaches `error.status`, `error.message`, and
  // `toJSON()`. A getter that throws can be retried. A successful getter cannot
  // later select a different class.
  // STAGED across the WHOLE structural verdict, not only across `isResponse`.
  //
  // ADR 0003 row H-14 — "A value refused once has no identity filed against it"
  // — is a statement about refusal, and `isResponse` is not the last place this
  // library refuses. `hasCompatibleSuccessSurface` reads `ok`, `redirected`,
  // and `type` WITHOUT the identity cache, so they are the only three reads
  // here a value can answer differently on a second presentation — while
  // `status`, `statusText`, `url`, and `headers` stay filed from the call that
  // was refused. A double refused on `type` and re-presented as an honest 404
  // was then answered with the FILED status: a success for a failed request,
  // which is the one outcome the envelope exists to prevent.
  //
  // Every refusal rolls back, including the one inside the error constructor.
  // What does NOT roll back is an ACCEPTANCE: those records are the accepted
  // response's identity, and `typed-fetch.spec.ts` pins that a later read
  // cannot change them.
  //
  // The flag starts TRUE, and only the two acceptances clear it. Marking each
  // refusal instead was the same class of defect one layer down: a refusal
  // point that RETURNS `false` was marked, and a read inside
  // `hasCompatibleSuccessSurface` that THROWS was not, so it kept its records
  // and a 404 came back as a success. Written this way, a refusal added later
  // is covered by omission and only an acceptance has to be remembered.
  const rollbackRefusal = stageIdentity(value as Response);
  let refusedTheValue = true;
  try {
    if (!isResponse(value)) {
      throw new TypeError("The fetch implementation resolved a value that is not a Response.");
    }
    const status = statusOf(value);
    if (status >= 400) {
      const ErrorClass = statusCodeErrorMap.get(status);
      // The CONSTRUCTION is a refusal point too. `new Headers(identity.headers)`
      // refuses a recorded value that was readable but is not a valid
      // `HeadersInit` — `[["a"]]` reads fine and throws there — and the caller
      // gets a `NetworkError`. Without the rollback the bad `headers` and the
      // `status` beside it stayed filed, so the same object presented later as
      // a healthy 200 with real `Headers` was answered with that same
      // `NetworkError` for as long as it lived.
      const error = ErrorClass ? new ErrorClass(value) : new UnknownHttpError(value);
      refusedTheValue = false;
      return { kind: "http", error };
    }
    if (!hasCompatibleSuccessSurface(value)) {
      throw new TypeError(
        "The fetch implementation resolved a Response with an incompatible public surface.",
      );
    }
    refusedTheValue = false;
    // The success path releases nothing. This value IS the returned response,
    // and the caller owns its body.
    return { kind: "success", response: value };
  } catch (cause) {
    // UNREACHABLE else: `refusedTheValue` starts true and is cleared on the two
    // lines that immediately precede an exit from the `try`, with nothing
    // between the clear and the exit that can throw. This catch is only ever
    // entered while the flag is still true. The `if` stays because the flag's
    // whole design is that a refusal path added LATER is covered by omission.
    /* v8 ignore start */
    if (refusedTheValue) rollbackRefusal();
    /* v8 ignore stop */
    // The reads above (`status`, and `statusText`, `url`, and `headers` inside
    // the error class) can each throw for an injected implementation. The
    // caller gets `response: null` and never gets a handle to the body the
    // network already opened. Release it here, or it stays open with no owner.
    try {
      releaseResponseBody(value as Response);
    } catch {
      // A response too broken to release must not replace the real cause with
      // the release failure.
    }
    return { kind: "refused", cause };
  }
}
