import { ClientErrors, ServerErrors, TypedFetchError } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import type { NetworkError } from "./errors/network-error";
import type { AbortedError } from "./errors/aborted-error";
import type { TimeoutError } from "./errors/timeout-error";
import { UnknownHttpError } from "./errors/unknown-http-error";
import {
  abortedErrorBrand,
  hasBrand,
  httpErrorBrand,
  knownHttpErrorBrand,
  networkErrorBrand,
  timeoutErrorBrand,
} from "./errors/brand";
import { TypedHeaders } from "./headers";
import { HttpMethods } from "./methods";
import { classifyRequestFailure, networkFailure } from "./request-failure";
import {
  hasTypedResponseIdentityScalars,
  headersOf,
  stageIdentity,
  statusOf,
  textOf,
} from "./errors/response-identity";
import { releaseResponseBody } from "./errors/error-body";

/**
 * The `[object Request]` tag, for iframe, node:vm, and duplicated-runtime
 * inputs that no realm-bound check can recognize.
 *
 * Read exactly ONCE per call, by {@link classifyRequestInput}. It is the
 * input's own `Symbol.toStringTag`, so every extra read is another chance for
 * the input to answer differently — ADR 0003 row H-26.
 */
function hasRequestTag(value: unknown): boolean {
  try {
    return Object.prototype.toString.call(value) === "[object Request]";
  } catch {
    return false;
  }
}

/**
 * A `Request` the AMBIENT `fetch` will take as a request rather than convert.
 *
 * `RequestInfo` is a WebIDL union, and the platform resolves it with its OWN
 * brand check — realm-bound, exactly like `instanceof`. Everything the check
 * refuses becomes a `USVString`, which calls the value's own `toString`.
 * {@link hasRequestTag} is deliberately wider: a tag is enough for it. The gap
 * between the two is where the setup phase used to send the request to one URL
 * and file the error against another.
 */
function isPlatformRequest(value: unknown): value is Request {
  try {
    return typeof Request !== "undefined" && value instanceof Request;
  } catch {
    return false;
  }
}

/**
 * Will the transport that is about to run take this input as a request?
 *
 * The ambient `fetch` answers with {@link isPlatformRequest}. A custom one
 * writes its own rule this module cannot read, so it keeps the wider tag check
 * — which is also what a duplicated runtime needs, since only the caller can
 * pair its `Request` with the copy of `fetch` that shipped with it.
 */
function transportTakesRequest(input: RequestInputFacts, customTransport: boolean): boolean {
  return customTransport ? input.taggedRequest : input.platformRequest;
}

/**
 * The members a foreign `Response` must expose to be accepted.
 *
 * The success branch returns this value as {@link TypedResponse}, so validation
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
// `getSetCookie` is here because {@link TypedResponse} PROMISES it: the success
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

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

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
  if (!validatedResponseStructures.has(response)) return false;
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
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }

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

/**
 * Type guard that checks whether a value is an HTTP error (any {@link BaseHttpError} subclass).
 *
 * Keyed on a cross-copy brand rather than `instanceof`, so it returns `true`
 * even when the error was created by a *different copy* of the library — a
 * different entry point (`.` vs `./errors`) or a different module format
 * (ESM vs CJS). Always prefer this over `error instanceof BaseHttpError`,
 * which only holds within a single copy.
 *
 * @example
 * ```ts
 * import { isHttpError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isHttpError(error)) {
 *   console.log(error.status, error.statusText);
 *   // This example does not read the body, so it must cancel the body.
 *   await error.cancel();
 * }
 * ```
 */
export function isHttpError(error: unknown): error is BaseHttpError {
  return hasBrand(error, httpErrorBrand);
}

/**
 * Type guard that checks whether a value is a {@link NetworkError}.
 *
 * Keyed on a cross-copy brand — works across entry points and module formats.
 *
 * @example
 * ```ts
 * import { isNetworkError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isNetworkError(error)) {
 *   console.log("Connection failed:", error.message);
 * }
 * ```
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return hasBrand(error, networkErrorBrand);
}

/**
 * Type guard that checks whether a value is an {@link AbortedError}.
 *
 * Keyed on a cross-copy brand — works across entry points and module formats.
 *
 * Note: `AbortedError` does NOT extend `NetworkError` — {@link isNetworkError}
 * returns `false` for aborted requests. Use this guard instead.
 *
 * @example
 * ```ts
 * import { isAbortError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isAbortError(error)) {
 *   console.log("Request was aborted");
 * }
 * ```
 */
export function isAbortError(error: unknown): error is AbortedError {
  return hasBrand(error, abortedErrorBrand);
}

/**
 * Type guard that checks whether a value is a {@link TimeoutError}.
 *
 * Keyed on a cross-copy brand — works across entry points and module formats.
 *
 * Note: `TimeoutError` does NOT extend `NetworkError` — {@link isNetworkError}
 * returns `false` for timed-out requests. Use this guard instead.
 *
 * @example
 * ```ts
 * import { isTimeoutError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isTimeoutError(error)) {
 *   console.log("Request timed out");
 * }
 * ```
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return hasBrand(error, timeoutErrorBrand);
}

/**
 * Type guard for a *known*, dedicated HTTP error class (excludes {@link UnknownHttpError}).
 *
 * Keyed on cross-copy brands and restricted to the status map in this package
 * version — works across entry points and module formats without accepting a
 * dedicated status introduced by a newer copy. Narrowing on `error.status`
 * after this guard is exhaustive over this version's mapped codes, and is the
 * way to reach a specific subclass that works across package copies (a raw
 * `error instanceof NotFoundError` is NOT reliable across copies).
 *
 * @example
 * ```ts
 * import { isKnownHttpError } from "@pbpeterson/typed-fetch";
 *
 * declare const error: unknown;
 * if (isKnownHttpError(error)) {
 *   switch (error.status) {
 *     case 404:
 *       // error: NotFoundError
 *       break;
 *     default:
 *       // Keep a default for forward compatibility and mixed package versions.
 *       break;
 *   }
 *   // No branch reads the body, so cancel the body once after the switch.
 *   await error.cancel();
 * }
 * ```
 */
export function isKnownHttpError(error: unknown): error is ClientErrors | ServerErrors {
  if (!hasBrand(error, httpErrorBrand) || !hasBrand(error, knownHttpErrorBrand)) {
    return false;
  }

  try {
    const status = (error as { readonly status?: unknown }).status;
    return typeof status === "number" && statusCodeErrorMap.has(status);
  } catch {
    // Hostile proxies/getters are not valid library errors.
    return false;
  }
}

/**
 * The stable Fetch response baseline returned by {@link typedFetch}.
 *
 * `body` and `headers` are the AMBIENT platform types, so the success value
 * reaches a platform API without a cast: `new Response(r.body, { headers:
 * r.headers })` is the forwarding idiom every proxy writes, and it used to need
 * two. They were a `Pick` of the members {@link isResponse} validates, and that
 * narrowing bought nothing it cost: `body.tee()` and `body.pipeThrough()` are
 * typed with the full `ReadableStream`, so the exact members `body` refused to
 * promise came straight back one call later. Naming the ambient type also
 * defers to the CONSUMER's own lib configuration, which is the same authority
 * that types a plain `fetch` call in their project — `for await` over a body
 * compiles under `@types/node` and does not under `lib.dom`, which is correct
 * in both cases.
 *
 * This interface is still not `Response`, and that omission is load-bearing:
 * `Response.bytes()` is absent at the package floor, Node 20.13.0, so promising
 * it would hand a consumer a method that does not exist there. Forwarding the
 * value itself to a `(r: Response)` slot therefore still needs a cast. Widening
 * that far is a floor decision, not a typing one.
 *
 * `Headers.getSetCookie()` is now promised and therefore now VALIDATED — see
 * {@link FOREIGN_RESPONSE_HEADERS_METHODS}. A standards-compatible polyfill
 * without it is refused on the success path, where before it was accepted and
 * the type stayed quiet about the gap. The method has been on
 * `Headers.prototype` since Node 20.0.0, and in Chrome 113, Safari 17, and
 * Firefox 112.
 *
 * `BaseHttpError.headers` is typed `Headers` for a different reason: an error's
 * headers are CONSTRUCTED here rather than handed through.
 *
 * The runtime value remains the Fetch implementation's original, unmodified
 * response and can expose newer members. {@link json} provides a compile-time
 * type only; it does not validate the payload. Body readers retain native
 * behavior and may reject for malformed or consumed data.
 */
export interface TypedResponse<JsonReturnType> {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyUsed: boolean;
  readonly headers: Headers;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";
  readonly url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  formData(): Promise<FormData>;
  /** Parse JSON with an unchecked compile-time result type; native body-read errors still reject. */
  json(): Promise<JsonReturnType>;
  text(): Promise<string>;
  /** Clone the response while preserving the typed {@link json} method. */
  clone(): TypedResponse<JsonReturnType>;
}

/**
 * The discriminated union returned by {@link typedFetch}.
 *
 * `readonly` on both arms, for the reason every member of
 * {@link TypedResponse} is: the envelope carries the DISCRIMINANT, so a write
 * falsifies the type system's own evidence. Normalizing a 404 into an empty
 * result is a plausible thing to write, and it used to typecheck clean:
 *
 * ```ts no-check
 * if (isKnownHttpError(r.error) && r.error.status === 404) {
 *   await r.error.cancel();
 *   r.error = null;
 * }
 * if (r.error) throw r.error;
 * return r.response.json(); // `response` is still null
 * ```
 *
 * The narrowing is sound only while the value is not rewritten in place. Build
 * a new value instead.
 */
export type TypedFetchReturnType<JsonReturnType> =
  | {
      readonly response: TypedResponse<JsonReturnType>;
      readonly error: null;
    }
  | {
      readonly response: null;
      readonly error: TypedFetchError;
    };

type FetchParams = Parameters<typeof fetch>;

type FetchInput = FetchParams[0];

function snapshotRequestInit(
  options: TypedFetchOptions,
  signal: AbortSignal | null | undefined,
  removeFetchOverride: boolean,
): RequestInit {
  if (!removeFetchOverride) {
    // No extension must be hidden, so the original object can remain the proxy
    // target. This preserves reflection and avoids inspecting every descriptor
    // on a potentially exotic RequestInit.
    return new Proxy(options, {
      get(target, property) {
        if (property === "signal") return signal;
        return Reflect.get(target, property, target);
      },
    });
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  delete descriptors.fetch;

  // A WebIDL dictionary is normally read by the transport. `typedFetch` also
  // needs the signal to classify a rejection, so letting the getter run once
  // here and again inside fetch can produce two different authorities. The
  // `get` trap below answers every `signal` read with the captured value; this
  // descriptor is what makes that legal, because a proxy may not report a value
  // other than the one a non-configurable own property of its target holds.
  //
  // Only when the caller actually HAS the slot. Writing it unconditionally
  // invented an own key: `Object.keys(init)` and `Reflect.ownKeys(init)` listed
  // `signal` while `"signal" in init` — answered from the original object by
  // the `has` trap — said `false`, and `{ ...init }` grew a `signal: undefined`
  // member the caller never wrote. An implementation is entitled to reflect
  // over its init, and the suite already treats that as legitimate. An
  // INHERITED signal needs no entry either: the sanitized target keeps the
  // original prototype, and a proxy invariant only constrains the target's own
  // properties.
  if (descriptors.signal) {
    descriptors.signal = {
      value: signal,
      writable: true,
      enumerable: descriptors.signal.enumerable,
      configurable: true,
    };
  }
  const sanitizedTarget = Object.create(Object.getPrototypeOf(options), descriptors) as RequestInit;

  // The proxy target exposes the same descriptors/prototype for reflection but
  // omits the extension. Ordinary reads delegate to the original object with
  // the original receiver: prototype getters backed by WebIDL internal slots or
  // JavaScript private fields would reject a descriptor-only clone because that
  // clone does not carry those slots. `signal` is the one snapshotted
  // exception, and `headers` deliberately is NOT one: the transport is the only
  // reader of that slot, so its getter runs exactly once, as it does under a
  // bare `fetch`.
  return new Proxy(sanitizedTarget, {
    get(_target, property) {
      if (property === "signal") return signal;
      if (property === "fetch") return undefined;
      return Reflect.get(options, property, options);
    },
    has(_target, property) {
      return property === "fetch" ? false : Reflect.has(options, property);
    },
  });
}

/**
 * The value handed to the transport, and the URL string that describes it.
 *
 * ONE serialization, and that is the point. `FetchInput` is
 * `string | URL | Request`, and the transport performs a `USVString` conversion
 * on everything that is not a `Request` — which calls the input's own
 * `toString`. Resolving `error.url` afterwards called it a SECOND time, and the
 * second answer is the input's to choose: a `toString` with state sent the
 * request to one URL and filed the error against another, and the URL redactor
 * then searched the platform's message for a string it never contained.
 *
 * So the string is produced here, once, and the transport receives that exact
 * string. A `Request` is the exception and is handed over unchanged: it carries
 * a body, a signal, and internal slots that no string can stand for. Its `url`
 * is already the resolved absolute URL.
 *
 * WHICH values count as that exception is the transport's rule, not this
 * module's. The ambient `fetch` resolves `RequestInfo` with its own realm-bound
 * brand check and converts everything else to a `USVString`, so passing a
 * merely Request-TAGGED value through did not stop it from being serialized —
 * it only moved the serialization to a place that reports nothing back.
 * `node-fetch@2` tags its `Request` and stringifies to `"[object Request]"`, so
 * an ordinary consumer, with nothing hostile anywhere, got a `NetworkError`
 * whose `url` named a server the request never reached. See
 * {@link isPlatformRequest}.
 *
 * A CUSTOM transport writes its own rule and this module cannot read it, so an
 * override keeps the wider tag check. That is also what a duplicated runtime
 * needs: its `Request` is a real one to the copy of `fetch` that shipped with
 * it, and only the caller can pair the two.
 *
 * The verdict is RETURNED, not recomputed. `transportTakesRequest` reads the
 * input's own `Symbol.toStringTag` — a caller-controlled read — and this
 * function's answer decides what the transport receives, while the caller's
 * second call decided which signal governs the call. Two reads, one input, and
 * the input chooses each answer separately: a transport handed a bare URL
 * string that no signal governs, and a classifier trusting a signal taken from
 * an input the transport never saw. `classifyRequestFailure` then reported a
 * network failure as an abort, and a consumer's retry policy reads that class.
 * ADR 0003, row H-26: a request input read twice cannot split the request from
 * the error.
 *
 * Two failure directions, handled differently on purpose.
 * `String(input)` throws for a `Symbol` and for a hostile `toString`, and that
 * exception is NOT swallowed: the request cannot be made, and the setup phase
 * turns it into a `NetworkError` with an empty `url`. A `Request`'s `url` is the
 * other direction: the tag check accepts anything tagged `[object Request]`, and
 * a subclass can override the getter, so it can answer with a number or an
 * object without throwing at all. That value is dropped rather than coerced,
 * which is what keeps `NetworkError.url` — typed `readonly string` — from
 * holding a non-string that then flows into `redactUrl` and into the `toJSON()`
 * record.
 *
 * Everything here reads the INPUT and nothing reads `options`, which is what
 * lets phase 1 run it first. `error.url` is the only thing that tells two
 * concurrent failures apart, and it used to be lost whenever a read of
 * `options` threw before the input had been resolved — including for
 * `typedFetch(url, null)`, an ordinary consumer slip that reaches
 * `Object.hasOwn(null, …)`.
 */
interface RequestInputFacts {
  /** The ambient `fetch` will take this as a request, not convert it. */
  readonly platformRequest: boolean;
  /** Some transport might: it is a platform `Request` or carries the tag. */
  readonly taggedRequest: boolean;
  /** A tagged input's own `url`, already absolute. `""` for everything else. */
  readonly requestUrl: string;
}

function classifyRequestInput(input: FetchInput): RequestInputFacts {
  const platformRequest = isPlatformRequest(input);
  const taggedRequest = platformRequest || hasRequestTag(input);
  if (!taggedRequest) return { platformRequest, taggedRequest, requestUrl: "" };

  let raw: unknown;
  try {
    raw = (input as Request).url;
  } catch {
    // A hostile `url` getter is not a reason to refuse a Request the transport
    // may still be able to send.
    raw = undefined;
  }
  return { platformRequest, taggedRequest, requestUrl: textOf(raw) };
}

/**
 * The options the ambient `fetch` accepts, minus the two slots this library
 * retypes.
 *
 * The slots are REMOVED and replaced, never intersected. An intersection makes
 * both types apply, and for `method` that erases the whole point: the platform
 * types it `string`, and `string & (HttpMethods | (string & {}))` reduces to
 * plain `string`, so `method: "…"` offered ZERO completions while the README
 * promised them. For `headers` the intersection dragged the PLATFORM's declared
 * header names into the suggestion list — under `@types/node` without DOM that
 * is undici's `HeaderRecord`, which reintroduced every response-only name this
 * library deliberately dropped (`Set-Cookie`, `ETag`) plus the three the
 * platform owns (`Content-Length`, `Host`, `Connection`).
 *
 * Derived from `fetch`'s own signature rather than written as
 * `Omit<RequestInit, …>`, for the same reason `NativeFetchHeaders` exists in
 * `src/headers.ts`: a `lib.dom` type name in the published declarations breaks
 * a Node consumer without DOM. `Omit` keeps every other member, including the
 * ones only one platform declares (`duplex`, `dispatcher`, `priority`,
 * `window`).
 */
type NativeRequestOptions = Omit<NonNullable<FetchParams[1]>, "headers" | "method">;

/** Request options accepted by {@link typedFetch} — `RequestInit` with typed `headers` and `method`. */
export type TypedFetchOptions = NativeRequestOptions & {
  headers?: TypedHeaders;
  // fetch accepts any method string (and normalizes case); the union only
  // drives IntelliSense.
  method?: HttpMethods | (string & {});
  /** Override the fetch implementation (testing, DI, custom agents). */
  fetch?: typeof fetch | undefined;
};

/**
 * Type-safe wrapper around the native `fetch` API that resolves network, HTTP,
 * abort, and timeout request failures as error values instead of rejecting.
 * Body readers on the returned response are separate native operations and
 * may still reject for malformed/empty data or a consumed body.
 *
 * @typeParam JsonReturnType - Expected response body type on success. This is
 *   a compile-time type only and does not perform runtime validation.
 *
 * @param url - The resource URL, same as `fetch()`.
 * @param options - Request options with typed `headers` and `method`.
 * @returns A discriminated union: `{ response, error: null }` on success,
 *   `{ response: null, error }` on failure. `error` is the full
 *   {@link TypedFetchError} union — narrow it with {@link isKnownHttpError}
 *   and `switch (error.status)`. Raw `instanceof` is only reliable when the
 *   producer and consumer share one loaded package copy; use the brand-based guards
 *   across duplicate package copies or ESM/CJS boundaries.
 *
 * @example
 * ```ts
 * import { typedFetch, isHttpError } from "@pbpeterson/typed-fetch";
 *
 * interface User {
 *   id: number;
 * }
 *
 * const { response, error } = await typedFetch<User>("https://api.example.com/users/1");
 * if (error) {
 *   console.log(error.name);
 *   // An HTTP error carries a body. This example does not read it, so it
 *   // cancels it. An unread body keeps its connection open.
 *   if (isHttpError(error)) await error.cancel();
 * } else {
 *   const user = await response.json();
 * }
 * ```
 */
export async function typedFetch<JsonReturnType>(
  url: FetchInput,
  options: TypedFetchOptions = {},
): Promise<TypedFetchReturnType<JsonReturnType>> {
  // THREE PHASES, THREE CATCHES. Every one of them resolves as an error VALUE,
  // and each one names the failures it can produce:
  //
  //  1. SETUP — reading the caller's options and building the init. Always a
  //     NetworkError.
  //  2. TRANSPORT — the awaited `fetch` call. The ONLY phase that can produce
  //     an AbortedError or a TimeoutError, because it is the only phase whose
  //     failure the governing signal can have caused.
  //  3. RESPONSE — inspecting and classifying the resolved value, and releasing
  //     its body when that fails. Always a NetworkError.
  //
  // One `try` around all three could not state that. A hostile getter in phase
  // 1 or phase 3 can abort the signal and then throw an abort-shaped exception,
  // and the classifier — which trusts the signal by design — answered with an
  // AbortedError for a failure the abort never caused. A consumer's retry
  // policy reads that class.
  let signal: AbortSignal | undefined;
  let fetchImpl: typeof fetch;
  let init: RequestInit;
  let transportInput: FetchInput;
  // The requested URL, so pre-response errors (which hold no `Response`) are
  // still distinguishable in logs — the correlation `BaseHttpError.url` already
  // gives HTTP errors. It stays the empty string when the input cannot be
  // serialized at all, which is the only state the three catches below can find
  // it in without a resolution having succeeded.
  let resolvedRequestUrl = "";

  // ── Phase 1: setup ──────────────────────────────────────────────────────
  try {
    // The INPUT first, and from the input alone. Nothing here reads `options`,
    // so `error.url` is already filed when the reads below run — and one of
    // them can throw before the request is ever described. `typedFetch(url,
    // null)` is the ordinary case: `Object.hasOwn(null, …)` throws, and the
    // correlation between a log line and a request went with it.
    const input = classifyRequestInput(url);
    // No transport takes an untagged input as a request, so the verdict below
    // cannot change it and it can be serialized now, before anything reads
    // `options`. A tagged one files its own `url` for the same reason.
    let serialized: string | null = null;
    if (input.taggedRequest) {
      resolvedRequestUrl = input.requestUrl;
    } else {
      serialized = String(url);
      resolvedRequestUrl = serialized;
    }

    // OWN property only. `fetch` is this library's own extension, not a WebIDL
    // dictionary member, and reading it off the prototype chain turns a single
    // `Object.prototype.fetch = ...` write anywhere in the process into a
    // redirect of every request — including a `typedFetch(url)` call that
    // passes no options object at all, whose default `{}` inherits it. The
    // whole transport, with the caller's credentials, is not a field a
    // polluted prototype gets to choose. The read below is guarded by the same
    // predicate, so an inherited `fetch` is neither used NOR stripped: it stays
    // on the object and the platform ignores it, because WebIDL reads only the
    // members it declares.
    const hasFetchOverride = Object.hasOwn(options, "fetch");
    const overrideFetch = hasFetchOverride ? options.fetch : undefined;
    fetchImpl = overrideFetch ?? fetch;

    // TWO different questions, and collapsing them reopened ADR 0003 row H-26.
    // `hasFetchOverride` answers "must the init hide this library's extension?"
    // — an own key is there to be stripped whatever its value. Which transport
    // RUNS is a separate fact: `fetch: undefined` is allowed by the public type
    // and is the natural output of `{ fetch: maybeOverride }` or of a spread of
    // defaults, and it leaves the AMBIENT transport in place. Asking the own
    // key meant using the wide tag check against the one transport that takes
    // only its own brand, so the request went to `String(input)` while the
    // error named `input.url` — a server nothing touched.
    const customTransport = typeof overrideFetch === "function";

    // Only a tagged input is still undecided: whether the transport takes it as
    // a request, or serializes it the way the platform serializes everything it
    // does not recognize. `??=` is what keeps the serialization at ONE call,
    // which is the whole reason this module resolves the input itself.
    let requestInput: Request | null = null;
    if (input.taggedRequest && transportTakesRequest(input, customTransport)) {
      transportInput = url;
      requestInput = url as Request;
    } else {
      serialized ??= String(url);
      transportInput = serialized;
      resolvedRequestUrl = serialized;
    }

    // The AbortSignal can arrive via EITHER slot: the `options`/`init` (its
    // `.signal`), OR a `Request` passed as the first argument (`url.signal`).
    // `signal: null` detaches the Request's signal; absent/undefined falls back.
    //
    // Read ONCE, into a local, for the same reason `statusOf` records the status
    // it read: `init` can be an injected object whose `signal` getter answers
    // differently on a second read. This binding is the authority
    // `classifyRequestFailure` consults, so a second read that answered
    // `undefined` would classify a real abort as a `NetworkError` and a timeout
    // as neither.
    //
    // WHICH input is a Request is the verdict phase 1 already reached, never a
    // second `isRequest` call. The read behind it is the input's own
    // `Symbol.toStringTag`, so a second call is a second chance for the input
    // to answer differently — and the two answers govern different things: one
    // picks what the transport receives, this one picks the signal
    // `classifyRequestFailure` treats as authoritative. When they disagreed, a
    // plain network failure was reported as an abort.
    const initSignal = options.signal;
    signal =
      initSignal !== undefined ? (initSignal ?? undefined) : (requestInput?.signal ?? undefined);

    // Fetch reads RequestInit as a WebIDL dictionary, so inherited properties
    // and prototype getters are part of the input. Preserve both while removing
    // this library's `fetch` extension and materializing the signal snapshot.
    // An object spread would silently drop inherited method, headers, body, or
    // signal values.
    //
    // The `headers` slot is NOT snapshotted. It was, so that the failure path
    // could read the caller's header parts a second time and strike them out of
    // the platform's message; the message is library-authored now, so the
    // transport is the only reader of that slot and its getter runs exactly
    // once, as it does under a bare `fetch`.
    init = snapshotRequestInit(options, initSignal, hasFetchOverride);
  } catch (cause) {
    // A `fetch`, `signal`, or descriptor read that throws. No request left this
    // process, so no signal can have caused it.
    return { response: null, error: networkFailure(cause, resolvedRequestUrl) };
  }

  // ── Phase 2: transport ──────────────────────────────────────────────────
  let res: Response;
  try {
    res = await fetchImpl(transportInput, init);
  } catch (cause) {
    // NOTHING runs between the rejection and the classification. The URL was
    // resolved in phase 1, so no caller code can move the abort state that
    // decides which failure this is.
    //
    // `signal` is read from the OUTER binding and never re-derived from
    // `options` here: it was resolved in phase 1, and reading it again would
    // run a getter that can throw.
    //
    // Which failure this is — timeout, abort, or network — is decided by
    // `classifyRequestFailure`. The governing signal is the authority there,
    // never the rejection's `.name`.
    return {
      response: null,
      error: classifyRequestFailure(cause, signal, resolvedRequestUrl),
    };
  }

  // ── Phase 3: response ───────────────────────────────────────────────────
  // Inside the envelope on purpose. `fetchImpl` can be an injected
  // implementation, so the resolved value is untrusted input. A non-Response
  // or a hostile identity getter must surface as an error VALUE instead of
  // rejecting or escaping through the typed success branch.
  //
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
  // and `type` WITHOUT the identity cache, so they are the only three reads in
  // this phase a value can answer differently on a second presentation — while
  // `status`, `statusText`, `url`, and `headers` stay filed from the call that
  // was refused. A double refused on `type` and re-presented as an honest 404
  // was then answered with the FILED status: `{ response, error: null }` for a
  // failed request, which is the one outcome this union exists to prevent.
  //
  // Only the two STRUCTURAL refusals roll back. The HTTP-error path deliberately
  // does not: a throwing getter inside an error constructor keeps the fields
  // that were read successfully, which `typed-fetch.spec.ts` pins.
  const rollbackRefusal = stageIdentity(res as Response);
  let refusedTheValue = false;
  try {
    if (!isResponse(res)) {
      refusedTheValue = true;
      throw new TypeError("The fetch implementation resolved a value that is not a Response.");
    }
    const status = statusOf(res);
    if (status >= 400) {
      const ErrorClass = statusCodeErrorMap.get(status);
      return {
        response: null,
        error: ErrorClass ? new ErrorClass(res) : new UnknownHttpError(res),
      };
    }
    if (!hasCompatibleSuccessSurface(res)) {
      refusedTheValue = true;
      throw new TypeError(
        "The fetch implementation resolved a Response with an incompatible public surface.",
      );
    }
  } catch (cause) {
    if (refusedTheValue) rollbackRefusal();
    // The reads above (`status`, and `statusText`, `url`, and `headers` inside
    // the error class) can each throw for an injected implementation. The
    // caller gets `response: null` and never gets a handle to the body the
    // network already opened. Release it here, or it stays open with no owner.
    try {
      releaseResponseBody(res);
    } catch {
      // A response too broken to release must not replace the real cause with
      // the release failure.
    }
    return { response: null, error: networkFailure(cause, resolvedRequestUrl) };
  }

  // The success path releases nothing. `res` IS the returned response, and the
  // caller owns its body.
  return {
    response: res as TypedResponse<JsonReturnType>,
    error: null,
  };
}
