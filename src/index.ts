import { ClientErrors, ServerErrors, TypedFetchError } from "./errors/helpers";
import { BaseHttpError } from "./errors/base-http-error";
import { statusCodeErrorMap } from "./http-status-codes";
import type { NetworkError } from "./errors/network-error";
import type { AbortedError } from "./errors/aborted-error";
import type { TimeoutError } from "./errors/timeout-error";
import {
  abortedErrorBrand,
  hasBrand,
  httpErrorBrand,
  knownHttpErrorBrand,
  networkErrorBrand,
  timeoutErrorBrand,
} from "./errors/brand";
import { classifyRequestFailure, networkFailure, snapshotAbortState } from "./request-failure";
import { planFailure, planRequest } from "./request-plan";
import type { FetchInput, RequestPlan, TypedFetchOptions } from "./request-plan";
import { classifyResolvedValue } from "./response-verdict";

export type { TypedFetchOptions } from "./request-plan";

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
 * Type guard for a *known*, dedicated HTTP error class (excludes `UnknownHttpError`).
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
 * reaches a platform API without a cast. They were a `Pick` of the members
 * `isResponse` validates, and that
 * narrowing bought nothing it cost: `body.tee()` and `body.pipeThrough()` are
 * typed with the full `ReadableStream`, so the exact members `body` refused to
 * promise came straight back one call later. Naming the ambient type also
 * defers to the CONSUMER's own lib configuration, which is the same authority
 * that types a plain `fetch` call in their project — `for await` over a body
 * compiles under `@types/node` and does not under `lib.dom`, which is correct
 * in both cases.
 *
 * FORWARDING, since removing the cast removed the step that made a developer
 * stop here. `new Response(r.body, { headers: r.headers })` is the line every
 * proxy reaches for, and it is wrong: the platform hands back a DECODED body
 * while `content-encoding`, the wire `content-length`, and the hop-by-hop names
 * stay on `headers`, so the response you emit declares framing its bytes
 * contradict. Drop those first — a bare `fetch` user writing the same line has
 * the same problem, which is why it is worth stating here:
 *
 * ```ts no-check
 * const headers = new Headers(response.headers);
 * for (const name of ["content-encoding", "content-length", "connection", "transfer-encoding"]) {
 *   headers.delete(name);
 * }
 * return new Response(response.body, { status: response.status, headers });
 * ```
 *
 * This interface is still not `Response`, and that omission is load-bearing:
 * `Response.bytes()` is absent at the package floor, Node 20.13.0, so promising
 * it would hand a consumer a method that does not exist there. Forwarding the
 * value itself to a `(r: Response)` slot therefore still needs a cast. Widening
 * that far is a floor decision, not a typing one.
 *
 * `Headers.getSetCookie()` is now promised and therefore now VALIDATED — see
 * `src/response-verdict.ts`. A standards-compatible polyfill
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

/**
 * The success arm of the envelope.
 *
 * The ONE place the accepted response becomes a {@link TypedResponse}, and the
 * only cast in this file. `TypedResponse` is a subset of the surface
 * `classifyResolvedValue` already validated, and the value crosses this line
 * unmodified: the caller receives the same object the implementation produced,
 * never a wrapper. ADR 0003, out-of-scope item 3.
 */
function successEnvelope<JsonReturnType>(response: Response): TypedFetchReturnType<JsonReturnType> {
  return { response: response as TypedResponse<JsonReturnType>, error: null };
}

/**
 * The failure arm of the envelope.
 *
 * Every request failure leaves `typedFetch` through this function, so the
 * promise the envelope makes — a failure is a VALUE, never a rejection — is
 * stated in one place instead of at six returns.
 */
function failureEnvelope<JsonReturnType>(
  error: TypedFetchError,
): TypedFetchReturnType<JsonReturnType> {
  return { response: null, error };
}

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
  // THREE PHASES, and each one names the failures it can produce:
  //
  //  1. SETUP — `planRequest` reads the caller's options and builds the init.
  //     Always a NetworkError.
  //  2. TRANSPORT — the awaited transport call. The ONLY phase that can produce
  //     an AbortedError or a TimeoutError, because it is the only phase whose
  //     failure the governing signal can have caused.
  //  3. RESPONSE — `classifyResolvedValue` inspects and classifies the resolved
  //     value, and releases its body when that fails. Always a NetworkError.
  //
  // One `try` around all three could not state that. A hostile getter in phase
  // 1 or phase 3 can abort the signal and then throw an abort-shaped exception,
  // and the classifier — which trusts the signal by design — answered with an
  // AbortedError for a failure the abort never caused. A consumer's retry
  // policy reads that class.
  //
  // Each phase now owns its own failure, and `classifyRequestFailure` has ONE
  // call site, in the transport phase. Neither `./request-plan` nor
  // `./response-verdict` consults a signal at all, so neither can produce an
  // abort or a timeout even if a later change forgot the rule.

  // ── Phase 1: setup ──────────────────────────────────────────────────────
  let plan: RequestPlan;
  try {
    plan = planRequest(url, options);
  } catch (refusal) {
    // A `fetch`, `signal`, or descriptor read that throws. No request left this
    // process, so no signal can have caused it. The refusal carries the url the
    // plan resolved from the INPUT alone, before it read `options`.
    return failureEnvelope(planFailure(refusal));
  }

  // ── Phase 2: transport ──────────────────────────────────────────────────
  //
  // The phase split gave each phase its own catch so that only the transport
  // can answer with an abort. It drew the line at the CALL, and the caller's
  // own object graph is read INSIDE it: `fetch` normalizes its init in the
  // synchronous prologue before any I/O, which runs every getter on `method`,
  // `body`, `integrity`, and the rest, plus every read inside a `headers`
  // container. A getter that aborted the signal and then threw was therefore
  // answered with an `AbortedError` — the exact outcome ADR 0003 row H-28
  // forbids, reached by a path the row's scenario did not describe.
  //
  // So the state is snapshotted on either side of that prologue. A signal that
  // turns aborted while the transport is READING the init cannot have caused
  // the failure, because no request had been sent yet. A legitimate abort —
  // one raised after the request is in flight, or already raised before the
  // call — does not flip between these two reads.
  //
  // Reading the SIGNAL twice is not reading a caller VALUE twice: the snapshot
  // is guarded and total, and a signal that lies can only push the verdict
  // toward `NetworkError`, which is the safe direction.
  //
  // ONE condition narrows it, and it keeps a real abort real: the window is for
  // the AMBIENT transport only. An injected `fetch` runs the caller's own code
  // AS the transport, and a transport that aborts and rejects IS the request
  // being aborted. ADR 0003 already scopes that as the caller's code, and a
  // transport that reads its init after an `await` escapes the window anyway.
  //
  // The rejection VALUE cannot narrow it further, and that was tried: a getter
  // is free to abort with the very exception it then throws, so the rejection
  // is identical to the signal's reason in both the hostile shape and the
  // ordinary one. The consequence is stated rather than hidden — a getter that
  // aborts the signal WITHOUT throwing now reports `NetworkError` too, where it
  // used to report an abort. Both are the caller aborting its own request
  // from inside a getter, no request left the process in either, and H-28 is
  // the row that decides which class that is.
  let resolved: unknown;
  const abortedBeforeTransport = snapshotAbortState(plan.signal).aborted;
  let abortedWhileReadingInit = false;
  try {
    const pending = plan.transport(plan.transportInput, plan.init);
    abortedWhileReadingInit =
      plan.ambientTransport && !abortedBeforeTransport && snapshotAbortState(plan.signal).aborted;
    resolved = await pending;
  } catch (cause) {
    if (abortedWhileReadingInit) {
      // The signal moved while the ambient transport was reading the caller's
      // init. No request had been sent, so the abort cannot have stopped one.
      return failureEnvelope(networkFailure(cause, plan.requestUrl));
    }
    // NOTHING runs between the rejection and the classification. The URL was
    // resolved in phase 1, so no caller code can move the abort state that
    // decides which failure this is.
    //
    // `plan.signal` was resolved in phase 1 and is never re-derived from
    // `options` here: reading it again would run a getter that can throw.
    //
    // Which failure this is — timeout, abort, or network — is decided by
    // `classifyRequestFailure`. The governing signal is the authority there,
    // never the rejection's `.name`.
    return failureEnvelope(classifyRequestFailure(cause, plan.signal, plan.requestUrl));
  }

  // ── Phase 3: response ───────────────────────────────────────────────────
  // Inside the envelope on purpose. The transport can be an injected
  // implementation, so the resolved value is untrusted input. A non-Response
  // or a hostile identity getter must surface as an error VALUE instead of
  // rejecting or escaping through the typed success branch.
  //
  // `classifyResolvedValue` is total and owns the whole decision: the staged
  // identity, the rollback on every refusal, and the release of a body no
  // caller will ever receive a handle to.
  const verdict = classifyResolvedValue(resolved);
  if (verdict.kind === "refused") {
    return failureEnvelope(networkFailure(verdict.cause, plan.requestUrl));
  }
  if (verdict.kind === "http") return failureEnvelope(verdict.error);
  return successEnvelope<JsonReturnType>(verdict.response);
}
