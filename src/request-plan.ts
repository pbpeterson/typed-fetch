import { networkFailure } from "./request-failure";
import { textOf } from "./errors/untrusted-read";
import type { NetworkError } from "./errors/network-error";
import type { TypedHeaders } from "./headers";
import type { HttpMethods } from "./methods";

/**
 * The request PLAN: everything `typedFetch` decides before a request is
 * attempted, behind one call.
 *
 * ## Why this is its own module
 *
 * The setup phase produces four things the two phases after it depend on — the
 * value the transport receives, the init it reads, the signal
 * `classifyRequestFailure` treats as the authority, and the URL a pre-response
 * error is filed against. None of that performs a request. All of it is a
 * function of two untrusted inputs: the caller's request input and the caller's
 * options object. Both can be exotic, cross-realm, or hostile, so every read
 * here is guarded.
 *
 * Keeping those rules next to the request plumbing meant they could only be
 * reached by performing a request: a test had to inject a `fetch`, drive a whole
 * call, and read the answer back out of the `{ response, error }` envelope,
 * which reports the transport input and the init only through a double that
 * records them. Here the plan IS the return value, so the whole input space is
 * reachable without a transport, a server, or a promise.
 *
 * ## The contract
 *
 * - The request input is serialized AT MOST ONCE per call, and the transport
 *   receives that exact string. A handed-over request is passed through
 *   unchanged. See {@link classifyRequestInput}.
 * - {@link RequestPlan.requestUrl} is resolved from the INPUT alone, before any
 *   read of `options`. A `options` read that throws still leaves a plan refusal
 *   that names the request.
 * - No read that only DESCRIBES the request can refuse it. Only the reads that
 *   PRODUCE what the transport receives — the serialization, the transport
 *   selection, the init — can end a call.
 * - The `fetch` override is read as an OWN property. A polluted prototype never
 *   redirects a transport.
 * - The init a transport receives carries no `fetch` extension under any of the
 *   three reads that inspect its own shape: an own-property descriptor answers
 *   absent, `Object.keys`/`ownKeys` omit the name, and a spread copy carries
 *   none. When the caller passed no own `fetch`, a plain property get and the
 *   `in` operator read the prototype chain too, and an INHERITED `fetch`
 *   answers both of them: the property get returns the caller's value and `in`
 *   answers `true`. When the caller also passed an own `fetch` — the only way
 *   caller code becomes the transport through the option — the sanitizing
 *   proxy answers `undefined` and `false` for both reads instead, without
 *   consulting the chain, even while an inherited `fetch` is still on it.
 *   Neither read selects a transport — `Object.hasOwn` decides that, never a
 *   plain get or an `in` check — so a transport that calls `typedFetch` again
 *   with that init re-enters on the AMBIENT transport. It never re-enters on
 *   itself.
 * - Every failure this module raises is a plan refusal, and
 *   {@link planFailure} turns any of them into a `NetworkError`. The setup
 *   phase never produces an `AbortedError` or a `TimeoutError`, because no
 *   request left the process and no signal can have caused the failure.
 */

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
 * The ambient `fetch` answers with {@link isPlatformRequest}. Caller code
 * running AS the transport writes its own rule this module cannot read, so it
 * keeps the wider tag check — which is also what a duplicated runtime needs,
 * since only the caller can pair its `Request` with the copy of `fetch` that
 * shipped with it.
 *
 * The question is which transport RUNS, never whether an option was passed.
 * `{ fetch: globalThis.fetch }` carries the option and still runs the
 * platform's transport; a `globalThis.fetch` replaced by a polyfill carries no
 * option and is caller code.
 */
function transportTakesRequest(input: RequestInputFacts, callerTransport: boolean): boolean {
  return callerTransport ? input.taggedRequest : input.platformRequest;
}

/**
 * The platform's own `fetch`, captured before a caller can replace it.
 *
 * The transport phase's abort window applies only when the transport that runs
 * is the PLATFORM's. Two things look like "no override" and are not: an own
 * `fetch: undefined` leaves the ambient transport in place while carrying the
 * key, and a replaced `globalThis.fetch` carries no key while being caller
 * code. Comparing the transport that will actually run against this binding
 * answers the question both of those get wrong.
 *
 * A caller who replaces the global BEFORE this module loads is captured here
 * instead, and gets the ambient treatment. That is the same trade every
 * captured intrinsic in this package makes.
 */
const nativeFetch: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined;

type FetchParams = Parameters<typeof fetch>;

/** The request input `typedFetch` accepts: `string | URL | Request`. */
export type FetchInput = FetchParams[0];

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

/** Request options accepted by `typedFetch` — `RequestInit` with typed `headers` and `method`. */
export type TypedFetchOptions = NativeRequestOptions & {
  headers?: TypedHeaders;
  // fetch accepts any method string (and normalizes case); the union only
  // drives IntelliSense.
  method?: HttpMethods | (string & {});
  /** Override the fetch implementation (testing, DI, custom agents). */
  fetch?: typeof fetch | undefined;
};

function snapshotRequestInit(
  options: TypedFetchOptions,
  signal: AbortSignal | null | undefined,
  removeFetchOverride: boolean,
): RequestInit {
  // The entry the descriptor below materializes exists for ONE reader:
  // `{ ...init }`, which a forwarding transport writes. A spread asks the
  // object it copies TWO questions, in this order: `[[OwnPropertyKeys]]` once,
  // then `[[GetOwnProperty]]` for every key it got back. It asks them of that
  // object, at the moment it runs.
  //
  // So NO predicate over the caller's object decides this, and three of them
  // are the reason. Own-ness answered neither question, and let
  // `Object.defineProperty(options, "signal", { value })` through.
  // Descriptor enumerability answered the second question only, and answered it
  // here, early, about an object the caller still owns and can still change: a
  // Proxy may legally report an enumerable descriptor for a key its `ownKeys`
  // omits, and an ordinary sibling accessor may make the key non-enumerable
  // while the spread is already running. Every one of them ended in the same
  // place — the init reported the caller's signal, the spread carried none, and
  // `classifyRequestFailure` went on treating that signal as the authority:
  // `controller.abort()` cancelled nothing, the server wrote the whole
  // response, and the envelope reported a SUCCESS for a request the caller had
  // aborted.
  //
  // The question is put to the object this module CONSTRUCTS instead. Whenever
  // a signal has to be carried, the branch below builds a fresh target the
  // caller cannot reach, and gives it an own ENUMERABLE `signal` entry: that
  // answers both of the spread's questions by construction, and no later read
  // can invalidate it. The caller's object stays the target only when there is
  // nothing to carry at all. This costs the descriptor clone on every
  // signal-carrying call, which is what the condition here used to avoid, and
  // it removes a caller-controlled read instead of adding a fourth one — the
  // rule ADR 0003 row H-26 states for the request input, applied to the
  // options object: a caller-controlled fact read twice can answer differently
  // each time.
  if (!removeFetchOverride && signal === undefined) {
    // Nothing has to be hidden and nothing has to be added, so the original
    // object can remain the proxy target. This preserves reflection and avoids
    // inspecting every descriptor on a potentially exotic RequestInit. The trap
    // still answers `signal`, because a slot that answered `undefined` on the
    // caller's own first read can answer something else on a second one, and
    // the init reports the FIRST answer.
    return new Proxy(options, {
      get(target, property) {
        if (property === "signal") return signal;
        return Reflect.get(target, property, target);
      },
    });
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  // Only the caller's OWN extension is stripped, and only on the branch that
  // read it. An inherited `fetch` is neither used nor stripped — the decision
  // `planRequest` states at the `Object.hasOwn` that selects the transport —
  // and this path is now reached with that read answering `false` too.
  if (removeFetchOverride) delete descriptors.fetch;

  // A WebIDL dictionary is normally read by the transport. `typedFetch` also
  // needs the signal to classify a rejection, so letting the getter run once
  // here and again inside fetch can produce two different authorities. The
  // `get` trap below answers every `signal` read with the captured value; this
  // descriptor is what makes that legal, because a proxy may not report a value
  // other than the one a non-configurable own property of its target holds.
  //
  // Only when the caller owns the slot or there is a signal to carry. Writing
  // it unconditionally invented an own key: `Object.keys(init)` and
  // `Reflect.ownKeys(init)` listed `signal` while `"signal" in init` — answered
  // from the original object by the `has` trap — said `false`, and
  // `{ ...init }` grew a `signal: undefined` member the caller never wrote. An
  // implementation is entitled to reflect over its init, and the suite already
  // treats that as legitimate.
  //
  // ENUMERABLE for two separate reasons, and neither one covers the other. A
  // signal must reach `{ ...init }`, the spread a forwarding transport writes,
  // so an entry that carries one is enumerable however the caller declared the
  // slot: this is the entry the branch above sends here, and carrying
  // `enumerable: false` re-declared it exactly as invisible to a spread as the
  // caller's own slot was. With NO signal to carry, the entry only stands in
  // for the caller's own slot and copies its enumerability. Declaring that one
  // enumerable too grew the invented member again, on an own non-enumerable
  // slot reading `undefined`, and only where an own `fetch` option selects this
  // branch — so the two branches disagreed about one options object.
  if (descriptors.signal || signal !== undefined) {
    descriptors.signal = {
      value: signal,
      writable: true,
      enumerable: descriptors.signal?.enumerable === true || signal !== undefined,
      configurable: true,
    };
  }
  const sanitizedTarget = Object.create(Object.getPrototypeOf(options), descriptors) as RequestInit;

  // The proxy target exposes the same descriptors/prototype for reflection,
  // omitting the extension on the branch that read it and carrying the signal
  // entry. Ordinary reads delegate to the original object with
  // the original receiver: prototype getters backed by WebIDL internal slots or
  // JavaScript private fields would reject a descriptor-only clone because that
  // clone does not carry those slots. `signal` is the one snapshotted
  // exception, and `headers` deliberately is NOT one: the transport is the only
  // reader of that slot, so its getter runs exactly once, as it does under a
  // bare `fetch`.
  return new Proxy(sanitizedTarget, {
    get(_target, property) {
      if (property === "signal") return signal;
      if (removeFetchOverride && property === "fetch") return undefined;
      return Reflect.get(options, property, options);
    },
    has(_target, property) {
      return removeFetchOverride && property === "fetch" ? false : Reflect.has(options, property);
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
 * CALLER CODE running as the transport — an injected `fetch`, or a replaced
 * global — writes its own rule and this module cannot read it, so it keeps the
 * wider tag check. That is also what a duplicated runtime needs: its `Request`
 * is a real one to the copy of `fetch` that shipped with it, and only the
 * caller can pair the two.
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
 * exception is NOT swallowed: the request cannot be made, and the plan refuses
 * with an empty `url`. A `Request`'s `url` is the
 * other direction: the tag check accepts anything tagged `[object Request]`, and
 * a subclass can override the getter, so it can answer with a number or an
 * object without throwing at all. That value is dropped rather than coerced, so
 * the `string` this function promises is a string at its own call site.
 *
 * It is NOT what keeps a non-string out of `NetworkError.url`. The constructor
 * normalizes every url it is handed, because it is public API a consumer calls
 * directly, and removing the drop here changes nothing a caller can observe —
 * measured, not argued. Two guards for one property is the right number when
 * one of them is a public entry point; a comment that names the wrong one as
 * the authority is how the next reader deletes the one that matters.
 *
 * Everything here reads the INPUT and nothing reads `options`, which is what
 * lets {@link planRequest} run it first. `error.url` is the only thing that
 * tells two concurrent failures apart, and it used to be lost whenever a read
 * of `options` threw before the input had been resolved — including for
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
    // Through the NATIVE getter for a platform `Request`, the way `isResponse`
    // reads `status`. `Request.prototype.url` is a read-only accessor, so
    // `Object.defineProperty(request, "url", { value })` is the known way to
    // rewrite a URL in a Node adapter — and a plain property read lets that own
    // property shadow the getter. The transport does not consult it: it sends
    // the request to the real URL and the error named the shadow, which is
    // chosen by whoever hands the `Request` over, often middleware rather than
    // the call site.
    raw = platformRequest ? nativeRequestUrl(input as Request) : (input as unknown as Request).url;
  } catch {
    // A hostile `url` getter is not a reason to refuse a Request the transport
    // may still be able to send.
    raw = undefined;
  }
  return { platformRequest, taggedRequest, requestUrl: textOf(raw) };
}

/**
 * `Request.prototype`'s own `url` getter, applied to a platform `Request`.
 *
 * Falls back to a plain read when the accessor cannot be found — a runtime
 * where `url` is a data property still answers correctly.
 */
function nativeRequestUrl(request: Request): unknown {
  const getter = Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get;
  return typeof getter === "function" ? Reflect.apply(getter, request, []) : request.url;
}

/**
 * The signal a handed-over `Request` contributes, or nothing when no read of it
 * can answer.
 *
 * TOTAL, and that is the whole of the design. This read DESCRIBES the request;
 * it does not make one. The transport applies its own signal to the request it
 * sends — the platform reads an internal slot that no getter of the caller's
 * stands in front of — and this module reads one only so
 * `classifyRequestFailure` knows which authority to consult. A read that cannot
 * answer therefore means "no signal I can see", which is the state every call
 * that carries no signal is already in, and never "refuse the request".
 * {@link classifyRequestInput} says exactly that about the sibling `url` read
 * one slot up; for three rounds this one said the opposite, and a `Request` the
 * transport could have sent came back as a `NetworkError` with no request
 * behind it.
 *
 * The accessor FIRST, the plain read SECOND, and no predicate choosing between
 * them. `Request.prototype.signal` is a read-only accessor over the slot the
 * platform aborts on, so an own data property shadows it for every plain read —
 * the decoy a decorating middleware writes, exactly as an own `url` is, which
 * is why the accessor is tried first. Whether that accessor can REPORT the slot
 * is a fact about how the value was allocated, and no predicate here can decide
 * it: `instanceof Request` asks about a prototype CHAIN, so a `Proxy` over a
 * `Request` and an `Object.create(Request.prototype)` both pass it while the
 * accessor applied to either one throws. Three rounds of predicates named three
 * different cases and each missed the next. Applying the accessor asks the
 * question itself, and its failure is the answer.
 *
 * The lookup is inside the `try` for the same reason: a runtime with no
 * `Request` global at all falls through to the plain read instead of needing a
 * guard that no test can take the other arm of.
 */
function handedOverSignal(request: Request | null): AbortSignal | null | undefined {
  // Nothing was handed over — the plan serialized the input instead — so
  // nothing contributes a signal.
  if (request === null) return undefined;

  try {
    const getter = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get;
    if (typeof getter === "function") {
      return Reflect.apply(getter, request, []) as AbortSignal | null;
    }
  } catch {
    // No slot for the accessor to report: an exotic object over a `Request`, or
    // a value {@link transportTakesRequest} admitted on the wider tag check.
    // The plain read below is the whole of such a value's signal.
  }

  try {
    return request.signal;
  } catch {
    // A signal that cannot be read governs nothing.
    return undefined;
  }
}

/** Everything the transport phase and the response phase need from the setup phase. */
export interface RequestPlan {
  /**
   * What the transport receives: the input ITSELF when the transport that runs
   * takes it as a request, and otherwise the one serialization of it.
   */
  readonly transportInput: FetchInput;
  /** The init the transport reads. See {@link snapshotRequestInit}. */
  readonly init: RequestInit;
  /**
   * The signal that governs the call, and the authority
   * `classifyRequestFailure` consults. `undefined` when no read can answer with
   * one.
   */
  readonly signal: AbortSignal | undefined;
  /**
   * The requested URL, so pre-response errors (which hold no `Response`) are
   * still distinguishable in logs — the correlation `BaseHttpError.url` already
   * gives HTTP errors. It stays the empty string when the input cannot be
   * serialized at all.
   */
  readonly requestUrl: string;
  /** The transport that will run. */
  readonly transport: typeof fetch;
  /**
   * Whether the PLATFORM's own transport is the one that will run. The
   * transport phase reads it: caller code running as the transport — an
   * injected `fetch`, or a replaced global — is the request, so the abort
   * window there does not apply to it.
   */
  readonly ambientTransport: boolean;
}

/**
 * A refused plan: the exception a caller-controlled read raised, and the URL
 * this call had already resolved from the input alone.
 *
 * The URL travels with the refusal because it is the only thing that tells two
 * concurrent failures apart, and it is resolved BEFORE anything reads
 * `options`. `typedFetch(url, null)` is the ordinary case: `Object.hasOwn(null,
 * …)` throws, and the correlation between a log line and a request went with
 * it.
 */
class RequestPlanRefusal {
  constructor(
    readonly cause: unknown,
    readonly url: string,
  ) {}
}

/**
 * Build the plan for one request.
 *
 * @param input - The caller's request input. Untrusted: its `toString`, its
 *   `Symbol.toStringTag`, its `url`, and its `signal` are all caller code.
 * @param options - The caller's options object. Untrusted for the same reasons;
 *   it can be exotic, frozen, proxied, or `null`.
 * @returns The plan the transport and response phases run on.
 * @throws A plan refusal, for a read that PRODUCES what the transport receives.
 *   {@link planFailure} turns it into the `NetworkError` the caller gets. A read
 *   that only describes the request never refuses.
 */
export function planRequest(input: FetchInput, options: TypedFetchOptions): RequestPlan {
  // The URL lives outside the `try` so a refusal can carry it. Nothing below
  // reads `options` until it is filed.
  let requestUrl = "";
  try {
    // The INPUT first, and from the input alone.
    const facts = classifyRequestInput(input);
    // No transport takes an untagged input as a request, so the verdict below
    // cannot change it and it can be serialized now, before anything reads
    // `options`. A tagged one files its own `url` for the same reason.
    let serialized: string | null = null;
    if (facts.taggedRequest) {
      requestUrl = facts.requestUrl;
    } else {
      serialized = String(input);
      requestUrl = serialized;
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
    const transport = overrideFetch ?? fetch;
    // Which transport RUNS, never whether a KEY is present — the distinction
    // this file already draws for the init below, and for the same reason.
    // `fetch: undefined` carries the key and leaves the platform's transport in
    // place; a replaced `globalThis.fetch` carries no key and is caller code.
    const ambientTransport = nativeFetch !== undefined && transport === nativeFetch;

    // Will CALLER CODE run as the transport? `ambientTransport` above already
    // decides which transport runs, and only a callable one runs at all: a
    // `fetch` option that is not callable fails the transport phase before any
    // rule about requests applies, so the platform's rule stays in force.
    //
    // Asking the own KEY instead — "did the caller pass a `fetch` option?" —
    // answered both directions wrong, and both are the collapse ADR 0003 row
    // H-26 forbids. `{ fetch: globalThis.fetch }`, which is what dependency
    // injection writes, took the wide tag check against the one transport that
    // takes only its own brand: the request went to `String(input)` while the
    // error named `input.url`, a server nothing touched. A `globalThis.fetch`
    // replaced by a polyfill carries no key at all, so caller code that writes
    // its own rule about requests was handed the serialized string instead of
    // the caller's own `Request`.
    const callerTransport = !ambientTransport && typeof transport === "function";

    // Only a tagged input is still undecided: whether the transport takes it as
    // a request, or serializes it the way the platform serializes everything it
    // does not recognize. `??=` is what keeps the serialization at ONE call,
    // which is the whole reason this module resolves the input itself.
    let transportInput: FetchInput;
    let requestInput: Request | null = null;
    if (facts.taggedRequest && transportTakesRequest(facts, callerTransport)) {
      transportInput = input;
      requestInput = input as Request;
    } else {
      serialized ??= String(input);
      transportInput = serialized;
      requestUrl = serialized;
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
    // WHICH input is a Request is the verdict this function already reached,
    // never a second `isRequest` call. The read behind it is the input's own
    // `Symbol.toStringTag`, so a second call is a second chance for the input
    // to answer differently — and the two answers govern different things: one
    // picks what the transport receives, this one picks the signal
    // `classifyRequestFailure` treats as authoritative. When they disagreed, a
    // plain network failure was reported as an abort.
    const initSignal = options.signal;
    let signal: AbortSignal | undefined;
    if (initSignal !== undefined) {
      signal = initSignal ?? undefined;
    } else {
      // THE RULE, for both fields the setup phase takes off a handed-over
      // `Request`: try `Request.prototype`'s accessor, fall back to the plain
      // read, and answer with nothing when neither can answer.
      // `classifyRequestInput` already reads `url` that way, one slot further
      // up, and this is the same read for the same reason.
      // {@link handedOverSignal} holds the reasoning for the order and for the
      // absence of a predicate in front of it.
      //
      // WHICH TRANSPORT RUNS cannot decide this, and that was one earlier
      // spelling. A `Request` reaches the platform under caller code as much as
      // under the ambient transport: `{ fetch: (input, init) =>
      // globalThis.fetch(input, init) }` — the wrapper that logs, retries, or
      // counts calls — hands the `Request` over WHOLE, so the platform aborts
      // on the slot while the library read the shadow, and a request that WAS
      // aborted came back as a `NetworkError`. A consumer's retry policy reads
      // that class. This module cannot see what caller code does with a
      // `Request`, so it must not branch on it.
      //
      // One case is under-reported: caller code that reads the own property
      // AND aborts on it, over a platform `Request` whose slot signal is not
      // aborted. It resolves to `NetworkError`, the safe direction the
      // transport phase documents for an untrustworthy signal.
      signal = handedOverSignal(requestInput) ?? undefined;
    }

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
    const init = snapshotRequestInit(options, initSignal, hasFetchOverride);

    return { transportInput, init, signal, requestUrl, transport, ambientTransport };
  } catch (cause) {
    throw new RequestPlanRefusal(cause, requestUrl);
  }
}

/**
 * The error value for a refused plan.
 *
 * TOTAL over what it is handed, exactly as `classifyRequestFailure` is over a
 * rejection. A refused plan carries the URL this call resolved from its input;
 * anything else is a defect in this module, and a defect must still leave the
 * caller with an error VALUE rather than an envelope that rejects.
 *
 * Always a `NetworkError`, never an `AbortedError` and never a `TimeoutError`.
 * No request left the process, so no signal can have caused the failure — the
 * rule ADR 0003 rows H-21 and H-28 state, made structural by the fact that this
 * module never consults a signal at all.
 */
export function planFailure(thrown: unknown): NetworkError {
  if (thrown instanceof RequestPlanRefusal) return networkFailure(thrown.cause, thrown.url);
  return networkFailure(thrown, "");
}
