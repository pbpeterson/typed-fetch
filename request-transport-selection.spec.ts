import { describe, test, expect, afterEach } from "vitest";
import { typedFetch, isHttpError, isKnownHttpError, isNetworkError } from "./src/index";
import { httpErrorBrand, knownHttpErrorBrand } from "./src/errors/brand";

// Round 8, lane H1 — request setup and input classification.
//
// Two parts, and they are different KINDS of work.
//
//  1. The four defensive arms of `src/index.ts` that no test reached: the
//     `catch` in `hasRequestTag` (line 40), the `catch` in `isPlatformRequest`
//     (line 58), the `catch` in `isKnownHttpError` (line 426), and the `catch`
//     in `classifyRequestInput` (line 699). Each test below makes the throw
//     happen through the public interface and asserts the DOCUMENTED outcome of
//     the arm — the guard answers false, the envelope resolves, `requestUrl` is
//     empty — never merely that the line ran. These pass on `main`.
//  2. One finding: which transport RUNS decides whether a tagged input is
//     handed over as a request, and the setup phase asks a different question.

/** A transport double that records what it received. */
function recordingTransport(respond: () => Response | Promise<Response>): {
  readonly fetch: typeof fetch;
  readonly inputs: unknown[];
} {
  const inputs: unknown[] = [];
  const impl = async (input: unknown): Promise<Response> => {
    inputs.push(input);
    return respond();
  };
  return { fetch: impl as unknown as typeof fetch, inputs };
}

// ── Coverage: the four defensive arms ────────────────────────────────────────

describe("input classification survives an input that cannot be inspected", () => {
  test("a revoked Proxy is refused by both classification guards, inside the envelope", async () => {
    // ONE input reaches both arms. `value instanceof Request` walks the revoked
    // Proxy's prototype chain and throws, so `isPlatformRequest`'s catch answers
    // false (line 58). `Object.prototype.toString.call` then reads
    // `Symbol.toStringTag` through the same revoked trap and throws, so
    // `hasRequestTag`'s catch answers false (line 40).
    //
    // Answering false is the documented outcome: the input is NOT a request, so
    // the setup phase serializes it — and `String()` on a revoked Proxy throws
    // too. That throw is the setup phase's, and the phase turns it into a
    // `NetworkError` with an empty `url`. Nothing escapes as an exception, and
    // no request is attempted.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const transport = recordingTransport(() => new Response(null, { status: 204 }));

    const result = await typedFetch(proxy as unknown as string, { fetch: transport.fetch });

    expect(result.response).toBe(null);
    expect(isNetworkError(result.error)).toBe(true);
    // The library-authored constant, never a platform echo.
    expect(result.error?.message).toBe("Network error");
    // No URL could be resolved, so the correlation field is the empty string.
    expect(result.error?.url).toBe("");
    // The guards refused it, so the request was never attempted.
    expect(transport.inputs).toEqual([]);
  });

  test("a Proxy whose prototype walk throws is classified as URL-like", async () => {
    // Line 58 in isolation. The `getPrototypeOf` trap breaks `instanceof`, and
    // the tag read forwards to the plain target, so `hasRequestTag` answers
    // `[object Object]` without entering its own catch.
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
    const transport = recordingTransport(() => new Response(null, { status: 204 }));

    const result = await typedFetch(hostilePrototypeWalk as unknown as string, {
      fetch: transport.fetch,
    });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(204);
    // A string, not the object: the input was not taken as a request.
    expect(transport.inputs).toEqual(["[object Object]"]);
  });

  test("an input whose Symbol.toStringTag getter throws is classified as URL-like", async () => {
    // Line 40 in isolation. `instanceof Request` walks an ordinary prototype
    // chain and answers false without throwing, so `isPlatformRequest`'s catch
    // is not entered; the tag read throws and `hasRequestTag`'s catch answers
    // false.
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
    const transport = recordingTransport(() => new Response(null, { status: 204 }));

    const result = await typedFetch(tagThrower as unknown as string, { fetch: transport.fetch });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(204);
    expect(transport.inputs).toEqual([target]);
  });

  test("a tagged input whose url getter throws still reaches the transport", async () => {
    // Line 699. The tag gate accepts the value, and the `url` read throws. The
    // documented outcome is stated on the catch itself: "a hostile `url` getter
    // is not a reason to refuse a Request the transport may still be able to
    // send". So classification records an EMPTY `requestUrl`, and the transport
    // receives the input object unchanged.
    const cause = new Error("transport refused");
    const fakeRequest = {
      [Symbol.toStringTag]: "Request",
      get url(): string {
        throw new Error("hostile url getter");
      },
    };
    const transport = recordingTransport(() => {
      throw cause;
    });

    const result = await typedFetch(fakeRequest as unknown as Request, { fetch: transport.fetch });

    // The transport got the object itself, not a serialization of it.
    expect(transport.inputs).toEqual([fakeRequest]);
    expect(result.response).toBe(null);
    expect(isNetworkError(result.error)).toBe(true);
    expect(result.error?.cause).toBe(cause);
    // No url could be read, so the correlation field stays empty.
    expect(result.error?.url).toBe("");
  });
});

describe("isKnownHttpError refuses a value whose status cannot be read", () => {
  test("a forged pair of brands over a throwing status getter answers false", async () => {
    // Line 426. A brand forged on the VALUE is accepted by design (ADR 0003,
    // out-of-scope item 5), so both brand reads pass and the guard goes on to
    // the status. The status getter throws, and the catch's documented outcome
    // is "hostile proxies/getters are not valid library errors".
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
 * so whichever one `error.url` reports says which value the transport was
 * handed.
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

  test("passing the ambient fetch explicitly does not widen the request check", async () => {
    // `{ fetch: globalThis.fetch }` is what dependency injection writes:
    // `typedFetch(u, { fetch: injected ?? globalThis.fetch })`. The transport
    // that RUNS is the platform's, so it resolves `RequestInfo` with its own
    // realm-bound brand check and converts this value to a `USVString` — the
    // request goes to the serialization. `error.url` must name that same
    // string, exactly as it does when the option is absent.
    const { error } = await typedFetch(taggedForeignRequest(), { fetch: ambient });

    expect(isNetworkError(error)).toBe(true);
    expect(error?.url).toBe("https://actually-sent.invalid/serialized");
  });

  test("a replaced global fetch is caller code and takes the tagged input", async () => {
    // The other direction of the same question. Installing a Fetch
    // implementation on the global is how a polyfill is adopted, and that
    // implementation writes its own rule about what it accepts as a request —
    // only the caller can pair its `Request` with the copy of `fetch` that
    // shipped with it. The setup phase must hand the value over rather than
    // serialize it behind the caller's back.
    const tagged = taggedForeignRequest();
    const transport = recordingTransport(() => new Response(null, { status: 204 }));
    globalThis.fetch = transport.fetch;

    const result = await typedFetch(tagged);

    expect(result.error).toBe(null);
    expect(transport.inputs).toEqual([tagged]);
  });
});
