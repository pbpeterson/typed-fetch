import { describe, test, expect, expectTypeOf, vi } from "vitest";
import { createRequire } from "node:module";
import { useTestServer } from "../../fixtures/http-server";
import { allErrors } from "../../fixtures/error-roster";
import { everyChannel } from "../../fixtures/channels";
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "../../src/index";
import {
  AbortedError,
  BadGatewayError,
  BadRequestError,
  BaseHttpError,
  ConflictError,
  ExpectationFailedError,
  FailedDependencyError,
  ForbiddenError,
  GatewayTimeoutError,
  GoneError,
  HttpVersionNotSupportedError,
  ImATeapotError,
  InsufficientStorageError,
  InternalServerError,
  LengthRequiredError,
  LockedError,
  LoopDetectedError,
  MethodNotAllowedError,
  MisdirectedRequestError,
  NetworkAuthenticationRequiredError,
  NetworkError,
  NotAcceptableError,
  NotExtendedError,
  NotFoundError,
  NotImplementedError,
  PaymentRequiredError,
  PreconditionFailedError,
  PreconditionRequiredError,
  ProxyAuthenticationRequiredError,
  RequestedRangeNotSatisfiableError,
  RequestHeaderFieldsTooLargeError,
  RequestTimeoutError,
  RequestTooLongError,
  RequestUriTooLongError,
  ServiceUnavailableError,
  TimeoutError,
  TooEarlyError,
  TooManyRequestsError,
  UnauthorizedError,
  UnavailableForLegalReasonsError,
  UnknownHttpError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  UpgradeRequiredError,
  VariantAlsoNegotiatesError,
} from "../../src/errors";
import {
  RequestTooLongError as PublicRequestTooLongError,
  typedFetch as publicTypedFetch,
  UnprocessableEntityError as PublicUnprocessableEntityError,
  type TypedFetchOptions,
} from "../../index";

// THE ENVELOPE, END TO END.
//
// `typedFetch`'s own promise: a request failure is a VALUE, and the value is a
// projection of the three phases. This file drives the whole call, against a
// real server or a real platform behaviour, and it is deliberately no longer
// the place a PHASE is tested. Each phase has its own interface and its own
// spec directory:
//
//   SETUP     `src/request-plan.ts`      → `tests/request/`
//   TRANSPORT `src/request-failure.ts`   → `tests/request/`
//   RESPONSE  `src/response-verdict.ts`  → `tests/response/`
//
// A test belongs here when it needs something no phase seam can supply: a
// socket, the ambient `fetch`, the 40-class roster, the platform refusing a
// caller's own value, or the `{ response, error }` shape itself. CONTEXT.md
// states the rule — the interface is the test surface, and needing to test PAST
// an interface means the module is the wrong shape.
//
// Two envelope subjects live beside this file rather than in it, because each
// is about a whole call rather than about what one phase decides:
// `transport-abort-window.spec.ts` owns which PHASE a failure belongs to, and
// `conformance.spec.ts` owns ADR 0003's row-by-row untrusted-`fetch` boundary.

const { url } = useTestServer();

const nodeRequire = createRequire(import.meta.url);
const nodeFetchModule = nodeRequire("node-fetch") as {
  Request: new (input: string) => Request;
};
const NodeFetchRequest = nodeFetchModule.Request;

describe("typedFetch", () => {
  test("200 returns { response, error: null }", async () => {
    const result = await typedFetch<{ id: number }>(
      url({ status: 200, body: JSON.stringify({ id: 1 }) }),
    );

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(200);

    const data = await result.response?.json();
    expect(data).toEqual({ id: 1 });
  });

  test("response.json() is typed", async () => {
    const body = JSON.stringify({ users: [{ id: 1 }, { id: 2 }] });
    const result = await typedFetch<{ users: { id: number }[] }>(url({ status: 200, body }));

    const data = await result.response?.json();
    expect(data?.users).toHaveLength(2);
    expect(data?.users[0]?.id).toBe(1);
  });

  test("accepts a URL instance like fetch", async () => {
    const result = await typedFetch<{ id: number }>(
      new URL(url({ status: 200, body: JSON.stringify({ id: 7 }) })),
    );

    expect(result.error).toBe(null);
    expect(await result.response?.json()).toEqual({ id: 7 });
  });

  test("accepts a Request object like fetch", async () => {
    const result = await typedFetch(new Request(url({ status: 404 })));

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NotFoundError);
  });

  test("forwards request options to fetch", async () => {
    const body = JSON.stringify({ name: "test" });
    const result = await typedFetch(url({ status: 200, echoHeader: "Content-Type" }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(200);
    // The server echoes all three options back, so assert each one arrived. A
    // 200 alone is also what a request that dropped every option receives.
    expect(result.response?.headers.get("X-Echo-Method")).toBe("POST");
    expect(result.response?.headers.get("X-Echo-Header")).toBe("application/json");
    const echoedBody = result.response?.headers.get("X-Echo-Body");
    expect(echoedBody && decodeURIComponent(echoedBody)).toBe(body);
  });

  test("accepts a custom fetch implementation, bypassing the global fetch", async () => {
    const stubFetch = vi.fn(
      async () => new Response(null, { status: 404, statusText: "Not Found" }),
    );

    const result = await typedFetch("https://example.invalid/should-not-be-hit", {
      fetch: stubFetch as unknown as typeof fetch,
    });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NotFoundError);
  });

  // The transport override is read as an OWN property only. `fetch` is this
  // library's own extension, not a WebIDL dictionary member, so the platform's
  // rule for inherited members is not the rule for this one. An inherited
  // `fetch` is neither used nor stripped: it stays on the object, and the
  // platform ignores it.
  //
  // The plan's own answer is `request-plan.spec.ts`'s "an inherited fetch is
  // neither used nor stripped". This case is the other half of it: the request
  // really went out over the ambient transport, and the inherited `method` —
  // which IS a WebIDL member — really reached the server.
  test("ignores an inherited fetch override and sends the request itself", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const options = Object.create({ fetch: stubFetch, method: "POST" }) as TypedFetchOptions;

    const result = await typedFetch(url({ status: 200 }), options);

    expect(stubFetch).not.toHaveBeenCalled();
    // The request really went out over the global fetch — and the inherited
    // `method` still reached it, because THAT one is a WebIDL member.
    expect(result.error).toBe(null);
    expect(result.response?.headers.get("X-Echo-Method")).toBe("POST");
  });

  // A single prototype-pollution write anywhere in the process must not be able
  // to choose who performs the request. Reading the override off the prototype
  // chain made `Object.prototype.fetch = attacker` redirect EVERY call in the
  // process — including one that passes no options object at all, whose default
  // `{}` inherits the property — and hand the attacker the caller's headers.
  // `defineProperty` with `enumerable: false` keeps the polluted property out of
  // every `for…in` in the worker; the gadget itself is a plain property read, so
  // the enumerability changes nothing about what is being tested.
  test("a polluted Object.prototype.fetch cannot hijack a request", async () => {
    const attacker = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ forged: true }), { status: 200 }),
    );
    // oxlint-disable-next-line no-extend-native -- polluting it IS the test
    Object.defineProperty(Object.prototype, "fetch", {
      value: attacker,
      writable: true,
      configurable: true,
      enumerable: false,
    });

    try {
      const real = JSON.stringify({ real: true });
      const noOptions = await typedFetch<{ real: boolean }>(url({ status: 200, body: real }));
      const withCredentials = await typedFetch<{ real: boolean }>(
        url({ status: 200, body: real }),
        { headers: { Authorization: "Bearer VICTIM_SESSION_TOKEN" } },
      );

      expect(attacker).not.toHaveBeenCalled();
      expect(noOptions.error).toBe(null);
      expect(withCredentials.error).toBe(null);
      // Read both bodies: the real server answered, and nothing leaks.
      expect(await noOptions.response?.json()).toEqual({ real: true });
      expect(await withCredentials.response?.json()).toEqual({ real: true });
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).fetch;
    }
  });

  // The `method` getter runs inside the platform's fetch, not inside this
  // library. Fetch converts `init` as a WebIDL dictionary, and WebIDL
  // propagates an exception thrown by a member getter out of that conversion.
  // `fetch()` then rejects with that exact value, so `cause` holds `cause` by
  // identity under any conforming runtime. `toBe` pins the specification here,
  // not undici. If a runtime ever wraps the value, that wrapping is the
  // finding, and this assertion must report it.
  test("turns a throwing RequestInit getter into a NetworkError value", async () => {
    const cause = new Error("method getter exploded");
    const options = Object.defineProperty({}, "method", {
      enumerable: true,
      get() {
        throw cause;
      },
    }) as TypedFetchOptions;

    const result = await typedFetch("data:text/plain,ok", options);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  // ── error.url names the request the transport actually made ─────────────
  // The input is serialized ONCE, and the transport gets what that produced.
  // The setup phase accepts a TAG, but the platform's `RequestInfo` union does
  // not: it uses its own realm-bound brand check and converts everything else
  // with `USVString`. Passing a tagged value through therefore did not prevent
  // the serialization, it only moved it somewhere that reports nothing back.
  //
  // Every case below needs a REAL third-party `Request` — node-fetch@2's, which
  // tags itself and stringifies to `"[object Request]"` — or the real ambient
  // transport's brand check. The rule stated over synthetic inputs lives at the
  // seam, in `request-plan.spec.ts`'s "the single serialization" and in
  // `request-transport-selection.spec.ts`.
  describe("a Request the platform will not accept as one", () => {
    test("node-fetch@2's Request does not make error.url name an untouched server", async () => {
      // No hostile object anywhere: node-fetch tags its Request
      // `[object Request]` and stringifies to `"[object Request]"`, so undici
      // rejects with `Failed to parse URL from [object Request]` and the
      // request never leaves the process. The live server below answers 200 and
      // must not be named as the failure's URL.
      const live = url({ status: 200 });

      const result = await typedFetch(new NodeFetchRequest(live));

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.url).not.toBe(live);
      expect(result.error?.url).toBe("[object Request]");
    });

    test("a real same-realm Request is still handed over unchanged", async () => {
      // The exception the serialization rule exists for: a Request carries a
      // body, a signal, and internal slots no string can stand for.
      const request = new Request(url({ status: 404 }));

      const result = await typedFetch(request);

      if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
      expect(result.error.status).toBe(404);
      // The Request's own resolved href, not a second serialization of it.
      expect(result.error.url).toBe(request.url);
      await result.error.cancel();
    });

    // The own key and the running transport are two different questions.
    // `fetch: undefined` is allowed by the public type and is what
    // `{ fetch: maybeOverride }` or a spread of defaults produces. It leaves
    // the AMBIENT transport in place, so the wide tag check must not be used.
    test.each([
      ["an explicit undefined", { fetch: undefined }],
      ["a null override", { fetch: null as unknown as undefined }],
      ["a non-callable override", { fetch: 42 as unknown as undefined }],
    ])("%s leaves the platform's own rule in force", async (_label, options) => {
      const live = url({ status: 200 });

      const result = await typedFetch(new NodeFetchRequest(live), options);

      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.url).not.toBe(live);
      expect(result.error?.url).toBe("[object Request]");
    });

    test("a custom transport keeps the wider tag check — it writes its own rule", async () => {
      // Only the caller can pair a duplicated runtime's `Request` with the copy
      // of `fetch` that shipped with it, so an override is trusted to accept
      // what it was given.
      let received: unknown;
      const request = new NodeFetchRequest(url({ status: 200 }));

      await typedFetch(request, {
        fetch: (async (input: unknown) => {
          received = input;
          throw new Error("transport refused");
        }) as unknown as typeof fetch,
      });

      expect(received).toBe(request);
    });

    // `error.url` is the only thing that tells two concurrent failures apart,
    // so it must survive a setup that fails while reading `options`. Nothing in
    // the input classification reads `options`, which is what lets it run
    // first.
    describe("a failing options read does not cost error.url", () => {
      test("`options: null` still names the request", async () => {
        // An ordinary consumer slip in plain JS. `Object.hasOwn(null, "fetch")`
        // throws, and the correlation used to go with it.
        const result = await typedFetch("https://example.invalid/null-options", {
          ...(null as unknown as object),
        } as never);
        expect(result.error).toBeInstanceOf(NetworkError);

        const withNull = await typedFetch(
          "https://example.invalid/null-options",
          null as unknown as undefined,
        );
        expect(withNull.error).toBeInstanceOf(NetworkError);
        expect(withNull.error?.url).toBe("https://example.invalid/null-options");
      });

      test("an options object whose own-key test throws still names the request", async () => {
        const hostile = new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error("descriptor refused");
            },
          },
        );

        const result = await typedFetch("https://example.invalid/hostile-options", hostile);

        expect(result.error).toBeInstanceOf(NetworkError);
        expect(result.error?.url).toBe("https://example.invalid/hostile-options");
      });

      test("a Request input keeps its own url when the options read throws", async () => {
        const hostile = new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error("descriptor refused");
            },
          },
        );
        const request = new Request("https://example.invalid/request-options");

        const result = await typedFetch(request, hostile);

        expect(result.error).toBeInstanceOf(NetworkError);
        expect(result.error?.url).toBe(request.url);
      });
    });

    // ADR 0003, row H-26: a request input read twice cannot split the request
    // from the error. The verdict came from the input's own
    // `Symbol.toStringTag`, and it was reached twice — once to pick what the
    // transport receives, once to pick the signal `classifyRequestFailure`
    // treats as authoritative. The input got to answer each one separately.
    test("one input, one verdict — a second read cannot invent a governing signal", async () => {
      let tagReads = 0;
      const neverGoverned = AbortSignal.abort();
      const input = {
        get [Symbol.toStringTag](): string {
          tagReads += 1;
          // Read 1: not a Request, so the transport gets a bare URL string that
          // no signal governs. Read 2 used to say Request, handing the
          // classifier a signal for a request that never had one.
          return tagReads === 1 ? "Object" : "Request";
        },
        toString: () => "https://example.invalid/one-verdict",
        signal: neverGoverned,
      };

      const result = await typedFetch(input as unknown as string, {
        // README, "Abort classification": an error named `AbortError` stays a
        // `NetworkError` when no signal reports an abort.
        fetch: (async () => {
          throw new DOMException("Aborted", "AbortError");
        }) as unknown as typeof fetch,
      });

      expect(isAbortError(result.error)).toBe(false);
      expect(isNetworkError(result.error)).toBe(true);
      expect(tagReads).toBe(1);
    });
  });

  // ── A refused request part never reaches the error ──────────────────────
  // The platform reports a header it refused by quoting the part back, and
  // that message used to be copied verbatim into `NetworkError.message`. The
  // message is a library constant now, so the shapes below can no longer
  // disclose anything through it. They stay because each one is a distinct
  // `HeadersInit` form the transport reads, and because a future change that
  // put a platform message back would reopen every one of them at once.
  test.each([
    ["a record", (v: string) => ({ authorization: v })],
    ["an array of pairs", (v: string) => [["authorization", v]] as [string, string][]],
    // The platform NORMALIZES leading and trailing HTTP whitespace away before
    // it validates, and quotes the normalized value back. A key read from a
    // file has exactly this shape.
    ["a record whose value is padded", (v: string) => ({ authorization: `\t${v}\n` })],
    [
      "an array of pairs whose value is padded",
      (v: string) => [["authorization", ` ${v}\r\n`]] as [string, string][],
    ],
    // WebIDL converts a non-string to a ByteString with `String()`. A JavaScript
    // caller reaches this by forwarding Node's `string | string[]` headers.
    ["a record whose value is not a string", (v: string) => ({ authorization: [v] })],
    // A `sequence` is converted through the value's OWN iterator, so an inner
    // pair need not be an `Array`.
    ["an inner pair that is a Set", (v: string) => [new Set(["authorization", v])]],
    [
      "an inner pair that is a Map's entry iterator",
      (v: string) => [new Map([["authorization", v]]).entries().next().value],
    ],
    // WebIDL builds a record from ANY object, and a function is an object.
    [
      "a callable carrying own enumerable properties",
      (v: string) => Object.assign(function noop() {}, { authorization: v }),
    ],
  ])("a refused header value supplied as %s stays out of every channel", async (_label, make) => {
    // A wrapped base64 credential: the LF is what makes the platform refuse it,
    // and refusal is the only way a header value reaches a message at all.
    const secret = "Basic AAAA\nsk_live_END_TO_END_SECRET";

    const result = await typedFetch("https://example.invalid/refused-header", {
      headers: make(secret) as never,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_END_TO_END_SECRET");
  });

  test.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["NUL", "\0"],
  ])(
    "a header value refused for an interior %s stays out of every channel",
    async (_label, char) => {
      const result = await typedFetch("https://example.invalid/refused-header", {
        headers: { authorization: `Basic AAAA${char}sk_live_CONTROL_CHAR_SECRET` },
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expectNoDisclosure(result.error, "sk_live_CONTROL_CHAR_SECRET");
    },
  );

  // A NAME is refused on the same footing as a value, and the platform quotes
  // it back the same way. A name is not usually a credential, so this is the
  // log-forging half of the hazard rather than the disclosure half.
  const refusedNames = [
    ["an interior CRLF", "X-Foo\r\nSet-Cookie: session=NAME_SECRET"],
    ["a leading LF", "\nX-NAME_SECRET"],
    ["a trailing LF", "X-NAME_SECRET\n"],
    ["a leading CR", "\rX-NAME_SECRET"],
    ["a trailing CR", "X-NAME_SECRET\r"],
  ] as const;
  const refusedNameContainers = [
    ["a record", (n: string) => ({ [n]: "v" })],
    ["an array of pairs", (n: string) => [[n, "v"]]],
    ["an inner pair that is a Set", (n: string) => [new Set([n, "v"])]],
  ] as const;

  test.each(
    refusedNameContainers.flatMap(([container, make]) =>
      refusedNames.map(([position, name]) => [position, container, name, make] as const),
    ),
  )(
    "a header name refused for %s, supplied as %s, cannot forge a log line",
    async (_position, _container, name, make) => {
      const result = await typedFetch("https://example.invalid/refused-header", {
        headers: make(name) as never,
      });

      expect(result.error).toBeInstanceOf(NetworkError);
      expectNoDisclosure(result.error, "NAME_SECRET");
    },
  );

  test("a name the platform refuses for something else is not echoed either", async () => {
    // The old rule struck a part out of the platform's message and had to
    // decide which parts were worth striking. There is no such rule now: the
    // message is a library constant whatever the platform refused, and the
    // diagnostic lives in `error.cause`.
    const result = await typedFetch("https://example.invalid/refused-header", {
      headers: { "X REFUSED_NAME_SENTINEL": "v" } as never,
    });

    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.message).toBe("Network error");
    expectNoDisclosure(result.error, "REFUSED_NAME_SENTINEL");
    expect(String(result.error?.cause)).toContain("REFUSED_NAME_SENTINEL");
  });

  test("a ONE-SHOT inner pair reaches the transport intact", async () => {
    // The library used to materialize an exotic iterable before the transport,
    // so the failure path could read it a second time. It does not read it at
    // all now, and the transport must still receive the pair it was given.
    const secret = "Basic AAAA\nsk_live_ONE_SHOT_INNER";
    const pair = (function* () {
      yield "authorization";
      yield secret;
    })();

    const result = await typedFetch("https://example.invalid/refused-header", {
      headers: [pair] as never,
    });

    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_ONE_SHOT_INNER");
    expect(String(result.error?.cause)).toContain("sk_live_ONE_SHOT_INNER");
  });

  test("a ONE-SHOT outer header container on a frozen options object", async () => {
    // A frozen options object makes the original `headers` descriptor
    // non-configurable and non-writable, so replacing its value through a Proxy
    // whose target is the original object violates the Proxy get invariant.
    // Nothing replaces it now, which is why this shape is ordinary again.
    const secret = "Basic AAAA\nsk_live_ONE_SHOT_OUTER_SECRET";
    const headers = [["authorization", secret]] as [string, string][];
    const oneShotIterator = headers[Symbol.iterator]();
    Object.defineProperty(headers, Symbol.iterator, {
      value: () => oneShotIterator,
    });

    const options = Object.freeze({ headers });
    const result = await typedFetch("https://example.invalid/refused-header", options);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_ONE_SHOT_OUTER_SECRET");
  });

  test("a headers getter that throws resolves as an error value", async () => {
    // The transport reads the slot, and its exception is one more thing the
    // envelope absorbs rather than re-raises.
    const options = {
      get headers(): never {
        throw new Error("hostile headers getter");
      },
    };

    const result = await typedFetch("https://example.invalid/hostile-headers", options as never);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
  });

  // ── The response phase, from the caller's side ──────────────────────────
  // What a resolved value BECOMES — a foreign polyfill accepted, a hostile
  // getter refused, a body released, the first successful identity read fixed —
  // is `classifyResolvedValue`'s answer, and it is tested at that seam:
  // `tests/response/response-value-acceptance.spec.ts` and
  // `tests/response/response-identity-recording.spec.ts`. Around 700 lines of
  // this file used to reach that module by injecting a `fetch` that resolved a
  // prepared value and reading the verdict back out of the envelope.
  //
  // What stays is what a real request answers with.

  test("hardened response inspection keeps normal classification intact", async () => {
    const notFound = await typedFetch(url({ status: 404 }));
    expect(notFound.error).toBeInstanceOf(NotFoundError);

    const unknown = await typedFetch(url({ status: 499 }));
    expect(unknown.error).toBeInstanceOf(UnknownHttpError);

    const ok = await typedFetch(url({ status: 204 }));
    expect(ok.error).toBe(null);
    expect(ok.response?.status).toBe(204);
  });

  test("omitting fetch still uses the global fetch (test server)", async () => {
    const result = await typedFetch(url({ status: 200, body: JSON.stringify({ id: 1 }) }));

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(200);
  });

  const errorCases = [
    { status: 400, Class: BadRequestError },
    { status: 401, Class: UnauthorizedError },
    { status: 402, Class: PaymentRequiredError },
    { status: 403, Class: ForbiddenError },
    { status: 404, Class: NotFoundError },
    { status: 405, Class: MethodNotAllowedError },
    { status: 406, Class: NotAcceptableError },
    // 407 is tested separately — Node's fetch rejects it as a network error
    { status: 408, Class: RequestTimeoutError },
    { status: 409, Class: ConflictError },
    { status: 410, Class: GoneError },
    { status: 411, Class: LengthRequiredError },
    { status: 412, Class: PreconditionFailedError },
    { status: 413, Class: RequestTooLongError },
    { status: 414, Class: RequestUriTooLongError },
    { status: 415, Class: UnsupportedMediaTypeError },
    { status: 416, Class: RequestedRangeNotSatisfiableError },
    { status: 417, Class: ExpectationFailedError },
    { status: 418, Class: ImATeapotError },
    { status: 421, Class: MisdirectedRequestError },
    { status: 422, Class: UnprocessableEntityError },
    { status: 423, Class: LockedError },
    { status: 424, Class: FailedDependencyError },
    { status: 425, Class: TooEarlyError },
    { status: 426, Class: UpgradeRequiredError },
    { status: 428, Class: PreconditionRequiredError },
    { status: 429, Class: TooManyRequestsError },
    { status: 431, Class: RequestHeaderFieldsTooLargeError },
    { status: 451, Class: UnavailableForLegalReasonsError },
    { status: 500, Class: InternalServerError },
    { status: 501, Class: NotImplementedError },
    { status: 502, Class: BadGatewayError },
    { status: 503, Class: ServiceUnavailableError },
    { status: 504, Class: GatewayTimeoutError },
    { status: 505, Class: HttpVersionNotSupportedError },
    { status: 506, Class: VariantAlsoNegotiatesError },
    { status: 507, Class: InsufficientStorageError },
    { status: 508, Class: LoopDetectedError },
    { status: 510, Class: NotExtendedError },
    { status: 511, Class: NetworkAuthenticationRequiredError },
  ];

  test.each(errorCases)("$status → $Class.name", async ({ status, Class }) => {
    const result = await typedFetch(url({ status }));

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(Class);

    if (isHttpError(result.error)) {
      expect(result.error.status).toBe(status);
    }
  });

  // CONTRIBUTING.md said outright: "Omitting the errorCases row fails no test."
  // This is that enforcement. `allErrors` is the independently hand-authored
  // roster, so this compares two sources of truth rather than deriving one from
  // the other.
  test("errorCases covers the whole roster, except the documented 407 exception", () => {
    // Node's fetch rejects a 407 at the network level, so it can never reach a
    // live test.each request. It is covered by direct construction below.
    // Exactly ONE exception exists today. A second one must be added here
    // deliberately, not by loosening this filter.
    const PROXY_AUTHENTICATION_REQUIRED = 407;

    const covered = new Map(errorCases.map((row) => [row.status, row.Class]));
    const missing = allErrors
      .map((row) => row.status)
      .filter((status) => status !== PROXY_AUTHENTICATION_REQUIRED && !covered.has(status));

    expect(
      missing,
      `errorCases is missing status ${missing.join(", ")}. Add the row to the errorCases ` +
        `table above — see CONTRIBUTING.md, "Adding a new HTTP status code".`,
    ).toEqual([]);

    // Catches a STALE row too: one left behind after a class left the roster.
    expect(covered.size + 1).toBe(allErrors.length);

    // Status alone is not enough — catch a row that pairs a status with the
    // wrong class.
    for (const { status, Class } of allErrors) {
      if (status === PROXY_AUTHENTICATION_REQUIRED) continue;
      expect(covered.get(status), `errorCases maps status ${status} to the wrong class`).toBe(
        Class,
      );
    }
  });

  // Node's fetch rejects a 407 at the network level, so 407 is the one roster
  // status no live request can reach. An injected fetch supplies the response
  // instead, which keeps the assertion on the same `statusCodeErrorMap` lookup
  // that every other `errorCases` row exercises. Constructing the class by hand
  // proves only what error-classes.spec.ts already proves for all 40 classes,
  // and proves nothing about the lookup.
  test("407 → ProxyAuthenticationRequiredError (injected fetch; Node rejects a live 407)", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 407 }));

    const result = await typedFetch("https://example.invalid/proxy-authentication", {
      fetch: stubFetch as unknown as typeof fetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(ProxyAuthenticationRequiredError);
    expect(isHttpError(result.error)).toBe(true);

    if (isHttpError(result.error)) {
      expect(result.error.status).toBe(407);
    }
  });

  test("unmapped 2xx status codes pass through as a successful response", async () => {
    const result = await typedFetch(url({ status: 299 }));

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);
  });

  test("413 and 422 expose their RFC 9110 reason phrases", () => {
    expect(PublicRequestTooLongError.statusText).toBe("Content Too Large");
    expect(PublicUnprocessableEntityError.statusText).toBe("Unprocessable Content");
  });

  test("204 stays on the success branch while json() preserves native empty-body rejection", async () => {
    const result = await publicTypedFetch(url({ status: 204 }));

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);

    if (result.response) {
      expect(result.response.status).toBe(204);
      expect(result.response.ok).toBe(true);
      expect(await result.response.clone().text()).toBe("");
      await expect(result.response.json()).rejects.toBeInstanceOf(SyntaxError);
    }
  });

  test("status-0 Response.error() stays on the success branch", async () => {
    const errorResponse = Response.error();
    const result = await typedFetch("https://example.test/status-zero", {
      fetch: async () => errorResponse,
    });

    // Status 0 is below 400, so the call takes the success branch and the
    // caller receives the SAME Response object. Identity is the whole
    // assertion. A further read would read the object this test built, and
    // would report on `Response.error()` instead of on this library. The 204
    // test above covers native empty-body behavior, on a response that did
    // travel through typedFetch.
    expect(result.error).toBe(null);
    expect(result.response).toBe(errorResponse);
  });

  test("unmapped 4xx status → UnknownHttpError", async () => {
    const result = await typedFetch(url({ status: 420 }));

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(UnknownHttpError);

    if (isHttpError(result.error)) {
      expect(result.error.status).toBe(420);
    }
  });

  test("unmapped 5xx status → UnknownHttpError with body access", async () => {
    const body = JSON.stringify({ reason: "custom failure" });
    const result = await typedFetch(url({ status: 599, body }));

    expect(result.error).toBeInstanceOf(UnknownHttpError);
    expect(result.error).toBeInstanceOf(BaseHttpError);

    if (isHttpError(result.error)) {
      expect(result.error.status).toBe(599);
      expect(await result.error.json()).toEqual({ reason: "custom failure" });
    }
  });

  test("3xx with redirect: 'manual' is not an error", async () => {
    const result = await typedFetch(url({ status: 302, header: "Location:/elsewhere" }), {
      redirect: "manual",
    });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(302);
  });

  // Integration check for a real transport failure. It proves the
  // classification — a refused connection is a NetworkError, not an abort and
  // not a timeout — and that a cause survives the trip. It cannot prove WHICH
  // cause: the runtime owns the rejection, so no assertion here can hold a
  // reference to it. `cause` identity is proven at the classifier's own seam in
  // request-failure.spec.ts, and through an injected fetch above.
  test("connection refused → NetworkError carrying a cause", async () => {
    const result = await typedFetch("http://localhost:1");

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);

    if (isNetworkError(result.error)) {
      expect(result.error.cause).toBeDefined();
    }
  });

  // Detection keys on `signal.aborted`, not the rejection's `.name`. A caller
  // may pass ANY reason to `controller.abort(reason)` — a documented Web API
  // pattern — and fetch then rejects with that reason (whose `.name` is
  // usually NOT "AbortError"). The signal is the authority; `error.reason`
  // carries whatever the caller passed so the consumer decides what it means.
  test("abort(reason) with an Error reason → AbortedError; reason is that exact Error", async () => {
    const controller = new AbortController();
    const reason = new Error("route change");
    controller.abort(reason);

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(AbortedError);
    expect(isAbortError(result.error)).toBe(true);
    expect(isNetworkError(result.error)).toBe(false);

    if (isAbortError(result.error)) {
      expect(result.error.reason).toBe(reason);
    }
  });

  test("bare abort() → AbortedError; reason is a DOMException named 'AbortError'", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(AbortedError);

    if (isAbortError(result.error)) {
      expect(result.error.reason).toBeInstanceOf(DOMException);
      expect((result.error.reason as DOMException).name).toBe("AbortError");
    }
  });

  test("abort('just a string') → AbortedError; reason is that string (non-Error reason)", async () => {
    const controller = new AbortController();
    controller.abort("just a string");

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(AbortedError);

    if (isAbortError(result.error)) {
      expect(result.error.reason).toBe("just a string");
    }
  });

  test("the signal snapshot prevents native fetch from downgrading an abort", async () => {
    const governing = new AbortController();
    const later = new AbortController();
    const reason = new Error("route change");
    governing.abort(reason);

    let reads = 0;
    const options = {
      get signal() {
        reads += 1;
        return reads === 1 ? governing.signal : later.signal;
      },
    } as unknown as TypedFetchOptions;

    const result = await typedFetch("data:text/plain,ok", options);

    expect(reads).toBe(1);
    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(AbortedError);
    expect(isNetworkError(result.error)).toBe(false);

    if (isAbortError(result.error)) {
      expect(result.error.reason).toBe(reason);
    }
  });

  test("the signal snapshot prevents a later abort from governing native fetch", async () => {
    const governing = new AbortController();
    const later = new AbortController();
    const laterReason = new Error("must stay ignored");
    later.abort(laterReason);

    let reads = 0;
    const options = {
      get signal() {
        reads += 1;
        return reads === 1 ? governing.signal : later.signal;
      },
    } as unknown as TypedFetchOptions;

    const result = await typedFetch("data:text/plain,ok", options);

    expect(reads).toBe(1);
    expect(result.error).toBe(null);
    expect(await result.response?.text()).toBe("ok");
  });

  test("AbortSignal.timeout() against a slow route → TimeoutError, not NetworkError", async () => {
    const result = await typedFetch(url({ status: 200, delay: 200 }), {
      signal: AbortSignal.timeout(1),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(result.error)).toBe(true);
    expect(isNetworkError(result.error)).toBe(false);

    if (isTimeoutError(result.error)) {
      // cause is the signal's reason: a DOMException named "TimeoutError".
      expect((result.error.cause as Error).name).toBe("TimeoutError");
    }
  });

  test("isNetworkError returns false for aborted and timed-out requests (intended 1.0 break)", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortedResult = await typedFetch(url({ status: 200 }), { signal: controller.signal });
    expect(isNetworkError(abortedResult.error)).toBe(false);

    const timedOutResult = await typedFetch(url({ status: 200, delay: 200 }), {
      signal: AbortSignal.timeout(1),
    });
    expect(isNetworkError(timedOutResult.error)).toBe(false);
  });

  // AXIS 1 (the bug this fix closes): a caller forges a plain `Error` with
  // `name === "TimeoutError"` as the abort reason. Timeout classification must
  // NOT key on that forgeable name — it must be an AbortedError, and the
  // caller's meaningful reason must survive on `error.reason` (not be demoted
  // to `cause`). Mirror of the already-fixed `err.name === "AbortError"` bug,
  // on the `reason.name` axis instead of the `err.name` axis.
  test("abort(Error named 'TimeoutError') → AbortedError, reason preserved, NOT a timeout", async () => {
    const controller = new AbortController();
    const forged = Object.assign(new Error("user cancelled checkout"), {
      name: "TimeoutError",
    });
    controller.abort(forged);

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(AbortedError);
    expect(isAbortError(result.error)).toBe(true);
    expect(isTimeoutError(result.error)).toBe(false);

    if (isAbortError(result.error)) {
      // The caller's reason is the authority and MUST be preserved verbatim.
      expect(result.error.reason).toBe(forged);
    }
  });

  // AXIS 2: a *forged DOMException* named "TimeoutError". A DOMException named
  // "TimeoutError" is EXACTLY what a real `AbortSignal.timeout()` produces —
  // there is no in-band signal that distinguishes a hand-built one from the
  // platform's. We accept it as a TimeoutError and document that honestly: the
  // classification is "the shape the platform produces", and a caller who
  // hand-builds that exact shape is opting into that classification. (Contrast
  // AXIS 1: a plain Error with the name is trivially forgeable and common —
  // a DOMException with a specific name is neither.)
  test("abort(DOMException named 'TimeoutError') → TimeoutError (documented: indistinguishable from a real timeout)", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("forged", "TimeoutError"));

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
  });

  // AXIS 7: AbortSignal.any() composing a user signal and a timeout signal —
  // whichever fires first wins, and classification must follow the actual
  // winner's reason (a DOMException "TimeoutError" vs the user's reason).
  //
  // These two tests are gated because AbortSignal.any() landed in Node 20.3.0
  // and `engines.node` is `>=20`. The floor is correct and stays: nothing in
  // src/ calls AbortSignal.any(), and the newest platform API the library
  // depends on is ReadableStream.cancel(). Only the TEST needs 20.3.0, so the
  // test declares that requirement instead of the package narrowing what
  // consumers may run. On Node 20.0 to 20.2 the API under test does not exist,
  // so there is nothing to assert; vitest reports the two as skipped, not
  // passed. Do not remove the gate without also raising `engines.node` —
  // ungated, the suite throws `TypeError: AbortSignal.any is not a function`
  // on the declared floor. The check reads the capability, never the version
  // number, so it stays correct if the availability of the API changes.
  const hasSignalAny = typeof AbortSignal.any === "function";

  test.skipIf(!hasSignalAny)("AbortSignal.any(): timeout wins → TimeoutError", async () => {
    const userController = new AbortController();
    const combined = AbortSignal.any([userController.signal, AbortSignal.timeout(1)]);

    const result = await typedFetch(url({ status: 200, delay: 200 }), {
      signal: combined,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(result.error)).toBe(true);
  });

  test.skipIf(!hasSignalAny)(
    "AbortSignal.any(): user abort wins → AbortedError with the user's reason",
    async () => {
      const userController = new AbortController();
      const reason = new Error("user navigated away");
      const combined = AbortSignal.any([userController.signal, AbortSignal.timeout(10_000)]);
      userController.abort(reason);

      const result = await typedFetch(url({ status: 200, delay: 200 }), {
        signal: combined,
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      expect(isAbortError(result.error)).toBe(true);
      expect(isTimeoutError(result.error)).toBe(false);
      if (isAbortError(result.error)) {
        expect(result.error.reason).toBe(reason);
      }
    },
  );

  // ── Fix 1b: aborted signal is necessary but NOT sufficient ─────────────
  // A rejection that merely COINCIDES with an already-aborted signal but is not
  // itself the abort (e.g. a TypeError from Request construction) must stay a
  // NetworkError. Only a rejection that IS the abort — `err === signal.reason`
  // — takes the abort path.

  test("pre-aborted signal + method CONNECT (real fetch rejects with a TypeError) → NetworkError", async () => {
    const controller = new AbortController();
    controller.abort();
    // CONNECT is a forbidden method: real fetch throws a TypeError during
    // Request construction, before the abort is ever consulted. The signal is
    // aborted, but the rejection is not the abort → NetworkError.
    const result = await typedFetch(url({ status: 200 }), {
      method: "CONNECT",
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
  });

  // HOW MANY TIMES the input is serialized, and what the transport receives, is
  // `planRequest`'s answer — "the single serialization" in
  // `tests/request/request-plan.spec.ts`. This case is the envelope's half: the
  // setup phase runs before the transport, so an abort raised while the input
  // serializes is an abort that PRECEDES the request, and the classifier must
  // still call it one.
  test("a signal aborted while the URL is serialized governs the request", async () => {
    // A bare `fetch` called with an already-aborted signal rejects with that
    // signal's reason, and this is that same case.
    const controller = new AbortController();
    const reason = new Error("aborted during serialization");
    const input = {
      toString() {
        controller.abort(reason);
        return "https://example.invalid/abort-during-serialization";
      },
    } as unknown as string;
    const stubFetch = vi.fn(async () => Promise.reject(reason)) as unknown as typeof fetch;

    const result = await typedFetch(input, { signal: controller.signal, fetch: stubFetch });

    expect(isAbortError(result.error)).toBe(true);
    expect((result.error as AbortedError).reason).toBe(reason);
  });

  // ── Fix 1c: `signal: null` detaches a url-slot Request's signal ────────

  test("signal:null detaches a url-slot Request's aborted signal → NetworkError, not AbortedError", async () => {
    const controller = new AbortController();
    controller.abort();
    // The Request in the url slot carries an already-aborted signal, but the
    // options pass `signal: null`, which per the fetch spec DETACHES it — no
    // signal governs the call.
    //
    // The rejection is the Request signal's OWN reason, which is what makes
    // this test load-bearing: it satisfies the `err === reason` arm for anyone
    // who resolves the signal wrongly. A detach implemented as
    // `init.signal ?? url.signal` would resolve the aborted signal here and
    // classify this as AbortedError. Rejecting with an unrelated error instead
    // would pass either way, proving nothing about the detach.
    const request = new Request(url({ status: 200 }), { signal: controller.signal });
    const stubFetch = vi.fn(async () =>
      Promise.reject(controller.signal.reason),
    ) as unknown as typeof fetch;

    const result = await typedFetch(request, {
      signal: null,
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
  });

  test("explicit signal:undefined falls back to the url-slot Request's pre-aborted signal → AbortedError", async () => {
    const controller = new AbortController();
    controller.abort();
    // WebIDL treats an explicit `undefined` dictionary member as absent, so
    // `signal: undefined` is NOT a detach — it falls back to the Request's own
    // signal, which is pre-aborted. Real fetch rejects with that signal's
    // reason, so this is an AbortedError.
    const request = new Request(url({ status: 200 }), { signal: controller.signal });

    const result = await typedFetch(request, { signal: undefined });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(AbortedError);
    expect(isAbortError(result.error)).toBe(true);
    expect(isNetworkError(result.error)).toBe(false);
  });

  // ── Fix 1d: realm-safe DOMException detection for timeout classification ─
  // A cross-realm DOMException fails `instanceof DOMException` (its constructor
  // is bound to another realm), so timeout classification must key on the
  // platform-set `Symbol.toStringTag` instead. A hand-built object carrying
  // that tag and name === "TimeoutError" is indistinguishable from a real
  // cross-realm timeout, so we accept it as a TimeoutError — the same
  // documented forgeability tradeoff as `new DOMException("", "TimeoutError")`.
  test("abort(cross-realm-shaped DOMException named 'TimeoutError') → TimeoutError", async () => {
    const controller = new AbortController();
    // Not a real DOMException instance: `instanceof DOMException` is false, but
    // `Object.prototype.toString` reports "[object DOMException]" via the tag.
    const forgedCrossRealm = {
      name: "TimeoutError",
      [Symbol.toStringTag]: "DOMException",
    };
    controller.abort(forgedCrossRealm);

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
  });

  // ── Fix 2: error.url on pre-response errors ────────────────────────────
  // AXIS 8 + 9: url is populated on NetworkError / AbortedError / TimeoutError,
  // and is correct whether the request input was a string, a URL, or a Request.

  test("AXIS 8: NetworkError carries the request url (connection refused)", async () => {
    const target = "http://localhost:1/some/path";
    const result = await typedFetch(target);

    expect(result.error).toBeInstanceOf(NetworkError);
    if (isNetworkError(result.error)) {
      expect(result.error.url).toBe(target);
    }
  });

  test("AXIS 8: AbortedError carries the request url", async () => {
    const controller = new AbortController();
    controller.abort();
    const target = url({ status: 200 });

    const result = await typedFetch(target, { signal: controller.signal });

    expect(result.error).toBeInstanceOf(AbortedError);
    if (isAbortError(result.error)) {
      expect(result.error.url).toBe(target);
    }
  });

  test("AXIS 8: TimeoutError carries the request url", async () => {
    const target = url({ status: 200, delay: 200 });

    const result = await typedFetch(target, { signal: AbortSignal.timeout(1) });

    expect(result.error).toBeInstanceOf(TimeoutError);
    if (isTimeoutError(result.error)) {
      expect(result.error.url).toBe(target);
    }
  });

  test("AXIS 9: url is correct for a string input (NetworkError)", async () => {
    const target = "http://localhost:1/string-input";
    const result = await typedFetch(target);
    if (isNetworkError(result.error)) {
      expect(result.error.url).toBe(target);
    } else {
      throw new Error("expected NetworkError");
    }
  });

  test("AXIS 9: url is correct for a URL-object input (NetworkError)", async () => {
    const target = new URL("http://localhost:1/url-input");
    const result = await typedFetch(target);
    if (isNetworkError(result.error)) {
      // String(URL) is its href (absolute, trailing-normalized).
      expect(result.error.url).toBe(target.href);
    } else {
      throw new Error("expected NetworkError");
    }
  });

  test("AXIS 9: url is correct for a Request input (NetworkError)", async () => {
    const target = "http://localhost:1/request-input";
    const request = new Request(target);
    const result = await typedFetch(request);
    if (isNetworkError(result.error)) {
      // Request.url is the resolved absolute URL.
      expect(result.error.url).toBe(request.url);
      expect(result.error.url).toBe(target);
    } else {
      throw new Error("expected NetworkError");
    }
  });

  test("HTTP errors capture the status and request url structurally", async () => {
    const requestUrl = url({ status: 404 });
    const result = await typedFetch(requestUrl);

    expect(result.error).toBeInstanceOf(NotFoundError);

    if (isHttpError(result.error)) {
      expect(result.error.status).toBe(404);
      expect(result.error.url).toBe(new URL(requestUrl).toString());
      expect(result.error.url).toContain("localhost");
      // Characterizes the URL-bearing constructor branch. Message wording is
      // regression-tested here but remains outside the SemVer contract.
      expect(result.error.message).toContain("localhost");
    }
  });

  test("BaseHttpError takes the no-url message branch when response.url is empty", () => {
    // A directly-constructed Response has `url === ""`, so BaseHttpError's
    // `response.url ? `${line} (${url})` : line` branch takes the no-url path.
    const error = new NotFoundError(new Response(null, { status: 404, statusText: "Not Found" }));

    expect(error.url).toBe("");
    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
    // Characterizes the no-URL branch without making message text a public
    // SemVer guarantee.
    expect(error.message).toBe('HTTP 404 "Not Found"');
  });

  test("error.json() parses the response body", async () => {
    const body = JSON.stringify({ message: "Validation failed", field: "email" });
    const result = await typedFetch(url({ status: 400, body }));

    expect(result.error).toBeInstanceOf(BadRequestError);

    if (isHttpError(result.error)) {
      const json = await result.error.json();
      expect(json).toEqual({ message: "Validation failed", field: "email" });
    }
  });

  test("error.text() returns the raw body", async () => {
    const result = await typedFetch(url({ status: 404, body: "Not Found" }));

    expect(result.error).toBeInstanceOf(NotFoundError);

    if (isHttpError(result.error)) {
      expect(await result.error.text()).toBe("Not Found");
    }
  });

  test("error.headers exposes response headers", async () => {
    const result = await typedFetch(url({ status: 429, header: "Retry-After:60" }));

    expect(result.error).toBeInstanceOf(TooManyRequestsError);

    if (isHttpError(result.error)) {
      expect(result.error.headers.get("Retry-After")).toBe("60");
    }
  });

  test("error.clone() allows reading the body twice", async () => {
    const body = JSON.stringify({ error: "bad request" });
    const result = await typedFetch(url({ status: 400, body }));

    // Assert the branch is REACHED before narrowing into it. Without this, a
    // regression that returns a success (or the wrong error kind) makes the
    // whole test body unreachable and it still reports green.
    expect(result.error).toBeInstanceOf(BadRequestError);
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");

    const cloned = result.error.clone();

    expect(await result.error.json()).toEqual({ error: "bad request" });
    expect(await cloned.json()).toEqual({ error: "bad request" });
  });

  // ── P1-07: enumerated coverage gaps ──────────────────────────────────

  test("error.clone().blob() and error.clone().arrayBuffer() resolve for a 400 with a body", async () => {
    const result = await typedFetch(url({ status: 400, body: JSON.stringify({ a: 1 }) }));

    expect(result.error).toBeInstanceOf(BadRequestError);

    if (isHttpError(result.error)) {
      const clonedForBlob = result.error.clone();
      const clonedForArrayBuffer = result.error.clone();

      const blob = await clonedForBlob.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);

      const arrayBuffer = await clonedForArrayBuffer.arrayBuffer();
      expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    }
  });

  test("BaseHttpError omits the reason phrase when response.statusText is empty", () => {
    // A real node:http server does carry an empty reason phrase over the
    // wire (verified: `res.writeHead(404, "")` + undici fetch yields
    // `response.statusText === ""`), so this path IS reachable end-to-end.
    // We construct the Response directly here per the documented fallback.
    //
    // ACCEPTED EXCEPTION to RELEASING.md's "never assert on .message" policy:
    // BaseHttpError keys the reason-phrase branch off the *wire* value
    // `response.statusText`, but it does NOT expose that wire value as a field.
    // `error.statusText` is the hardcoded canonical phrase ("Not Found") and is
    // identical whether or not the wire phrase was present, so it cannot
    // distinguish this branch. `response` is protected. Therefore the empty-
    // wire-statusText branch has NO structural observable other than the
    // constructed message. This test knowingly depends on .message for that one
    // branch; the `error.url === ""` assertion below stays structural.
    const error = new NotFoundError(new Response(null, { status: 404, statusText: "" }));

    expect(error.url).toBe("");
    expect(error.status).toBe(404);
    expect(error.message).toBe("HTTP 404"); // accepted exception: only observable of this branch (see comment above)
  });

  test("redirect: 'error' mode surfaces as NetworkError", async () => {
    const result = await typedFetch(url({ status: 302, header: "Location:/elsewhere" }), {
      redirect: "error",
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);

    if (isNetworkError(result.error)) {
      expect(result.error.cause).toBeDefined();
    }
  });

  test("arbitrary method string round-trips to the server", async () => {
    const requestUrl = url({ status: 200 });
    const result = await typedFetch(requestUrl, { method: "REPORT" });

    expect(result.error).toBe(null);
    expect(result.response?.headers.get("X-Echo-Method")).toBe("REPORT");
  });

  test("arbitrary method string round-trips through an injected fetch stub", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await typedFetch("https://example.invalid/method-stub", {
      method: "REPORT",
      fetch: stubFetch as unknown as typeof fetch,
    });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [, init] = stubFetch.mock.calls[0] ?? [];
    expect(init).toMatchObject({ method: "REPORT" });
  });

  // ── The `headers` option reaches the wire ──────────────────────────────
  // This library never reads, normalizes, or rebuilds `headers`. The value of
  // that is that whatever the caller passes arrives at the server unchanged,
  // and only a real server can prove it. Each test below asks the fixture to
  // echo the received header back. An assertion on the init object handed to an
  // injected fetch cannot prove it, because that fetch opens no connection.
  //
  // Three forms, because `RequestInit.headers` is a union and fetch converts
  // each form on its own path: a record, a `Headers` instance, and an array of
  // name/value tuple pairs.
  //
  // That the facade forwards each of the three BY IDENTITY — the other half of
  // the same claim, and the one an injected fetch CAN answer — is
  // `request-plan.spec.ts`'s "the facade forwards a headers %s BY IDENTITY".

  test("TypedHeaders accepts a record and it reaches the server", async () => {
    const headers = { "X-Custom-Header": "from-a-record" };

    const result = await typedFetch(url({ status: 200, echoHeader: "X-Custom-Header" }), {
      headers,
    });

    expect(result.error).toBe(null);
    expect(result.response?.headers.get("X-Echo-Header")).toBe("from-a-record");
    expectTypeOf(headers).toExtend<TypedFetchOptions["headers"]>();
  });

  test("TypedHeaders accepts a Headers instance and it reaches the server", async () => {
    const headers = new Headers();
    headers.set("X-Custom-Header", "from-a-headers-instance");

    const result = await typedFetch(url({ status: 200, echoHeader: "X-Custom-Header" }), {
      headers,
    });

    expect(result.error).toBe(null);
    expect(result.response?.headers.get("X-Echo-Header")).toBe("from-a-headers-instance");
    expectTypeOf(headers).toExtend<TypedFetchOptions["headers"]>();
  });

  test("TypedHeaders accepts tuple pairs and they reach the server", async () => {
    const headers: [string, string][] = [["X-Custom-Header", "from-tuple-pairs"]];

    const result = await typedFetch(url({ status: 200, echoHeader: "X-Custom-Header" }), {
      headers,
    });

    expect(result.error).toBe(null);
    expect(result.response?.headers.get("X-Echo-Header")).toBe("from-tuple-pairs");
    expectTypeOf(headers).toExtend<TypedFetchOptions["headers"]>();
  });

  // ── Request objects passed as `options` keep their WebIDL state ─────────
  // A `Request`'s `method`/`headers`/`body`/`signal` are prototype getters,
  // not own enumerable properties. When a `Request` is passed in the `options`
  // slot, object rest spread (`...init`) copies NONE of them, silently
  // downgrading every request to a bodyless, header-less GET and dropping the
  // abort signal. The proxy delegates to the original Request, except that it
  // materializes the governing signal. These tests prove that no WebIDL state
  // is lost.
  describe("Request passed as the options argument keeps its WebIDL state", () => {
    test("an augmented Request can carry a fetch override without losing WebIDL state", async () => {
      const target = url({ status: 200 });
      const stubFetch = vi.fn<typeof fetch>((input, init) => fetch(input, init));
      const options = Object.assign(new Request(target, { method: "POST" }), {
        fetch: stubFetch,
      }) as TypedFetchOptions;

      const result = await typedFetch(target, options);

      expect(result.error).toBe(null);
      expect(result.response?.headers.get("X-Echo-Method")).toBe("POST");
      expect(stubFetch).toHaveBeenCalledTimes(1);
      const [, init] = stubFetch.mock.calls[0] ?? [];
      expect(init).toBeInstanceOf(Request);
      expect(init && "fetch" in init).toBe(false);
    });

    test("Request-like options without an instanceof link preserve their signal", async () => {
      const target = url({ status: 200 });
      const controller = new AbortController();
      const reason = new Error("proxied Request cancel");
      controller.abort(reason);
      const request = new Request(target, { signal: controller.signal });
      const proxiedRequest = new Proxy(request, {
        get(targetRequest, property) {
          return Reflect.get(targetRequest, property, targetRequest);
        },
        getPrototypeOf() {
          return null;
        },
      });

      const result = await typedFetch(target, proxiedRequest);

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      if (isAbortError(result.error)) expect(result.error.reason).toBe(reason);
    });

    test("Request method reaches the server", async () => {
      const target = url({ status: 200 });
      const result = await typedFetch(target, new Request(target, { method: "POST" }));

      expect(result.error).toBe(null);
      expect(result.response?.headers.get("X-Echo-Method")).toBe("POST");
    });

    test("Request headers reach the server", async () => {
      const target = url({ status: 200, echoHeader: "X-Custom" });
      const result = await typedFetch(
        target,
        new Request(target, { method: "POST", headers: { "X-Custom": "hi" } }),
      );

      expect(result.error).toBe(null);
      expect(result.response?.headers.get("X-Echo-Header")).toBe("hi");
    });

    test("Request body reaches the server", async () => {
      const target = url({ status: 200 });
      const result = await typedFetch(
        target,
        new Request(target, { method: "POST", body: "payload" }),
      );

      expect(result.error).toBe(null);
      const echoed = result.response?.headers.get("X-Echo-Body");
      expect(echoed && decodeURIComponent(echoed)).toBe("payload");
    });

    test("pre-aborted signal via Request → AbortedError", async () => {
      const target = url({ status: 200 });
      const controller = new AbortController();
      const reason = new Error("cancel");
      controller.abort(reason);

      const result = await typedFetch(target, new Request(target, { signal: controller.signal }));

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      expect(isNetworkError(result.error)).toBe(false);

      if (isAbortError(result.error)) {
        expect(result.error.reason).toBe(reason);
      }
    });

    test("live abort mid-flight via Request → AbortedError", async () => {
      const target = url({ status: 200, delay: 200 });
      const controller = new AbortController();
      const promise = typedFetch(target, new Request(target, { signal: controller.signal }));
      setTimeout(() => controller.abort(new Error("mid-flight")), 10);

      const result = await promise;

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      expect(isNetworkError(result.error)).toBe(false);
    });

    test("AbortSignal.timeout() via Request → TimeoutError", async () => {
      const target = url({ status: 200, delay: 200 });
      const result = await typedFetch(
        target,
        new Request(target, { signal: AbortSignal.timeout(1) }),
      );

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(isNetworkError(result.error)).toBe(false);
    });
  });

  // ── AbortSignal carried by a Request in the URL slot ──────────────────
  // The canonical fetch pattern — `fetch(new Request(url, { signal }))` — used
  // by service workers, middleware, and request factories, puts the Request in
  // the FIRST argument. Its `signal` is a prototype getter on `url`, not on
  // `init`, so keying abort/timeout classification off `init.signal` alone
  // misses it entirely and misclassifies every cancellation as a NetworkError.
  // The signal must be resolved from wherever it actually lives.
  describe("AbortSignal carried by a Request in the url slot is honored", () => {
    test("Request-like URL without an instanceof link is still classified", async () => {
      const target = url({ status: 200 });
      const controller = new AbortController();
      const reason = new Error("cross-realm cancel");
      controller.abort(reason);
      const request = new Request(target, { signal: controller.signal });
      const crossRealmRequest = new Proxy(request, {
        get(targetRequest, property) {
          return Reflect.get(targetRequest, property, targetRequest);
        },
        getPrototypeOf() {
          return null;
        },
      });
      const stubFetch = vi.fn(async () => Promise.reject(reason)) as unknown as typeof fetch;

      const result = await typedFetch(crossRealmRequest, { fetch: stubFetch });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      if (isAbortError(result.error)) {
        expect(result.error.reason).toBe(reason);
        expect(result.error.url).toBe(request.url);
      }
    });

    test("pre-aborted signal via Request in url slot → AbortedError; reason is the abort reason", async () => {
      const target = url({ status: 200 });
      const controller = new AbortController();
      const reason = new Error("cancel");
      controller.abort(reason);

      const result = await typedFetch(new Request(target, { signal: controller.signal }));

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      expect(isNetworkError(result.error)).toBe(false);

      if (isAbortError(result.error)) {
        expect(result.error.reason).toBe(reason);
      }
    });

    test("mid-flight abort via Request in url slot → AbortedError", async () => {
      const target = url({ status: 200, delay: 200 });
      const controller = new AbortController();
      const promise = typedFetch(new Request(target, { signal: controller.signal }));
      setTimeout(() => controller.abort(new Error("mid-flight")), 10);

      const result = await promise;

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      expect(isNetworkError(result.error)).toBe(false);
    });

    test("AbortSignal.timeout() via Request in url slot → TimeoutError", async () => {
      const target = url({ status: 200, delay: 200 });

      const result = await typedFetch(new Request(target, { signal: AbortSignal.timeout(1) }));

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(isTimeoutError(result.error)).toBe(true);
      expect(isNetworkError(result.error)).toBe(false);
    });

    // Precedence matches native `fetch(request, init)`: an `init.signal`
    // OVERRIDES the Request's own signal entirely. Verified against native
    // fetch — when both are present, only `init.signal` governs the request;
    // the Request's signal is ignored even if it later aborts.
    test("precedence: init.signal overrides the Request's signal (only init.signal aborts)", async () => {
      const target = url({ status: 200, delay: 200 });
      const requestSignalController = new AbortController(); // signalA — must be ignored
      const initSignalController = new AbortController(); // signalB — the authority
      const reason = new Error("init-signal-wins");

      const promise = typedFetch(new Request(target, { signal: requestSignalController.signal }), {
        signal: initSignalController.signal,
      });
      // Abort ONLY the init signal (B). The Request's signal (A) never fires.
      setTimeout(() => initSignalController.abort(reason), 10);

      const result = await promise;

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(AbortedError);
      expect(isNetworkError(result.error)).toBe(false);

      if (isAbortError(result.error)) {
        expect(result.error.reason).toBe(reason);
      }
    });

    // Precedence inverse: when `init.signal` is passed, the Request's own
    // signal (A) is ignored even if IT aborts — native fetch drops it entirely
    // (verified: aborting the Request's signal while init.signal is present and
    // never fires lets the request complete normally). So this succeeds.
    test("precedence inverse: aborting the Request's signal does nothing when init.signal is passed", async () => {
      const target = url({ status: 200, delay: 50 });
      const requestSignalController = new AbortController(); // signalA — the Request's, aborts
      const initSignalController = new AbortController(); // signalB — passed, never fires

      const promise = typedFetch(new Request(target, { signal: requestSignalController.signal }), {
        signal: initSignalController.signal,
      });
      // Abort the Request's signal (A). Native fetch ignores it because
      // init.signal (B) took over; the request completes normally.
      setTimeout(() => requestSignalController.abort(new Error("ignored")), 10);

      const result = await promise;

      expect(result.error).toBe(null);
      expect(result.response?.status).toBe(200);
    });

    test("Request in url slot with NO signal, connection refused → NetworkError", async () => {
      const result = await typedFetch(new Request("http://localhost:1"));

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(isNetworkError(result.error)).toBe(true);
      expect(isAbortError(result.error)).toBe(false);
    });
  });
});

// ── Reflected request data never reaches an automatic channel ────────────
//
// The platform reports a request it refused by QUOTING the caller's value
// back: a header name or value, the URL, the referrer, the method, an enum
// slot. That message is copied into `NetworkError.message`, and from there
// into every channel a reader sees by default.
//
// Redacting the echo cannot work. It requires reading the caller's value a
// SECOND time, after the transport already consumed it, and every value below
// answers differently on the second read. A getter, a `toString`, and a
// mutable pair member each defeat the search string. The values that are not
// header parts — the URL, the referrer, the method — were never redacted at
// all.
//
// So the assertion is about the MESSAGE, not about a redaction: no request
// input reaches a channel a reader gets without asking for a member by name.
// The platform's own text stays reachable through `error.cause`, which a caller
// reads deliberately.
/**
 * The channels a caller reaches without naming a member, plus `stack`.
 *
 * This used to be an EIGHTH hand-written channel harness — `fixtures/channels.ts`
 * already says seven copies of it had drifted apart, and CONTEXT.md states the
 * rule they broke: **a disclosure decision applies to the channel set, never to
 * one channel.** So the set comes from the shared inventory now, and a channel
 * added there arrives here without an edit.
 *
 * TWO of the seven are removed, by name and with the reason, because this
 * assertion is about a sentinel that is deliberately REACHABLE on `error.cause`:
 * channel 6 (`structuredClone`) and channel 7 (the fatal-exception printer) are
 * the two platform algorithms with no hook, and CONTEXT.md records `cause`
 * surviving both as a standing residual. Asking them here would assert against
 * a residual the library states rather than against this rule.
 *
 * `stack` is added for the same reason the old copy carried it: it is not a
 * channel of its own — `util.inspect` prints it — but a message copied into a
 * synthesised stack would show here first.
 */
function automaticChannels(error: unknown): readonly string[] {
  const value = error as Error;
  const rendered = everyChannel(value);
  const withoutResiduals = Object.entries(rendered)
    .filter(([channel]) => !channel.startsWith("6 ") && !channel.startsWith("7 "))
    .map(([, text]) => text);
  return [...withoutResiduals, value.stack ?? ""];
}

function expectNoDisclosure(error: unknown, sentinel: string): void {
  for (const rendered of automaticChannels(error)) {
    expect(rendered, `a channel emitted ${sentinel}`).not.toContain(sentinel);
  }
  // The control characters are asserted on the two channels that are ONE line.
  // A stack is many lines by construction, and `util.inspect` prints it, so a
  // line-break assertion there tests the stack rather than the message.
  // `JSON.stringify` escapes a break into two characters.
  const message = (error as Error).message;
  for (const rendered of [message, String(error)]) {
    expect(rendered, "a channel emitted a raw line break").not.toContain("\n");
    expect(rendered, "a channel emitted a raw carriage return").not.toContain("\r");
    expect(rendered, "a channel emitted a raw NUL").not.toContain("\0");
  }
}

describe("typedFetch — reflected request data stays out of the automatic channels", () => {
  test("a header value read from a record getter that changes its answer", async () => {
    // The redactor read this getter a second time, after the transport had
    // already been refused, and was handed a different value. The search
    // string it built therefore matched nothing in the message.
    const secret = "Basic AAAA\nsk_live_RECORD_GETTER";
    let reads = 0;
    const headers = {
      get authorization(): string {
        reads += 1;
        return reads === 1 ? secret : "Bearer harmless";
      },
    };

    const result = await typedFetch("https://example.invalid/record-getter", {
      headers: headers as never,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_RECORD_GETTER");
    // The escape hatch. `cause` is the platform's own error, read on purpose.
    expect(String(result.error?.cause)).toContain("sk_live_RECORD_GETTER");
  });

  test("a header pair read from an outer array index that changes its answer", async () => {
    // The library inspects the outer container before the transport, to decide
    // whether it can be read again. That inspection IS a read, so a getter can
    // answer it with an ordinary pair and answer the transport with a refused
    // one.
    const secret = "Basic AAAA\nsk_live_OUTER_INDEX_GETTER";
    let reads = 0;
    const headers: unknown[] = [];
    Object.defineProperty(headers, 0, {
      configurable: true,
      enumerable: true,
      get(): unknown {
        reads += 1;
        return reads === 2 ? ["authorization", secret] : ["authorization", "Bearer harmless"];
      },
    });

    const result = await typedFetch("https://example.invalid/outer-index-getter", {
      headers: headers as never,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_OUTER_INDEX_GETTER");
  });

  test("a header value read from an inner pair index that changes its answer", async () => {
    const secret = "Basic AAAA\nsk_live_INNER_INDEX_GETTER";
    let reads = 0;
    const pair: unknown[] = ["authorization"];
    Object.defineProperty(pair, 1, {
      configurable: true,
      enumerable: true,
      get(): unknown {
        reads += 1;
        return reads === 1 ? secret : "Bearer harmless";
      },
    });

    const result = await typedFetch("https://example.invalid/inner-index-getter", {
      headers: [pair] as never,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_INNER_INDEX_GETTER");
  });

  test("a header value whose toString changes its answer", async () => {
    // WebIDL converts a header value with `ToString`. The collector performs
    // the same conversion a second time, so a `toString` with state hands the
    // transport one value and the redactor another.
    const secret = "Basic AAAA\nsk_live_VALUE_TO_STRING";
    let reads = 0;
    const value = {
      toString(): string {
        reads += 1;
        return reads === 1 ? secret : "Bearer harmless";
      },
    };

    const result = await typedFetch("https://example.invalid/value-to-string", {
      headers: { authorization: value } as never,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "sk_live_VALUE_TO_STRING");
  });

  test("a request input whose toString changes its answer", async () => {
    // undici quotes a credentialed URL back in full. `NetworkError` strikes
    // out the URL it was TOLD about, and the input was serialized a second
    // time to obtain it, so a `toString` with state defeats that too.
    let reads = 0;
    const input = {
      toString(): string {
        reads += 1;
        return reads === 1
          ? "https://alice:hunter2_URL_TO_STRING@example.invalid/first"
          : "https://example.invalid/second";
      },
    };

    const result = await typedFetch(input as unknown as string);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "hunter2_URL_TO_STRING");
  });

  test("a referrer that carries a credential", async () => {
    // The referrer is a second URL slot, and it was never redacted at all:
    // `NetworkError` strikes out the REQUEST url, which this is not.
    const result = await typedFetch("https://example.invalid/referrer", {
      referrer: "ht!tp://alice:hunter2_REFERRER@ref.test/p",
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "hunter2_REFERRER");
  });

  test("a method that carries a CRLF sequence", async () => {
    // The platform quotes a method it refuses. A raw CRLF in `message` forges
    // a log line, and the forged line is the caller's own text.
    const result = await typedFetch("https://example.invalid/method", {
      method: "GET\r\nX-Injected: METHOD_CRLF_SENTINEL",
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "METHOD_CRLF_SENTINEL");
  });

  test("an enum slot the platform refuses and echoes", async () => {
    // `mode`, `credentials`, `cache`, and `redirect` are echoed by the same
    // rejection message. They can only hold a program constant today, and the
    // set of them grows with the Standard.
    const result = await typedFetch("https://example.invalid/enum", {
      mode: "ENUM_SLOT_SENTINEL" as RequestMode,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expectNoDisclosure(result.error, "ENUM_SLOT_SENTINEL");
  });
});

// ── What the options facade puts on the WIRE ─────────────────────────────
//
// The facade itself — the hidden `fetch` extension, the materialized signal,
// the reflection channels, the frozen/sealed/proxied shapes — is a decision
// `planRequest` reaches synchronously, and it is tested at that seam in
// `tests/request/request-plan.spec.ts` under "the init the transport reads".
//
// What is left here is the half no seam can answer: an injected `fetch` opens
// no connection, so only a real server can say that the caller's value arrived
// unchanged. `request-init-fidelity.spec.ts` states the general property over
// 31 init shapes against a bare-`fetch` oracle; these three are the shapes this
// suite found a defect in.

describe("the options facade on the wire", () => {
  test("every options getter runs exactly once, including signal", async () => {
    const reads: Record<string, number> = {};
    const controller = new AbortController();
    const options: Record<string, unknown> = {};
    const slot = (name: string, value: unknown): void => {
      Object.defineProperty(options, name, {
        enumerable: true,
        configurable: true,
        get() {
          reads[name] = (reads[name] ?? 0) + 1;
          return value;
        },
      });
    };
    slot("method", "POST");
    slot("headers", { "x-probe": "kept" });
    slot("signal", controller.signal);

    const { response, error } = await typedFetch(
      url({ echoHeader: "x-probe" }),
      options as TypedFetchOptions,
    );

    expect(error).toBeNull();
    expect(response?.headers.get("X-Echo-Header")).toBe("kept");
    expect(reads).toEqual({ method: 1, headers: 1, signal: 1 });
  });

  test("a header the caller set reaches the wire through a frozen options object", async () => {
    const options = Object.freeze({
      headers: Object.freeze({ "x-probe": "on-the-wire" }),
    }) as TypedFetchOptions;

    const { response, error } = await typedFetch(url({ echoHeader: "x-probe" }), options);

    expect(error).toBeNull();
    expect(response?.headers.get("X-Echo-Header")).toBe("on-the-wire");
  });

  test("the override branch still puts the caller's method and headers on the wire", async () => {
    const forwarding = ((input: RequestInfo, init?: RequestInit) =>
      globalThis.fetch(input as string, init)) as typeof fetch;
    const options = Object.freeze({
      method: "REPORT",
      headers: Object.freeze({ "x-probe": "through-the-override" }),
      fetch: forwarding,
    }) as TypedFetchOptions;

    const { response, error } = await typedFetch(url({ echoHeader: "x-probe" }), options);

    expect(error).toBeNull();
    expect(response?.headers.get("X-Echo-Method")).toBe("REPORT");
    expect(response?.headers.get("X-Echo-Header")).toBe("through-the-override");
  });
});

// ── A governing signal the platform itself has to accept ─────────────────
//
// Which signal governs a call is `planRequest`'s answer, and it is tested at
// that seam in `tests/request/request-plan.spec.ts` under "the captured
// signal": the read-once rule, the Request/init precedence, and the `null`
// detach. What is left here needs the PLATFORM to be the one holding the
// signal — a value the ambient `fetch` refuses outright, a reason that is
// itself a signal, and an abort raised after the envelope was already decided.

describe("a governing signal the platform itself reads", () => {
  test("a signal that is not an AbortSignal is a network failure, never an abort", async () => {
    const fake = { aborted: true, reason: new DOMException("Aborted", "AbortError") };

    const { error } = await typedFetch(url(), {
      signal: fake as unknown as AbortSignal,
    });

    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
  });

  test("an abort reason that is itself an AbortSignal does not break the envelope", async () => {
    const controller = new AbortController();
    const reason = new AbortController().signal;

    const pending = typedFetch(url({ delay: 250 }), { signal: controller.signal });
    setTimeout(() => controller.abort(reason), 20);
    const { error } = await pending;

    expect(isAbortError(error)).toBe(true);
    expect((error as unknown as { reason: unknown }).reason).toBe(reason);
  });

  test("an abort after the response phase returned changes nothing", async () => {
    const controller = new AbortController();

    const { response, error } = await typedFetch(url(), { signal: controller.signal });
    // The body belongs to the caller now; read it before the abort, because the
    // platform ties an unread body stream to the signal.
    const body = await response?.text();
    controller.abort();

    expect(error).toBeNull();
    expect(response?.status).toBe(200);
    expect(body).toBe("");
  });
});
