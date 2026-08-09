import { describe, test, expect, afterEach } from "vitest";
import { recordingTransport } from "./fixtures/recording-transport";
import { isHttpError, isKnownHttpError, isNetworkError } from "./src/index";
import { planFailure, planRequest } from "./src/request-plan";
import { httpErrorBrand, knownHttpErrorBrand } from "./src/errors/brand";

// Round 8, lane H1 — request setup and input classification.
//
// Two parts, and they are different KINDS of work.
//
//  1. The four defensive arms no test reached: the `catch` in `hasRequestTag`,
//     the `catch` in `isPlatformRequest`, the `catch` in `isKnownHttpError`,
//     and the `catch` in `classifyRequestInput`. Each test below makes the
//     throw happen and asserts the DOCUMENTED outcome of the arm — the guard
//     answers false, the plan is still built, `requestUrl` is empty — never
//     merely that the line ran.
//  2. One finding: which transport RUNS decides whether a tagged input is
//     handed over as a request, and the setup phase asked a different question.
//
// The three input-classification arms are read off the PLAN now. They are
// decisions `planRequest` makes about the input alone, so driving a whole
// request through an injected transport to read them back was measuring the
// transport double, not the decision.

/** The transport that makes `transportTakesRequest` take the wide tag check. */
const CALLER_TRANSPORT = { fetch: recordingTransport().fetch };

// ── Coverage: the four defensive arms ────────────────────────────────────────

describe("input classification survives an input that cannot be inspected", () => {
  test("a revoked Proxy is refused by both classification guards, and refuses the plan", () => {
    // ONE input reaches both arms. `value instanceof Request` walks the revoked
    // Proxy's prototype chain and throws, so `isPlatformRequest`'s catch answers
    // false. `Object.prototype.toString.call` then reads `Symbol.toStringTag`
    // through the same revoked trap and throws, so `hasRequestTag`'s catch
    // answers false.
    //
    // Answering false is the documented outcome: the input is NOT a request, so
    // the plan serializes it — and `String()` on a revoked Proxy throws too.
    // That throw is a read that PRODUCES what the transport receives, so it is
    // the one class of read that may end a call. It becomes a `NetworkError`
    // with an empty `url`, because no url was ever produced.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    let thrown: unknown;
    expect(() => {
      try {
        planRequest(proxy as unknown as string, CALLER_TRANSPORT);
      } catch (refusal) {
        thrown = refusal;
        throw refusal;
      }
    }).toThrow();

    const error = planFailure(thrown);
    expect(isNetworkError(error)).toBe(true);
    // The library-authored constant, never a platform echo.
    expect(error.message).toBe("Network error");
    // No URL could be resolved, so the correlation field is the empty string.
    expect(error.url).toBe("");
  });

  test("a Proxy whose prototype walk throws is classified as URL-like", () => {
    // `isPlatformRequest`'s catch in isolation. The `getPrototypeOf` trap breaks
    // `instanceof`, and the tag read forwards to the plain target, so
    // `hasRequestTag` answers `[object Object]` without entering its own catch.
    //
    // The documented outcome: the guard answers false, so the input is
    // serialized once and the transport receives that exact string.
    const hostilePrototypeWalk = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error("hostile prototype walk");
        },
      },
    );

    const plan = planRequest(hostilePrototypeWalk as unknown as string, CALLER_TRANSPORT);

    // A string, not the object: the input was not taken as a request.
    expect(plan.transportInput).toBe("[object Object]");
    expect(plan.requestUrl).toBe("[object Object]");
  });

  test("an input whose Symbol.toStringTag getter throws is classified as URL-like", () => {
    // `hasRequestTag`'s catch in isolation. `instanceof Request` walks an
    // ordinary prototype chain and answers false without throwing, so
    // `isPlatformRequest`'s catch is not entered; the tag read throws and
    // `hasRequestTag`'s catch answers false.
    //
    // The own `toString` keeps the serialization working, which is what makes
    // the arm's outcome observable: the transport receives the serialized URL.
    const target = "https://tag-thrower.invalid/classified-as-url";
    const tagThrower = {
      get [Symbol.toStringTag](): string {
        throw new Error("hostile toStringTag getter");
      },
      toString(): string {
        return target;
      },
    };

    const plan = planRequest(tagThrower as unknown as string, CALLER_TRANSPORT);

    expect(plan.transportInput).toBe(target);
    expect(plan.requestUrl).toBe(target);
  });

  test("a tagged input whose url getter throws is still handed to the transport", () => {
    // `classifyRequestInput`'s catch. The tag gate accepts the value, and the
    // `url` read throws. The documented outcome is stated on the catch itself:
    // "a hostile `url` getter is not a reason to refuse a Request the transport
    // may still be able to send". So classification records an EMPTY
    // `requestUrl`, and the transport receives the input object unchanged.
    const fakeRequest = {
      [Symbol.toStringTag]: "Request",
      get url(): string {
        throw new Error("hostile url getter");
      },
    };

    const plan = planRequest(fakeRequest as unknown as Request, CALLER_TRANSPORT);

    // The plan hands over the object itself, not a serialization of it.
    expect(plan.transportInput).toBe(fakeRequest);
    // No url could be read, so the correlation field stays empty.
    expect(plan.requestUrl).toBe("");
  });
});

describe("isKnownHttpError refuses a value whose status cannot be read", () => {
  test("a forged pair of brands over a throwing status getter answers false", () => {
    // A brand forged on the VALUE is accepted by design (ADR 0003, out-of-scope
    // item 5), so both brand reads pass and the guard goes on to the status. The
    // status getter throws, and the catch's documented outcome is "hostile
    // proxies/getters are not valid library errors".
    const forged: Record<PropertyKey, unknown> = {};
    for (const brandKey of [httpErrorBrand, knownHttpErrorBrand]) {
      Object.defineProperty(forged, brandKey, { value: true });
    }
    Object.defineProperty(forged, "status", {
      get(): never {
        throw new Error("hostile status getter");
      },
    });

    // The forged brand IS accepted — which is what makes the status read the
    // only thing that can refuse this value.
    expect(isHttpError(forged)).toBe(true);
    expect(isKnownHttpError(forged)).toBe(false);
  });
});

// ── The finding ──────────────────────────────────────────────────────────────

/**
 * A `Request`-TAGGED value that is not a platform `Request` — the shape
 * `node-fetch@2` ships. Its `url` and its serialization name different servers,
 * so whichever one the plan reports says which value the transport is handed.
 */
function taggedForeignRequest(): Request {
  return {
    [Symbol.toStringTag]: "Request",
    url: "https://never-requested.invalid/tagged-url",
    toString(): string {
      return "https://actually-sent.invalid/serialized";
    },
  } as unknown as Request;
}

describe("which transport runs decides whether a tagged input is a request", () => {
  const ambient = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ambient;
  });

  test("passing the ambient fetch explicitly does not widen the request check", () => {
    // `{ fetch: globalThis.fetch }` is what dependency injection writes:
    // `typedFetch(u, { fetch: injected ?? globalThis.fetch })`. The transport
    // that RUNS is the platform's, so it resolves `RequestInfo` with its own
    // realm-bound brand check and converts this value to a `USVString` — the
    // request goes to the serialization. The plan must name that same string as
    // both the transport input and the correlation url, exactly as it does when
    // the option is absent.
    const plan = planRequest(taggedForeignRequest(), { fetch: ambient });

    expect(plan.ambientTransport).toBe(true);
    expect(plan.transportInput).toBe("https://actually-sent.invalid/serialized");
    expect(plan.requestUrl).toBe("https://actually-sent.invalid/serialized");
  });

  test("the same input under no options at all reaches the same plan", () => {
    // The control for the test above: the option is what dependency injection
    // adds, and adding it must change nothing.
    const plan = planRequest(taggedForeignRequest(), {});

    expect(plan.ambientTransport).toBe(true);
    expect(plan.transportInput).toBe("https://actually-sent.invalid/serialized");
  });

  test("a replaced global fetch is caller code and takes the tagged input", () => {
    // The other direction of the same question. Installing a Fetch
    // implementation on the global is how a polyfill is adopted, and that
    // implementation writes its own rule about what it accepts as a request —
    // only the caller can pair its `Request` with the copy of `fetch` that
    // shipped with it. The setup phase must hand the value over rather than
    // serialize it behind the caller's back.
    const tagged = taggedForeignRequest();
    globalThis.fetch = recordingTransport().fetch;

    const plan = planRequest(tagged, {});

    expect(plan.ambientTransport).toBe(false);
    expect(plan.transportInput).toBe(tagged);
    expect(plan.requestUrl).toBe("https://never-requested.invalid/tagged-url");
  });
});
