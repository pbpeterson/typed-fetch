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
import { classifyRequestFailure } from "./request-failure";
import {
  hasTypedResponseIdentityScalars,
  headersOf,
  stageIdentity,
  statusOf,
} from "./errors/response-identity";
import { releaseResponseBody } from "./errors/error-body";

/** Realm-safe Request detection for iframe, node:vm, and duplicated-runtime inputs. */
function isRequest(value: unknown): value is Request {
  try {
    return (
      (typeof Request !== "undefined" && value instanceof Request) ||
      Object.prototype.toString.call(value) === "[object Request]"
    );
  } catch {
    return false;
  }
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
const FOREIGN_RESPONSE_HEADERS_METHODS = [
  "append",
  "delete",
  "entries",
  "forEach",
  "get",
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

type TypedResponseHeaders = Pick<
  Headers,
  (typeof FOREIGN_RESPONSE_HEADERS_METHODS)[number] | typeof Symbol.iterator
>;

type TypedResponseBody = Pick<
  ReadableStream<Uint8Array>,
  "locked" | (typeof FOREIGN_RESPONSE_BODY_METHODS)[number]
>;

/**
 * The stable Fetch response baseline returned by {@link typedFetch}.
 *
 * This interface deliberately names the surface supported by every runtime at
 * the package floor. It does not inherit additions from the TypeScript version
 * that builds the package, such as `Response.bytes()` or
 * `Headers.getSetCookie()`, because Node 20.0 does not provide those additions.
 *
 * The runtime value remains the Fetch implementation's original, unmodified
 * response and can expose newer members. {@link json} provides a compile-time
 * type only; it does not validate the payload. Body readers retain native
 * behavior and may reject for malformed or consumed data.
 */
export interface TypedResponse<JsonReturnType> {
  readonly body: TypedResponseBody | null;
  readonly bodyUsed: boolean;
  readonly headers: TypedResponseHeaders;
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

/** The discriminated union returned by {@link typedFetch}. */
export type TypedFetchReturnType<JsonReturnType> =
  | {
      response: TypedResponse<JsonReturnType>;
      error: null;
    }
  | {
      response: null;
      error: TypedFetchError;
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
        return property === "signal" ? signal : Reflect.get(target, property, target);
      },
    });
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  delete descriptors.fetch;

  // A WebIDL dictionary is normally read by the transport. `typedFetch` also
  // needs the signal to classify a rejection, so letting the getter run once
  // here and again inside fetch can produce two different authorities. Shadow
  // an own or inherited signal with the captured value on the proxy target.
  descriptors.signal = {
    value: signal,
    writable: true,
    enumerable: descriptors.signal?.enumerable ?? true,
    configurable: true,
  };
  const sanitizedTarget = Object.create(Object.getPrototypeOf(options), descriptors) as RequestInit;

  // The proxy target exposes the same descriptors/prototype for reflection but
  // can omit the extension. Ordinary reads delegate to the original object with
  // the original receiver: prototype getters backed by WebIDL internal slots or
  // JavaScript private fields would reject a descriptor-only clone because that
  // clone does not carry those slots. `signal` is the one snapshotted exception.
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
 * The requested URL as a string, or the empty string when none can be resolved.
 *
 * Total by construction, and total in BOTH directions a request input can fail.
 * `String(input)` throws for a `Symbol` and for a hostile `toString`, which the
 * `catch` covers. A `Request`'s `url` is the other half: `isRequest` accepts
 * anything tagged `[object Request]`, and a subclass can override the getter, so
 * `input.url` can answer with a number, an object, or a `Symbol` without
 * throwing at all. Normalizing it here is what keeps `NetworkError.url` — typed
 * `readonly string` — from holding a non-string that then flows into
 * `redactUrl` and into the `toJSON()` record.
 *
 * The normalization is `response-identity`'s {@link textOf} rule, for the same
 * reason it exists there: `String()` cannot promise not to throw, so a value
 * that is not already a string is not coerced, it is dropped.
 */
function requestUrl(input: FetchInput): string {
  try {
    const raw: unknown = isRequest(input) ? input.url : String(input);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

/**
 * The characters the Fetch Standard forbids inside a header value.
 *
 * A value carrying one is REFUSED by the platform, and refusal is the only way
 * a header value reaches a rejection message — verified against undici, which
 * reports the refusal by quoting the value back.
 *
 * The test applies to the NORMALIZED value, never the caller's string. See
 * {@link normalizeHeaderValue}: the two differ, and testing the wrong one is
 * wrong in both directions.
 *
 * Spelled as `includes` calls rather than a character class, because a regexp
 * literal carrying a raw NUL is unreadable in a diff and in a review.
 */
function isRefusedHeaderValue(value: string): boolean {
  return value.includes("\0") || value.includes("\r") || value.includes("\n");
}

/** Leading and trailing HTTP whitespace: HT, LF, CR, SP. */
const HTTP_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/**
 * A header value as the PLATFORM sees it.
 *
 * Two conversions run before validation does, and both change the string the
 * refusal message quotes back:
 *
 *  - WebIDL converts the value to a `ByteString`, which is `String(value)`. A
 *    JavaScript caller reaches this with the `string | string[]` shape Node's
 *    `req.headers` produces.
 *  - The Fetch Standard then strips leading and trailing HTTP whitespace, and
 *    validates what is left.
 *
 * Skipping this was wrong in both directions. A padded credential —
 * `"Basic AAAA\nsk_live_…\n"`, the shape a key read from a file has — is
 * refused for the interior LF, but quoted back WITHOUT the trailing one, so a
 * search for the caller's raw string found nothing and the credential reached
 * `NetworkError.message`. And a value padded with ONLY whitespace tested as
 * refused while the platform accepts it, which put an arbitrary string on the
 * strike list for an unrelated message.
 *
 * Total: `String()` throws for a Symbol and for a hostile `toString`. A value
 * that cannot be read cannot be redacted, and the URL pass still runs.
 */
function normalizeHeaderValue(value: unknown): string | null {
  try {
    return (typeof value === "string" ? value : String(value)).replace(HTTP_WHITESPACE, "");
  } catch {
    return null;
  }
}

/**
 * The header strings the platform must refuse, collected from the caller's
 * `headers` so `classifyRequestFailure` can strike them out of the message the
 * platform hands back.
 *
 * NAMES AND VALUES BOTH. A name is refused on the same footing as a value — the
 * Fetch Standard requires a name to match the `field-name` token production —
 * and the platform quotes a refused name back exactly as it quotes a refused
 * value: `Headers.append: "X-Foo\r\nSet-Cookie: evil=1" is an invalid header
 * name.` Collecting only values left the raw CRLF in `message`, which is the
 * log-forging half of the same hazard, reached through the other member of the
 * pair. A name is not usually a credential, so this closes the injection
 * channel rather than a disclosure one — but a gateway that builds a name from
 * request data makes it both.
 *
 * The bound stays the platform's, not a heuristic: only a string carrying NUL,
 * CR, or LF is struck. A name refused merely for holding a space is echoed
 * intact, because it forges nothing and striking it would cost the diagnostic.
 *
 * Total: a hostile `headers` — a throwing getter, an exotic iterator, a Proxy —
 * cannot make the envelope reject. What cannot be read cannot be redacted, and
 * the URL pass in `NetworkError` still runs.
 *
 * BEST EFFORT, the same posture `redactUrlInMessage` states: this reads
 * `headers` once, and a getter that answers differently on the read `fetch`
 * performed leaves a value unredacted. The read happens on the failure path
 * only, so the success path pays nothing.
 */
function refusedHeaderValues(headers: unknown): readonly string[] {
  const refused: string[] = [];
  const consider = (value: unknown): void => {
    const normalized = normalizeHeaderValue(value);
    if (normalized === null || !isRefusedHeaderValue(normalized)) return;
    // BOTH forms, longest first. undici quotes the normalized value; a platform
    // that quotes the caller's string back is not ruled out, and the raw form
    // contains the normalized one, so striking it first cannot leave a tail.
    if (typeof value === "string" && value !== normalized) refused.push(value);
    refused.push(normalized);
  };
  try {
    // `isObjectLike`, not `typeof === "object"`. WebIDL converts a `HeadersInit`
    // record from ANY object, and a function is an object: a callable carrying
    // own enumerable properties is a record to the platform, and skipping it
    // left its values uncollected.
    if (!isObjectLike(headers)) return refused;
    // A `Headers` instance and an array of name/value pairs are both iterable
    // and both yield pairs. A plain record is neither, and is read by value.
    if (typeof (headers as Iterable<unknown>)[Symbol.iterator] === "function") {
      for (const entry of headers as Iterable<unknown>) {
        // ONE pass over the entry, both members out of it. Reading the name and
        // the value with two calls would exhaust a one-shot inner iterable on
        // the first and hand the second nothing.
        const [name, value] = pairMembers(entry);
        consider(name);
        consider(value);
      }
      return refused;
    }
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
      consider(name);
      consider(value);
    }
  } catch {
    // Unreadable headers are not a reason to break the envelope.
  }
  return refused;
}

/**
 * Both members of one `sequence<sequence<ByteString>>` entry — the name and the
 * value — read in a single pass.
 *
 * `Array.isArray` is not the test WebIDL applies. A `sequence` is converted
 * through the value's OWN iterator, so `[new Set([name, value])]` and
 * `[generatorOfTwoStrings()]` are both valid pair containers to the platform —
 * and reading only real arrays left their members uncollected, which put the
 * credential back in `NetworkError.message`.
 *
 * RESIDUAL, and the reason this is best effort: a ONE-SHOT iterable is already
 * exhausted by the time this runs. `fetch` converted it first, and there is no
 * second pass to read. That member cannot be collected by anything short of
 * converting `headers` before the request, which would double every conversion
 * on the success path to redact a message the success path never produces.
 */
function pairMembers(entry: unknown): readonly [unknown, unknown] {
  if (Array.isArray(entry)) return [entry[0], entry[1]];
  if (!isObjectLike(entry)) return [undefined, undefined];
  if (typeof (entry as Iterable<unknown>)[Symbol.iterator] !== "function") {
    return [undefined, undefined];
  }

  let name: unknown;
  let value: unknown;
  let index = 0;
  for (const member of entry as Iterable<unknown>) {
    if (index === 0) name = member;
    else if (index === 1) value = member;
    else break;
    index += 1;
  }
  return [name, value];
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
  let signal: AbortSignal | undefined;
  try {
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
    const fetchImpl = (hasFetchOverride ? options.fetch : undefined) ?? fetch;

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
    const initSignal = options.signal;
    signal =
      initSignal !== undefined
        ? (initSignal ?? undefined)
        : isRequest(url)
          ? url.signal
          : undefined;

    // Fetch reads RequestInit as a WebIDL dictionary, so inherited properties
    // and prototype getters are part of the input. Preserve both while removing
    // this library's `fetch` extension and materializing the signal snapshot.
    // An object spread would silently drop inherited method, headers, body, or
    // signal values.
    const init = snapshotRequestInit(options, initSignal, hasFetchOverride);

    const res = await fetchImpl(url, init);

    // Inside the envelope on purpose. `fetchImpl` can be an injected
    // implementation, so the resolved value is untrusted input. A non-Response
    // or a hostile identity getter must surface as an error VALUE instead of
    // rejecting or escaping through the typed success branch.
    //
    // The first successful `status` read is recorded per response by
    // `statusOf`. The constructor and `UnknownHttpError` reuse that value, so
    // the status that selects the class also reaches `error.status`,
    // `error.message`, and `toJSON()`. A getter that throws can be retried. A
    // successful getter cannot later select a different class.
    //
    // The read stays INSIDE the block below, because it can still throw — a
    // hostile getter, or a `valueOf` that throws during the numeric conversion
    // — and a throw here strands the body. See the catch.
    try {
      if (!isResponse(res)) {
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
        throw new TypeError(
          "The fetch implementation resolved a Response with an incompatible public surface.",
        );
      }
    } catch (cause) {
      // The line above reads `status` (and converts it, which a hostile
      // `valueOf` can make throw), and the error class reads `statusText`,
      // `url`, and `headers`; any of them can throw for an injected
      // implementation. The catch below turns that into a NetworkError, but
      // `res` lives in the outer try block: the caller gets `response: null`
      // and never gets a handle to the body the network already opened.
      // Release it here, or it stays open with no owner.
      releaseResponseBody(res);
      throw cause;
    }

    // The success path releases nothing. `res` IS the returned response, and
    // the caller owns its body.
    return {
      response: res as TypedResponse<JsonReturnType>,
      error: null,
    };
  } catch (err) {
    // The requested URL, so pre-response errors (which hold no `Response`) are
    // still distinguishable in logs — the correlation `BaseHttpError.url`
    // already gives HTTP errors. `FetchInput` is `string | URL | Request`; a
    // `Request` exposes the resolved absolute URL on `.url`, and `String()`
    // stringifies both a `string` (identity) and a `URL` (its `href`).
    const resolvedRequestUrl = requestUrl(url);

    // `signal` is read from the OUTER binding and never re-derived from
    // `options` here: it was resolved before the request, and an `init.signal`
    // getter that threw is one of the reasons this catch runs at all. Reading
    // it again would rethrow and break the envelope's promise.
    //
    // Which failure this is — timeout, abort, or network — is decided by
    // `classifyRequestFailure`. The governing signal is the authority there,
    // never the rejection's `.name`.
    // The header values the platform refused, so the message it handed back
    // can be stripped of them. Read HERE rather than before the request: it is
    // needed only on this path, and a `headers` getter that throws is one more
    // thing the envelope must absorb rather than re-raise. A `Request` passed
    // as the input needs no pass — its headers were validated when it was
    // constructed, so none of them can be a refused value.
    let refusedValues: readonly string[] = [];
    try {
      refusedValues = refusedHeaderValues(options.headers);
    } catch {
      // A throwing `headers` getter leaves the message unredacted rather than
      // breaking the envelope. `NetworkError` still redacts the URL.
    }

    return {
      response: null,
      error: classifyRequestFailure(err, signal, resolvedRequestUrl, refusedValues),
    };
  }
}
