import { describe, test, expect, expectTypeOf, vi } from "vitest";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { inspect } from "node:util";
import { useTestServer } from "./fixtures/http-server";
import { allErrors } from "./fixtures/error-roster";
import {
  typedFetch,
  isHttpError,
  isKnownHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
} from "./src/index";
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
} from "./src/errors";
import {
  RequestTooLongError as PublicRequestTooLongError,
  typedFetch as publicTypedFetch,
  UnprocessableEntityError as PublicUnprocessableEntityError,
  type TypedFetchOptions,
} from "./index";

const { url } = useTestServer();

/** An injected fetch that resolves an arbitrary value, `Response` or not. */
const respondingWith = (value: unknown) => (async () => value) as unknown as typeof fetch;

type NodeFetchResponse = Response & { readonly body: Readable };

const nodeRequire = createRequire(import.meta.url);
const nodeFetchModule = nodeRequire("node-fetch") as {
  Response: new (
    body?: unknown,
    init?: { status?: number; headers?: Record<string, string> },
  ) => NodeFetchResponse;
  Request: new (input: string) => Request;
};
const NodeFetchResponse = nodeFetchModule.Response;
const NodeFetchRequest = nodeFetchModule.Request;

// ── typedFetch ───────────────────────────────────────────────────────

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

  test("does not forward the fetch override key into the injected fetch's init", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await typedFetch("https://example.invalid/no-leak", {
      fetch: stubFetch as unknown as typeof fetch,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [input, init] = stubFetch.mock.calls[0] ?? [];
    expect(input).toBe("https://example.invalid/no-leak");
    expect(init).toBeDefined();
    expect(init && "fetch" in init).toBe(false);
    expect(init).toMatchObject({ method: "POST" });
    // The PLAIN READ. The comment below used to claim this was covered while
    // the three assertions after it checked the `has` trap and the sanitized
    // target instead — deleting the `get` trap's `fetch` arm left the whole
    // suite green. `Reflect.get(options, …)` in that trap forwards to the
    // ORIGINAL options object, which does carry the key.
    expect((init as Record<string, unknown> | undefined)?.fetch).toBeUndefined();
    // The proxy traps hide `fetch` from a plain read, but the sanitized target
    // must not carry the descriptor either: reflection over the init object is
    // part of what a fetch implementation may legitimately do.
    expect(Reflect.ownKeys(init as object)).not.toContain("fetch");
    expect(Object.getOwnPropertyDescriptor(init as object, "fetch")).toBeUndefined();
  });

  // Reflection over the init is legitimate, as the test above states, so the
  // init must not contradict itself. The `signal` descriptor was written
  // unconditionally: `Object.keys` and `Reflect.ownKeys` listed a slot that
  // `"signal" in init` — answered from the original object — denied, and a
  // spread grew a `signal: undefined` member the caller never wrote.
  test("the sanitized init invents no signal slot the caller did not have", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await typedFetch("https://example.invalid/no-signal", {
      method: "POST",
      body: "x",
      fetch: stubFetch,
    });

    const [, init] = stubFetch.mock.calls[0] ?? [];
    const seen = init as object;
    expect(Reflect.ownKeys(seen)).toEqual(["method", "body"]);
    expect(Object.keys(seen)).not.toContain("signal");
    expect("signal" in seen).toBe(false);
    expect(Object.hasOwn({ ...(seen as Record<string, unknown>) }, "signal")).toBe(false);
  });

  // An inherited signal has no own descriptor to copy, so testing for one
  // dropped it from the sanitized target — and `{ ...init }` is exactly what a
  // forwarding transport writes. The `get` trap still answered with the signal,
  // so the request ran UNGOVERNED while `classifyRequestFailure` went on
  // treating that signal as the authority.
  test("an inherited signal survives a transport that spreads its init", async () => {
    const controller = new AbortController();
    let spread: RequestInit | undefined;
    const stubFetch = vi.fn<typeof fetch>(async (_input, init) => {
      spread = { ...(init as RequestInit) };
      return new Response(null, { status: 200 });
    });
    const options = Object.assign(
      Object.create({ signal: controller.signal }) as TypedFetchOptions,
      { fetch: stubFetch, method: "POST" as const },
    );

    await typedFetch("https://example.invalid/inherited-signal", options);

    expect(spread?.signal).toBe(controller.signal);
    // And the slot the caller never had is still not invented.
    const bare = await typedFetch("https://example.invalid/no-signal-inherited", {
      method: "POST",
      fetch: stubFetch,
    });
    expect(bare.error).toBe(null);
  });

  test("a caller's own signal slot is still shadowed with the captured value", async () => {
    // The descriptor exists to keep the `get` trap legal when the target holds
    // an own `signal`, so the slot the caller DID write must still be present
    // and must still answer with the value phase 1 captured.
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const controller = new AbortController();

    await typedFetch("https://example.invalid/own-signal", {
      signal: controller.signal,
      fetch: stubFetch,
    });

    const [, init] = stubFetch.mock.calls[0] ?? [];
    expect(Reflect.ownKeys(init as object)).toContain("signal");
    expect(init?.signal).toBe(controller.signal);
    expect("signal" in (init as object)).toBe(true);
  });

  test("preserves inherited RequestInit properties while stripping the fetch override", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const options = Object.assign(Object.create({ method: "POST" }) as TypedFetchOptions, {
      fetch: stubFetch,
    });

    await typedFetch("https://example.invalid/inherited-options", options);

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [, init] = stubFetch.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init && "fetch" in init).toBe(false);
  });

  // The transport override is read as an OWN property only. `fetch` is this
  // library's own extension, not a WebIDL dictionary member, so the platform's
  // rule for inherited members (which the test above pins for `method`) is not
  // the rule for this one. An inherited `fetch` is neither used nor stripped:
  // it stays on the object, and the platform ignores it.
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

  test("an own fetch override wins over an inherited one", async () => {
    const inherited = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));
    const own = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const options = Object.assign(Object.create({ fetch: inherited }) as TypedFetchOptions, {
      fetch: own,
    });

    const result = await typedFetch("https://example.invalid/own-wins", options);

    expect(own).toHaveBeenCalledTimes(1);
    expect(inherited).not.toHaveBeenCalled();
    expect(result.error).toBe(null);
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

  test("preserves prototype getters backed by private state with an own fetch override", async () => {
    const stubFetch = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 200 });
    });
    class OptionsWithPrivateState {
      readonly #method = "POST";

      constructor(readonly fetch: typeof globalThis.fetch) {}

      get method(): string {
        return this.#method;
      }
    }
    const options = new OptionsWithPrivateState(stubFetch) as TypedFetchOptions;

    const result = await typedFetch("https://example.invalid/private-getter", options);

    expect(result.error).toBe(null);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [, init] = stubFetch.mock.calls[0] ?? [];
    expect(init && "fetch" in init).toBe(false);
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

  // Every hostile-response test above uses a NULL body, so none of them can
  // observe what happens to a live one. The envelope catches the throw and
  // reclassifies it, but `res` is scoped to the try — the caller receives
  // `response: null` and never gets a handle to release the body that the
  // network already opened.
  test("a live body is released when constructing the HTTP error throws", async () => {
    const cause = new Error("headers getter exploded");
    const hostileResponse = new Response("payload-that-is-still-open", { status: 404 });
    Object.defineProperty(hostileResponse, "headers", {
      get() {
        throw cause;
      },
    });
    const stubFetch = vi.fn(async () => hostileResponse) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/hostile-headers", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);

    // Nobody can reach this body any more, so typedFetch must have released it.
    expect(hostileResponse.bodyUsed).toBe(true);
  });

  test("body release cannot reclassify an earlier response-inspection failure as an abort", async () => {
    const controller = new AbortController();
    const cause = new Error("status getter exploded");
    const body = new ReadableStream({
      cancel() {
        controller.abort(cause);
      },
    });
    const hostileResponse = new Response(body, { status: 200 });
    Object.defineProperty(hostileResponse, "status", {
      get() {
        throw cause;
      },
    });

    const result = await typedFetch("https://example.invalid/reentrant-release", {
      signal: controller.signal,
      fetch: respondingWith(hostileResponse),
    });

    expect(controller.signal.aborted).toBe(true);
    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
    expect(result.error?.cause).toBe(cause);
  });

  test("turns a throwing fetch-override getter into a NetworkError value", async () => {
    const cause = new Error("fetch getter exploded");
    const options = Object.defineProperty({}, "fetch", {
      get() {
        throw cause;
      },
    }) as TypedFetchOptions;

    const result = await typedFetch("data:text/plain,ok", options);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  // The `Symbol.toPrimitive` trap runs inside the platform's fetch, which
  // converts the request input as a USVString. WebIDL propagates an exception
  // thrown by that conversion, and `fetch()` rejects with the exact value, so
  // `toBe` pins the specification here too, not undici. `url` is this
  // library's own answer: `requestUrl` catches the second throw and returns
  // the empty string.
  test("does not reject while resolving the URL for a NetworkError", async () => {
    const cause = new Error("URL coercion exploded");
    const hostileInput = {
      [Symbol.toPrimitive]() {
        throw cause;
      },
    } as unknown as string;

    const result = await typedFetch(hostileInput);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
    expect(result.error?.url).toBe("");
  });

  // `requestUrl` is total in BOTH directions a request input can fail. The test
  // above covers the throwing one. These cover the quiet one: the tag check
  // accepts anything tagged `[object Request]`, and a genuine subclass can
  // override the getter, so `url` can answer with a value that is not a string
  // without throwing at all. That value used to reach `NetworkError.url` —
  // declared `readonly string` — and flow on into `redactUrl` and `toJSON()`.
  //
  // The two answers differ, and the difference is the point. A platform
  // `Request` is read through `Request.prototype`'s own getter, because that is
  // the value the TRANSPORT uses: undici reads the internal slot and ignores
  // any override or shadowing own property. So a subclass that lies about `url`
  // gets the real one filed against it, and the error names the server the
  // request reached. A merely tagged object is not a platform `Request` at all,
  // so there is no native slot to read and the non-string is dropped.
  test.each([
    [
      "a Request-tagged object",
      (): Request =>
        ({
          [Symbol.toStringTag]: "Request",
          get url() {
            return 42;
          },
        }) as unknown as Request,
      "",
    ],
    [
      "a genuine Request subclass",
      (): Request => {
        class ForeignRequest extends Request {
          override get url(): string {
            return 42 as unknown as string;
          }
        }
        return new ForeignRequest("https://example.invalid/subclass");
      },
      "https://example.invalid/subclass",
    ],
    [
      "a Request with a shadowed url own property",
      (): Request => {
        // The known URL-rewrite workaround in Node adapters, because
        // `Request.prototype.url` is a read-only accessor.
        const request = new Request("https://example.invalid/real-target");
        Object.defineProperty(request, "url", { value: "https://audit-safe.test/harmless" });
        return request;
      },
      "https://example.invalid/real-target",
    ],
  ])(
    "%s yields a string url naming the request the transport made",
    async (_l, make, expectedUrl) => {
      const cause = new Error("transport refused");

      const result = await typedFetch(make(), {
        fetch: (async () => {
          throw cause;
        }) as unknown as typeof fetch,
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.cause).toBe(cause);
      expect(typeof result.error?.url).toBe("string");
      expect(result.error?.url).toBe(expectedUrl);
    },
  );

  test("a Request-shaped input whose url coerces by throwing does not reject", async () => {
    // The quiet failure's sharp edge: `redactUrlInMessage` calls `replaceAll`
    // with the url, which performs ToString on it. A hostile `toString` threw
    // there — inside the catch block, past the point the envelope can absorb
    // it — and `typedFetch` rejected instead of returning an error value.
    const hostileInput = {
      [Symbol.toStringTag]: "Request",
      get url() {
        return {
          toString() {
            throw new Error("hostile toString");
          },
        };
      },
    } as unknown as Request;

    const result = await typedFetch(hostileInput, {
      fetch: (async () => {
        throw new Error("transport refused");
      }) as unknown as typeof fetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.url).toBe("");
  });

  // ── error.url names the request the transport actually made ─────────────
  // The input is serialized ONCE, and the transport gets what that produced.
  // `isRequest` accepts a TAG, but the platform's `RequestInfo` union does not:
  // it uses its own realm-bound brand check and converts everything else with
  // `USVString`. Passing a tagged value through therefore did not prevent the
  // serialization, it only moved it somewhere that reports nothing back.
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

    test("a forged Request tag cannot split the request from the error", async () => {
      const forged = {
        [Symbol.toStringTag]: "Request",
        url: "https://never-requested.invalid/forged",
        toString: () => "https://sent-here.invalid/real",
      } as unknown as Request;

      const result = await typedFetch(forged);

      expect(result.error?.url).toBe("https://sent-here.invalid/real");
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

    test("an own `fetch` key is still stripped from the init when its value is undefined", async () => {
      // The other half of the split: the key is this library's extension and
      // must not reach the transport, whatever it holds.
      const stub = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
      const options = { fetch: undefined, method: "POST" as const };
      Object.defineProperty(options, "fetch", { value: stub, enumerable: true });

      await typedFetch("https://example.invalid/own-key", options);

      const [, init] = stub.mock.calls[0] ?? [];
      expect(init && "fetch" in init).toBe(false);
      expect(Reflect.ownKeys(init as object)).not.toContain("fetch");
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

  // ── Fix 3: the envelope also covers response inspection ────────────────
  // An injected fetch is outside the library's control. A mock that resolves a
  // non-Response, or a Response with a hostile getter, must still surface as an
  // error VALUE — the envelope's whole promise — instead of rejecting.

  test("an injected fetch that resolves a non-Response → NetworkError value, no rejection", async () => {
    const result = await typedFetch("https://example.invalid/undefined-response", {
      fetch: (async () => undefined) as unknown as typeof fetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
  });

  test.each([
    ["an object with a status", { status: 404 }],
    ["a string", "not a response"],
    ["a bare object", {}],
    ["a spoofed Response tag", { status: 200, [Symbol.toStringTag]: "Response" }],
    ["undefined", undefined],
  ])("a custom fetch resolving %s → NetworkError, never a typed success", async (_label, value) => {
    const result = await typedFetch("https://example.invalid/non-response", {
      fetch: respondingWith(value),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
  });

  test("a standards-compatible foreign Response shape stays supported", async () => {
    const polyfill = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://polyfill.test/",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({ source: "polyfill" }),
      text: async () => "polyfill",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch<{ source: string }>("https://example.invalid/polyfill", {
      fetch: respondingWith(polyfill),
    });

    expect(result.error).toBe(null);
    expect(result.response).toBe(polyfill);
    expect(await result.response?.json()).toEqual({ source: "polyfill" });
  });

  test.each([
    ["bodyUsed", "false"],
    ["ok", "true"],
    ["redirected", 0],
    ["status", "200"],
    ["statusText", { text: "OK" }],
    ["type", "invalid"],
    ["url", new URL("https://polyfill.test/")],
  ])(
    "a foreign success with an incompatible %s scalar never escapes as TypedResponse",
    async (field, incompatibleValue) => {
      const polyfill = {
        body: null,
        bodyUsed: false,
        headers: new Headers(),
        ok: true,
        redirected: false,
        status: 200,
        statusText: "OK",
        type: "basic",
        url: "https://polyfill.test/",
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        clone() {
          return this;
        },
        formData: async () => new FormData(),
        json: async () => ({ source: "polyfill" }),
        text: async () => "polyfill",
        [Symbol.toStringTag]: "Response",
        [field]: incompatibleValue,
      } as unknown as Response;

      const result = await typedFetch("https://example.invalid/polyfill-scalars", {
        fetch: respondingWith(polyfill),
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.cause).toBeInstanceOf(TypeError);
    },
  );

  test("a foreign NaN status cannot bypass success-scalar validation", async () => {
    const polyfill = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: "true",
      redirected: false,
      status: Number.NaN,
      statusText: "Unknown",
      type: "basic",
      url: "https://polyfill.test/",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch("https://example.invalid/polyfill-scalars", {
      fetch: respondingWith(polyfill),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
  });

  test("foreign rejection releases the visible inherited body, not an ancestor body", async () => {
    let visibleCancelCalls = 0;
    let ancestorCancelCalls = 0;
    const visibleBody = new ReadableStream<Uint8Array>({
      cancel() {
        visibleCancelCalls += 1;
      },
    });
    const ancestorBody = new ReadableStream<Uint8Array>({
      cancel() {
        ancestorCancelCalls += 1;
      },
    });
    const ancestor = Object.create(null, {
      body: {
        configurable: true,
        get: () => ancestorBody,
      },
    });
    const nearest = Object.create(ancestor, {
      body: {
        configurable: true,
        get: () => visibleBody,
      },
    });
    const polyfill = Object.assign(Object.create(nearest) as object, {
      bodyUsed: false,
      headers: new Headers(),
      ok: "true",
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://polyfill.test/",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    }) as unknown as Response;

    const result = await typedFetch("https://example.invalid/polyfill-body", {
      fetch: respondingWith(polyfill),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(visibleCancelCalls).toBe(1);
    expect(ancestorCancelCalls).toBe(0);
  });

  test("a throwing foreign success scalar getter remains the NetworkError cause", async () => {
    const cause = new Error("ok getter exploded");
    const polyfill = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      get ok(): boolean {
        throw cause;
      },
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://polyfill.test/",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch("https://example.invalid/polyfill-scalars", {
      fetch: respondingWith(polyfill),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  test("a throwing foreign bodyUsed getter remains the NetworkError cause", async () => {
    const cause = new Error("bodyUsed getter exploded");
    const polyfill = {
      body: null,
      get bodyUsed(): boolean {
        throw cause;
      },
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://polyfill.test/",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch("https://example.invalid/polyfill-scalars", {
      fetch: respondingWith(polyfill),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  test.each([
    ["bodyUsed", "false"],
    ["ok", "true"],
    ["redirected", 0],
    ["status", "200"],
    ["statusText", { text: "OK" }],
    ["type", "invalid"],
    ["url", new URL("https://platform.test/")],
  ])(
    "a platform Response with an incompatible own %s scalar never escapes as TypedResponse",
    async (field, incompatibleValue) => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, field, {
        configurable: true,
        value: incompatibleValue,
      });

      const result = await typedFetch("https://example.invalid/platform-scalars", {
        fetch: respondingWith(response),
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.cause).toBeInstanceOf(TypeError);
    },
  );

  test.each([
    ["body", {}],
    ["headers", null],
    ["json", null],
  ])(
    "a platform Response with an incompatible own %s member never escapes as TypedResponse",
    async (field, incompatibleValue) => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, field, {
        configurable: true,
        value: incompatibleValue,
      });

      const result = await typedFetch("https://example.invalid/platform-members", {
        fetch: respondingWith(response),
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.cause).toBeInstanceOf(TypeError);
    },
  );

  test("a platform Response with a replaced prototype never escapes as TypedResponse", async () => {
    const { stream, cancelCalls } = liveBody();
    const response = new Response(stream, { status: 200 });
    const replacement = {};
    Object.setPrototypeOf(response, replacement);

    const result = await typedFetch("https://example.invalid/platform-prototype", {
      fetch: respondingWith(response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
    expect(cancelCalls()).toBe(1);
    expect(Object.getPrototypeOf(response)).toBe(replacement);
  });

  test("a platform Response with a shadowed stream cancel still releases its body", async () => {
    const { stream, cancelCalls } = liveBody();
    const response = new Response(stream, { status: 200 });
    const body = response.body;
    if (!body) throw new Error("expected a response body");
    Object.defineProperty(body, "cancel", {
      configurable: true,
      value: null,
    });

    const result = await typedFetch("https://example.invalid/platform-stream", {
      fetch: respondingWith(response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
    expect(cancelCalls()).toBe(1);
  });

  test("a platform HTTP response with a broken reader never creates an unusable HTTP error", async () => {
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, "json", {
      configurable: true,
      value: null,
    });

    const result = await typedFetch("https://example.invalid/platform-members", {
      fetch: respondingWith(response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
  });

  test("a throwing platform success member getter remains the NetworkError cause", async () => {
    const cause = new Error("headers getter exploded");
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "headers", {
      configurable: true,
      get() {
        throw cause;
      },
    });

    const result = await typedFetch("https://example.invalid/platform-members", {
      fetch: respondingWith(response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  test("a foreign Response records its first successful headers read", async () => {
    const firstHeaders = new Headers({ "x-identity": "first" });
    const secondHeaders = new Headers({ "x-identity": "second" });
    let headerReads = 0;
    const polyfill = {
      body: null,
      bodyUsed: false,
      get headers() {
        headerReads += 1;
        return headerReads === 1 ? firstHeaders : secondHeaders;
      },
      ok: false,
      redirected: false,
      status: 404,
      statusText: "Not Found",
      type: "basic",
      url: "https://polyfill.test/missing",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch("https://example.invalid/polyfill-headers", {
      fetch: respondingWith(polyfill),
    });

    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(isHttpError(result.error) && result.error.headers.get("x-identity")).toBe("first");
    expect(headerReads).toBe(1);
    if (isHttpError(result.error)) await result.error.cancel();
  });

  // `TypedResponse.headers` names the ambient `Headers`, so a member the type
  // promises must be a member the accepted value carries. `getSetCookie` is
  // therefore validated on the SUCCESS path. It has been on
  // `Headers.prototype` since Node 20.0.0, the package floor.
  describe("a success value's headers must carry everything the type promises", () => {
    function polyfillWith(headers: unknown): Response {
      return {
        body: null,
        bodyUsed: false,
        headers,
        ok: true,
        redirected: false,
        status: 200,
        statusText: "OK",
        type: "basic",
        url: "https://polyfill.test/ok",
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        clone() {
          return this;
        },
        formData: async () => new FormData(),
        json: async () => ({}),
        text: async () => "",
        [Symbol.toStringTag]: "Response",
      } as unknown as Response;
    }

    test("a polyfill whose headers lack getSetCookie is refused", async () => {
      const incomplete = new Headers({ "content-type": "application/json" }) as unknown as Record<
        string,
        unknown
      >;
      const withoutGetSetCookie = Object.create(incomplete) as object;
      Object.defineProperty(withoutGetSetCookie, "getSetCookie", { value: undefined });

      const result = await typedFetch("https://example.invalid/no-get-set-cookie", {
        fetch: respondingWith(polyfillWith(withoutGetSetCookie)),
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
    });

    test("a complete polyfill still succeeds, and its headers keep the method", async () => {
      const result = await typedFetch("https://example.invalid/complete-headers", {
        fetch: respondingWith(polyfillWith(new Headers({ "set-cookie": "a=1" }))),
      });

      expect(result.error).toBe(null);
      expect(result.response?.headers.getSetCookie()).toEqual(["a=1"]);
    });
  });

  test("a throwing foreign headers getter remains the NetworkError cause", async () => {
    const cause = new Error("headers getter exploded");
    const polyfill = {
      body: null,
      bodyUsed: false,
      get headers(): Headers {
        throw cause;
      },
      ok: false,
      redirected: false,
      status: 404,
      statusText: "Not Found",
      type: "basic",
      url: "https://polyfill.test/missing",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch("https://example.invalid/polyfill-headers", {
      fetch: respondingWith(polyfill),
    });

    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  test("node-fetch@2 is refused and its Node stream is destroyed", async () => {
    const response = new NodeFetchResponse(Readable.from(["payload"]), { status: 404 });
    const stream = response.body;

    // Close the two obvious surface gaps so this regression reaches the body
    // compatibility check. A Node Readable must not become a typed WHATWG
    // Response merely because an adapter decorates the missing members.
    Object.defineProperties(response, {
      formData: {
        configurable: true,
        value: async () => new FormData(),
      },
      type: {
        configurable: true,
        value: "default",
      },
    });

    const result = await typedFetch("https://example.invalid/node-fetch", {
      fetch: respondingWith(response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
    expect(stream.destroyed).toBe(true);
  });

  // A `Request` carries `body`, `bodyUsed`, `headers`, `url`, and every read
  // method, so the member set has to be the one that separates it from a
  // response: it has no `status`, `statusText`, `ok`, or `redirected`.
  test("a foreign Request shape is refused, not read as a Response", async () => {
    const requestShape = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      method: "GET",
      url: "https://example.invalid/",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    } as unknown as Response;

    const result = await typedFetch("https://example.invalid/request-shape", {
      fetch: respondingWith(requestShape),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBeInstanceOf(TypeError);
  });

  test("a Response whose url getter throws → NetworkError value, no rejection", async () => {
    const cause = new Error("url getter exploded");
    const hostileResponse = new Response(null, { status: 404 });
    Object.defineProperty(hostileResponse, "url", {
      get() {
        throw cause;
      },
    });
    const stubFetch = vi.fn(async () => hostileResponse) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/hostile-response", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  test("a Response whose status getter throws → NetworkError value, no rejection", async () => {
    const cause = new Error("status getter exploded");
    const hostileResponse = new Response(null, { status: 200 });
    Object.defineProperty(hostileResponse, "status", {
      get() {
        throw cause;
      },
    });
    const stubFetch = vi.fn(async () => hostileResponse) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/hostile-status", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

  // The status reads were the last two response reads OUTSIDE a release guard.
  // A `status` getter that throws never reaches the error-class construction,
  // so the throw escapes to the envelope with the body still open and `res`
  // already out of scope. The same two lines read `status` twice, so a getter
  // that shifts could pick a class for a status the branch was never taken on.

  test("a live body is released when the status getter throws", async () => {
    const cause = new Error("status getter exploded");
    let cancelCalls = 0;
    let statusReads = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload-that-is-still-open"));
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const hostileResponse = new Response(stream, { status: 404 });
    Object.defineProperty(hostileResponse, "status", {
      get() {
        statusReads += 1;
        throw cause;
      },
    });
    const stubFetch = vi.fn(async () => hostileResponse) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/hostile-status-live-body", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);

    // Nobody can reach this body any more, so typedFetch must have released it.
    // `bodyUsed` proves the stream was disturbed; the counter proves the
    // release reached the underlying source as a cancel. Both settle before
    // typedFetch resolves, so neither needs a timer.
    expect(hostileResponse.bodyUsed).toBe(true);
    expect(cancelCalls).toBe(1);
    // The status is read ONCE, even on the failing path. A second read here
    // would call a getter that has already reported it cannot answer, and would
    // report the second failure as the cause instead of the first.
    expect(statusReads).toBe(1);
  });

  test("the error class keys on the status the branch was taken on", async () => {
    let reads = 0;
    const hostileResponse = new Response(null, { status: 404 });
    Object.defineProperty(hostileResponse, "status", {
      get() {
        reads += 1;
        return reads === 1 ? 404 : 500;
      },
    });
    const stubFetch = vi.fn(async () => hostileResponse) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/shifting-status", {
      fetch: stubFetch,
    });

    // The 400 branch was taken because the first read said 404. Selecting the
    // class from a later read would answer 500, a status this call never saw.
    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(result.error).not.toBeInstanceOf(InternalServerError);
  });

  test("a failed release does not replace the original cause", async () => {
    const cause = new Error("headers getter exploded");
    const releaseCause = new Error("body getter exploded");
    const hostileResponse = new Response("payload-that-is-still-open", { status: 404 });
    const realBody = hostileResponse.body;
    Object.defineProperty(hostileResponse, "headers", {
      get() {
        throw cause;
      },
    });
    // The body must survive VALIDATION and fail during RELEASE, which is the
    // only arrangement that reaches the property under test. `isResponse`
    // checks the body's shape before it reads any identity field — it must not
    // file a status against a value it is still deciding on — so a getter that
    // threw on its first read would fail validation and become the reported
    // cause itself, never reaching the release path at all.
    let bodyReads = 0;
    Object.defineProperty(hostileResponse, "body", {
      get() {
        bodyReads += 1;
        if (bodyReads > 1) throw releaseCause;
        return realBody;
      },
    });
    const stubFetch = vi.fn(async () => hostileResponse) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/hostile-body-getter", {
      fetch: stubFetch,
    });

    // `body` is one more getter on the same untrusted object. Releasing is best
    // effort, so its failure must not become the reported cause.
    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
  });

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

  test("the request URL is serialized once, before the transport", async () => {
    // The serialization used to happen twice: once inside the transport, and
    // once more on the failure path to fill `error.url`. Caller code therefore
    // ran AFTER the failure, which is why the abort state had to be captured
    // before it. There is no such code now — the input is serialized in the
    // setup phase and the transport receives that exact string.
    let reads = 0;
    const target = "https://example.invalid/serialized-once";
    const input = {
      toString() {
        reads += 1;
        return target;
      },
    } as unknown as string;
    const rejection = new TypeError("unrelated transport failure");
    const seen: unknown[] = [];
    const stubFetch = vi.fn(async (received: unknown) => {
      seen.push(received);
      return Promise.reject(rejection);
    }) as unknown as typeof fetch;

    const result = await typedFetch(input, { fetch: stubFetch });

    expect(reads).toBe(1);
    expect(seen).toEqual([target]);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(rejection);
    expect(result.error?.url).toBe(target);
  });

  test("a URL object is serialized once and the transport receives that string", async () => {
    let reads = 0;
    class CountingUrl extends URL {
      override toString(): string {
        reads += 1;
        return super.toString();
      }
    }
    const input = new CountingUrl("https://example.invalid/counting-url");
    const seen: unknown[] = [];
    const stubFetch = vi.fn(async (received: unknown) => {
      seen.push(received);
      return Promise.reject(new TypeError("unrelated transport failure"));
    }) as unknown as typeof fetch;

    const result = await typedFetch(input, { fetch: stubFetch });

    expect(reads).toBe(1);
    expect(seen).toEqual(["https://example.invalid/counting-url"]);
    expect(result.error?.url).toBe("https://example.invalid/counting-url");
  });

  test("a Request input reaches the transport unchanged", async () => {
    // A Request carries a body, a signal, and internal slots that no string can
    // stand for, so it is the one input that is NOT serialized.
    const request = new Request("https://example.invalid/request-passthrough");
    const seen: unknown[] = [];
    const stubFetch = vi.fn(async (received: unknown) => {
      seen.push(received);
      return Promise.reject(new TypeError("unrelated transport failure"));
    }) as unknown as typeof fetch;

    const result = await typedFetch(request, { fetch: stubFetch });

    expect(seen).toEqual([request]);
    expect(result.error?.url).toBe(request.url);
  });

  test("a signal aborted while the URL is serialized governs the request", async () => {
    // The setup phase runs before the transport, so an abort raised there is an
    // abort that PRECEDES the request. A bare `fetch` called with an
    // already-aborted signal rejects with that signal's reason, and this is
    // that same case.
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
    expect(error.message).toBe("HTTP 404 Not Found");
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

  // `snapshotRequestInit` rebuilds options as a proxy over a descriptor clone.
  // Every header form must survive that rebuild BY IDENTITY, because the proxy
  // delegates each read to the original object. A server observes nothing here:
  // the injected fetch performs no request. This test therefore reads the init.
  test("the fetch override rebuild forwards every headers form by identity", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    const record = { "X-Custom-Header": "from-a-record" };
    await typedFetch("https://example.invalid/headers-record", {
      headers: record,
      fetch: stubFetch as unknown as typeof fetch,
    });

    const headersInstance = new Headers({ "X-Custom-Header": "from-a-headers-instance" });
    await typedFetch("https://example.invalid/headers-instance", {
      headers: headersInstance,
      fetch: stubFetch as unknown as typeof fetch,
    });

    const tuplePairs: [string, string][] = [["X-Custom-Header", "from-tuple-pairs"]];
    await typedFetch("https://example.invalid/headers-tuples", {
      headers: tuplePairs,
      fetch: stubFetch as unknown as typeof fetch,
    });

    expect(stubFetch).toHaveBeenCalledTimes(3);

    const [, initFromRecord] = stubFetch.mock.calls[0] ?? [];
    expect(initFromRecord?.headers).toBe(record);

    const [, initFromHeadersInstance] = stubFetch.mock.calls[1] ?? [];
    expect(initFromHeadersInstance?.headers).toBe(headersInstance);

    const [, initFromTuples] = stubFetch.mock.calls[2] ?? [];
    expect(initFromTuples?.headers).toBe(tuplePairs);
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

// ── The response identity is read ONCE ───────────────────────────────
//
// `status`, `statusText`, and `url` used to be read several times along one
// error-construction path, by three modules that never compared notes. For a
// real `Response` every read agrees, so nothing was visibly wrong. For an
// INJECTED `fetch` — the seam this library documents and invites a consumer to
// use — a getter may answer differently on a second read, and the reads
// disagreed: the class was selected on one value, the message reported a
// second, and `error.status` reported a third.
//
// Every test below counts the reads. An assertion on the value alone would pass
// against code that reads three times and happens to agree, which is exactly
// the code this suite is here to keep out.

/** Wrap a value so the cycling accessor THROWS it instead of returning it. */
class ThrowOnRead {
  constructor(readonly value: unknown) {}
}

const rethrowing = (value: unknown) => new ThrowOnRead(value);

/**
 * A `Response` whose ONE named identity accessor answers with the next value of
 * a list, holding the last value once the list runs out, and counts its reads.
 *
 * Built with `Object.defineProperty` on a real `Response`, matching the hostile
 * response tests above: an own accessor shadows the platform's prototype
 * getter, which is exactly what an instrumentation wrapper or a partial test
 * double looks like from inside this library.
 */
function cyclingResponse(
  field: "status" | "statusText" | "url" | "headers",
  values: readonly unknown[],
  init?: ResponseInit,
  body: BodyInit | null = null,
): { response: Response; reads: () => number } {
  const response = new Response(body, init);
  let reads = 0;
  Object.defineProperty(response, field, {
    configurable: true,
    get() {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      if (value instanceof ThrowOnRead) throw value.value;
      return value;
    },
  });
  return { response, reads: () => reads };
}

/** An injected fetch that resolves one prepared `Response`. */
const resolving = (response: Response) => (async () => response) as unknown as typeof fetch;

/**
 * A body stream that is genuinely open, and that records the release.
 *
 * Every assertion about a released body needs one: a `new Response(null, …)`
 * has no stream, so `bodyUsed` stays `false` forever and a "the body was
 * released" assertion would be silently meaningless.
 */
function liveBody(): { stream: ReadableStream<Uint8Array>; cancelCalls: () => number } {
  let cancelCalls = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload-that-is-still-open"));
    },
    cancel() {
      cancelCalls += 1;
    },
  });
  return { stream, cancelCalls: () => cancelCalls };
}

/**
 * The four-way agreement, asserted in one place: the status the branch was
 * taken on, `error.status`, the number in `error.message`, and
 * `error.toJSON().status`. One response has one identity, so all four are the
 * same value.
 */
function expectIdentityAgrees(error: BaseHttpError, status: number): void {
  expect(error.status).toBe(status);
  expect(error.message.startsWith(`HTTP ${status}`)).toBe(true);
  expect(error.toJSON().status).toBe(status);
}

describe("typedFetch — the first successful identity reads are recorded", () => {
  test("TF-01: the reported cycle 420 -> 200 -> 201 gives one answer, not three", async () => {
    const { response, reads } = cyclingResponse("status", [420, 200, 201], {
      status: 200,
      statusText: "Weird",
    });

    const result = await typedFetch("https://example.invalid/cycling-status", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(UnknownHttpError);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");

    expectIdentityAgrees(result.error, 420);
    expect(result.error.message.startsWith("HTTP 420 Weird")).toBe(true);
    // The class was selected on 420. Before the fix the message said 200 and
    // `error.status` said 201 — three answers for one response.
    expect(result.error.message).not.toContain("200");
    expect(result.error.message).not.toContain("201");
    expect(reads()).toBe(1);
  });

  test("TF-02: a dedicated class's message cannot disagree with its literal", async () => {
    const { response, reads } = cyclingResponse("status", [404, 200, 500], { status: 200 });

    const result = await typedFetch("https://example.invalid/cycling-dedicated", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NotFoundError);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");

    expectIdentityAgrees(result.error, 404);
    expect(result.error.message).not.toContain("HTTP 200");
    expect(result.error.message).not.toContain("HTTP 500");
    expect(reads()).toBe(1);
  });

  test("TF-03: a string status reaches its dedicated class with a numeric status", async () => {
    const { response } = cyclingResponse("status", ["404"]);
    const result = await typedFetch("https://example.invalid/string-status", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NotFoundError);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");

    // It used to resolve as an `UnknownHttpError` carrying the STRING "404",
    // which broke the declared `number` type and made `isKnownHttpError` return
    // false for what is plainly a 404.
    expect(result.error.status).toBe(404);
    expect(typeof result.error.status).toBe("number");
    expect(isKnownHttpError(result.error)).toBe(true);
  });

  const statusConversionRows: Array<{
    label: string;
    status: unknown;
    outcome: "error" | "success" | "network";
    Class?: new (response: Response) => BaseHttpError;
    expected?: number;
  }> = [
    {
      label: '"404" -> NotFoundError',
      status: "404",
      outcome: "error",
      Class: NotFoundError,
      expected: 404,
    },
    {
      label: '"500" -> InternalServerError',
      status: "500",
      outcome: "error",
      Class: InternalServerError,
      expected: 500,
    },
    {
      label: '"599" -> UnknownHttpError',
      status: "599",
      outcome: "error",
      Class: UnknownHttpError,
      expected: 599,
    },
    { label: '"200" cannot escape with a string status', status: "200", outcome: "network" },
    { label: "NaN stays on the success branch", status: NaN, outcome: "success" },
    { label: "-1 stays on the success branch", status: -1, outcome: "success" },
    { label: "true cannot escape as a numeric status", status: true, outcome: "network" },
    { label: "null cannot escape as a numeric status", status: null, outcome: "network" },
    {
      label: "undefined cannot escape as a numeric status",
      status: undefined,
      outcome: "network",
    },
    {
      label: "Infinity -> UnknownHttpError",
      status: Infinity,
      outcome: "error",
      Class: UnknownHttpError,
      expected: Infinity,
    },
    {
      label: "404.7 is NOT truncated into NotFoundError",
      status: 404.7,
      outcome: "error",
      Class: UnknownHttpError,
      expected: 404.7,
    },
    {
      label: "404n -> NotFoundError",
      status: 404n,
      outcome: "error",
      Class: NotFoundError,
      expected: 404,
    },
    {
      label: "an object with valueOf -> NotFoundError",
      status: { valueOf: () => 404 },
      outcome: "error",
      Class: NotFoundError,
      expected: 404,
    },
    { label: "a Symbol status -> NetworkError", status: Symbol("hostile"), outcome: "network" },
  ];

  test.each(statusConversionRows)("TF-04: $label", async ({ status, outcome, Class, expected }) => {
    const { response } = cyclingResponse("status", [status]);
    const result = await typedFetch("https://example.invalid/status-conversion", {
      fetch: resolving(response),
    });

    if (outcome === "success") {
      // A numeric value that compares below 400, or numeric NaN, can satisfy
      // the stable success surface and reaches the caller unchanged.
      expect(result.error).toBe(null);
      return;
    }

    if (outcome === "network") {
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(result.error?.cause).toBeInstanceOf(TypeError);
      return;
    }

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(Class!);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expect(result.error.status).toBe(expected);
    expect(typeof result.error.status).toBe("number");
  });

  test("TF-06: a status getter that throws on the SECOND read never runs twice", async () => {
    const boom = new Error("status getter exploded on the second read");
    // A readable payload, not `liveBody()`: this case asserts that the body is
    // still the ERROR'S — that it was never released — so the test has to be
    // able to read it to the end.
    const { response, reads } = cyclingResponse(
      "status",
      [404, rethrowing(boom)],
      { status: 200 },
      "payload-that-is-still-open",
    );

    const result = await typedFetch("https://example.invalid/second-read-throws", {
      fetch: resolving(response),
    });

    // Before the fix the second read happened inside the constructor, so this
    // resolved with a NetworkError and the body was released out from under a
    // consumer who was owed a NotFoundError.
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(result.error).not.toBeInstanceOf(NetworkError);
    expect(reads()).toBe(1);

    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expect(await result.error.text()).toBe("payload-that-is-still-open");
  });

  test("TF-07: the class with a THIRD read survives a getter that throws twice", async () => {
    const boom = new Error("status getter exploded");
    const { response, reads } = cyclingResponse(
      "status",
      [599, rethrowing(boom), rethrowing(boom)],
      { status: 200 },
      "payload-that-is-still-open",
    );

    const result = await typedFetch("https://example.invalid/third-read-throws", {
      fetch: resolving(response),
    });

    // `UnknownHttpError` is the class where all three reads used to happen.
    expect(result.error).toBeInstanceOf(UnknownHttpError);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expect(result.error.status).toBe(599);
    expect(reads()).toBe(1);
    expect(await result.error.text()).toBe("payload-that-is-still-open");
  });

  test("TF-08: a statusText getter that throws on the FIRST read releases the live body", async () => {
    const cause = new Error("statusText getter exploded");
    const { stream, cancelCalls } = liveBody();
    const { response } = cyclingResponse(
      "statusText",
      [rethrowing(cause)],
      { status: 404 },
      stream,
    );

    const result = await typedFetch("https://example.invalid/statustext-throws", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
    // Nobody can reach this body any more, so typedFetch must have released it.
    expect(response.bodyUsed).toBe(true);
    expect(cancelCalls()).toBe(1);
  });

  test("TF-09: a statusText getter that throws on the SECOND read never runs twice", async () => {
    const boom = new Error("statusText getter exploded on the second read");
    const { response, reads } = cyclingResponse("statusText", ["Weird", rethrowing(boom)], {
      status: 599,
    });

    const result = await typedFetch("https://example.invalid/statustext-second-read", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(UnknownHttpError);
    expect(result.error).not.toBeInstanceOf(NetworkError);
    expect(result.error?.message).toContain("Weird");
    expect(reads()).toBe(1);
  });

  const nonStringStatusTextRows: Array<{ label: string; statusText: unknown }> = [
    { label: "a number", statusText: 42 },
    { label: "null", statusText: null },
    { label: "a Symbol", statusText: Symbol("s") },
    {
      label: "a hostile toString",
      statusText: {
        toString() {
          throw new Error("toString exploded");
        },
      },
    },
  ];

  test.each(nonStringStatusTextRows)(
    "TF-10: a non-string statusText ($label) is the empty string, never a NetworkError",
    async ({ statusText }) => {
      // `String(raw)` would THROW for the Symbol and for the hostile toString,
      // converting a well-formed HTTP error into a NetworkError. The rule is
      // total instead: the value when it is a string, and "" otherwise.
      const { response } = cyclingResponse("statusText", [statusText], { status: 599 });

      const result = await typedFetch("https://example.invalid/non-string-statustext", {
        fetch: resolving(response),
      });

      expect(result.error).toBeInstanceOf(UnknownHttpError);
      expect(result.error).not.toBeInstanceOf(NetworkError);
      if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
      expect(result.error.statusText).toBe("");
      expect(typeof result.error.statusText).toBe("string");
      // No reason phrase, and no URL: a synthesised Response reports `url` as "".
      expect(result.error.message).toBe("HTTP 599");
    },
  );

  test("TF-11: a url getter that throws on the FIRST read releases the live body", async () => {
    const cause = new Error("url getter exploded");
    const { stream, cancelCalls } = liveBody();
    const { response } = cyclingResponse("url", [rethrowing(cause)], { status: 404 }, stream);

    const result = await typedFetch("https://example.invalid/url-throws-live-body", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.cause).toBe(cause);
    expect(response.bodyUsed).toBe(true);
    expect(cancelCalls()).toBe(1);
  });

  test("TF-12: a url getter that throws on the SECOND read never runs twice", async () => {
    // The previously unreported half of the defect. `message` carried the
    // redacted form of one read and `error.url` carried a second read, so a
    // second read that threw turned a NotFoundError into a NetworkError.
    const boom = new Error("url getter exploded on the second read");
    const { response, reads } = cyclingResponse("url", ["https://a.test/x", rethrowing(boom)], {
      status: 404,
    });

    const result = await typedFetch("https://example.invalid/url-second-read", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(result.error).not.toBeInstanceOf(NetworkError);
    expect(reads()).toBe(1);
  });

  test("TF-13: a cycling url cannot make the message and the escape hatch disagree", async () => {
    const { response, reads } = cyclingResponse(
      "url",
      ["https://a.test/x?tok=SECRET", "https://b.test/y"],
      { status: 404 },
    );

    const result = await typedFetch("https://example.invalid/cycling-url", {
      fetch: resolving(response),
    });

    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    // The full href on the property, the redacted form in the message and in
    // the record — both derived from ONE read, so they describe one server.
    expect(result.error.url).toBe("https://a.test/x?tok=SECRET");
    expect(result.error.message).toContain("https://a.test/x");
    expect(result.error.message).not.toContain("b.test");
    expect(result.error.message).not.toContain("SECRET");
    expect(result.error.toJSON().url).toBe("https://a.test/x");
    expect(reads()).toBe(1);
  });

  const nonStringUrlRows: Array<{ label: string; url: unknown }> = [
    { label: "a number", url: 42 },
    { label: "null", url: null },
    { label: "a URL object", url: new URL("https://a.test/") },
  ];

  test.each(nonStringUrlRows)(
    "TF-14: a non-string url ($label) is the empty string, never a NetworkError",
    async ({ url: rawUrl }) => {
      const { response } = cyclingResponse("url", [rawUrl], { status: 404 });

      const result = await typedFetch("https://example.invalid/non-string-url", {
        fetch: resolving(response),
      });

      expect(result.error).not.toBeInstanceOf(NetworkError);
      if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
      expect(result.error.url).toBe("");
      expect(typeof result.error.url).toBe("string");
      // The no-url message branch: no parenthesized URL at all.
      expect(result.error.message).toBe("HTTP 404");
    },
  );

  test("TF-15: the headers accessor is read exactly once for a live error", async () => {
    const { stream } = liveBody();
    const response = new Response(stream, { status: 404 });
    const real = response.headers;
    let reads = 0;
    Object.defineProperty(response, "headers", {
      configurable: true,
      get() {
        reads += 1;
        return real;
      },
    });

    const result = await typedFetch("https://example.invalid/counting-headers", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(reads).toBe(1);

    if (isHttpError(result.error)) await result.error.cancel();
  });

  const headersRows: Array<{
    label: string;
    headers: unknown;
    outcome: "error" | "network";
    check?: (error: BaseHttpError) => void;
  }> = [
    {
      label: "a plain empty object builds empty headers",
      headers: {},
      outcome: "error",
      check: (error) => expect([...error.headers.keys()]).toEqual([]),
    },
    {
      label: "a plain record builds the headers it names",
      headers: { "x-a": "1" },
      outcome: "error",
      check: (error) => expect(error.headers.get("x-a")).toBe("1"),
    },
    { label: "null is refused by the Headers constructor", headers: null, outcome: "network" },
    {
      label: "a string is refused by the Headers constructor",
      headers: "garbage",
      outcome: "network",
    },
  ];

  test.each(headersRows)("TF-16: $label", async ({ headers, outcome, check }) => {
    // `headers` is passed through UNNORMALIZED. A value the `Headers`
    // constructor refuses is a signal the envelope already turns into a
    // NetworkError, and that is released, documented behavior.
    const { stream, cancelCalls } = liveBody();
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(response, "headers", {
      configurable: true,
      get() {
        return headers;
      },
    });

    const result = await typedFetch("https://example.invalid/headers-shapes", {
      fetch: resolving(response),
    });

    if (outcome === "network") {
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(response.bodyUsed).toBe(true);
      expect(cancelCalls()).toBe(1);
      return;
    }

    expect(result.error).toBeInstanceOf(NotFoundError);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    check?.(result.error);
    await result.error.cancel();
  });

  test("TF-17: a live 404 reports one identity through every channel", async () => {
    // The no-hostility baseline. For a real `Response` the platform answers the
    // same value on every read, so this test passed before the change too —
    // which is the point: the refactor changed nothing here.
    const result = await typedFetch(url({ status: 404 }));

    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expectIdentityAgrees(result.error, 404);
    expect(result.error.statusText).toBe("Not Found");
    expect(result.error.message).toContain("HTTP 404 Not Found");

    await result.error.cancel();
  });

  test("TF-18: a live 599 reports one identity through every channel", async () => {
    const result = await typedFetch(url({ status: 599 }));

    expect(result.error).toBeInstanceOf(UnknownHttpError);
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expectIdentityAgrees(result.error, 599);

    await result.error.cancel();
  });

  test("TF-19: numeric conversion is part of the first successful read", async () => {
    let valueOfCalls = 0;
    const status = {
      valueOf() {
        valueOfCalls += 1;
        return 404;
      },
    };

    const { response } = cyclingResponse("status", [status]);
    const result = await typedFetch("https://example.invalid/counting-valueof", {
      fetch: resolving(response),
    });

    expect(result.error).toBeInstanceOf(NotFoundError);
    // One read, one conversion. A second `Number(raw)` anywhere on the path
    // would run this getter again and could answer a different status.
    expect(valueOfCalls).toBe(1);
  });

  test("TF-20: a partial identity failure cannot change earlier fields on retry", async () => {
    const response = new Response(null);
    const cause = new Error("headers getter exploded");
    const laterHeaders = new Headers({ "x-later": "2" });
    const reads = { status: 0, statusText: 0, url: 0, headers: 0 };

    Object.defineProperties(response, {
      status: {
        get() {
          reads.status += 1;
          return reads.status === 1 ? 420 : 421;
        },
      },
      statusText: {
        get() {
          reads.statusText += 1;
          return reads.statusText === 1 ? "FIRST" : "SECOND";
        },
      },
      url: {
        get() {
          reads.url += 1;
          return reads.url === 1 ? "https://first.test/x" : "https://second.test/y";
        },
      },
      headers: {
        get() {
          reads.headers += 1;
          if (reads.headers === 1) throw cause;
          return laterHeaders;
        },
      },
    });

    const fetch = resolving(response);
    const first = await typedFetch("https://example.invalid/partial-identity", { fetch });
    expect(first.error).toBeInstanceOf(NetworkError);
    expect(first.error?.cause).toBe(cause);

    const second = await typedFetch("https://example.invalid/partial-identity", { fetch });
    expect(second.error).toBeInstanceOf(UnknownHttpError);
    if (!isHttpError(second.error)) throw new Error("expected an HTTP error");
    expect(second.error.status).toBe(420);
    expect(second.error.message).toContain("HTTP 420 FIRST (https://first.test/x)");
    expect(second.error.url).toBe("https://first.test/x");
    expect(reads).toEqual({ status: 1, statusText: 1, url: 1, headers: 2 });
  });

  test("TF-21: a REFUSED value has no identity filed against it", async () => {
    // The recording rule is "the first successful read fixes A RESPONSE's
    // identity". `isResponse` used to read and record `status` and `headers`
    // BEFORE the checks that can still refuse the value, so it also filed an
    // identity against things it went on to reject.
    //
    // That is reachable across two calls holding the SAME object: a response
    // shaped value missing `json` earns its NetworkError while quietly filing
    // `status: 200`; completed and re-presented as a 404, it is accepted, and
    // `statusOf` answers with the recorded 200. `status >= 400` is then false
    // and a failed request escapes through the success branch. The
    // success-surface check cannot catch it either — it validates the same
    // recorded scalars.
    const shapeshifter = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      headers: new Headers({ "content-type": "application/json" }),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://example.invalid/shapeshifter",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => shapeshifter,
      formData: async () => new FormData(),
      text: async () => "",
      // `json` is absent, which is what makes the first call refuse it.
    } as unknown as Response & { json?: () => Promise<unknown> };

    const fetch = resolving(shapeshifter);

    const refused = await typedFetch("https://example.invalid/shapeshifter", { fetch });
    expect(refused.response).toBe(null);
    expect(refused.error).toBeInstanceOf(NetworkError);

    // The same object, now complete and reporting a failure.
    shapeshifter.json = async () => ({});
    Object.defineProperty(shapeshifter, "status", { value: 404, configurable: true });
    Object.defineProperty(shapeshifter, "ok", { value: false, configurable: true });

    const accepted = await typedFetch("https://example.invalid/shapeshifter", { fetch });

    expect(accepted.response).toBe(null);
    expect(accepted.error).toBeInstanceOf(NotFoundError);
    if (!isHttpError(accepted.error)) throw new Error("expected an HTTP error");
    expect(accepted.error.status).toBe(404);
  });

  test("TF-22: a value refused by the headers read has no status filed against it", async () => {
    // TF-21's rule, reached through the other door. `isResponse` used to read
    // `status` and then `headers`, but the `headers` read is ITSELF a refusal
    // point (H-13: a throwing getter answers with a NetworkError). So a value
    // refused there had already had its status filed.
    //
    // Across two calls holding the same object that flips the envelope: a 200
    // filed during a refused call, re-presented once the getter recovers and
    // the object reports 404, answers with the recorded 200 — and a failed
    // request escapes through the success branch.
    let headersThrow = true;
    let status = 200;
    const base = new Response("{}", { status: 200 });
    const response = new Proxy(base, {
      get(target, property) {
        if (property === "headers") {
          if (headersThrow) throw new Error("headers getter exploded");
          return new Headers({ "content-type": "application/json" });
        }
        if (property === "status") return status;
        if (property === "ok") return status < 400;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const fetch = resolving(response);

    const refused = await typedFetch("https://example.invalid/late-refusal", { fetch });
    expect(refused.response).toBe(null);
    expect(refused.error).toBeInstanceOf(NetworkError);

    // The same object, now readable and reporting a failure.
    headersThrow = false;
    status = 404;

    const accepted = await typedFetch("https://example.invalid/late-refusal", { fetch });

    expect(accepted.response).toBe(null);
    expect(accepted.error).toBeInstanceOf(NotFoundError);
    if (!isHttpError(accepted.error)) throw new Error("expected an HTTP error");
    expect(accepted.error.status).toBe(404);
    await accepted.error.cancel();
  });

  // ── Gates the suite named but never pinned ──────────────────────────────
  // Each of these was a mutation that survived the whole suite: the code was
  // right and nothing protected it.

  test.each(["cors", "opaque", "opaqueredirect", "default", "error"])(
    "a success whose response.type is %s is accepted, not refused",
    async (type) => {
      // Node only ever produces `basic` and `default`, so `FOREIGN_RESPONSE_TYPES`
      // was asserted for those two alone. Blanking the `cors` member turned
      // EVERY genuine cross-origin success into an incompatible-surface
      // NetworkError — the widest blast radius in the file, invisible here.
      const response = new Response("{}", { status: 200 });
      Object.defineProperty(response, "type", { configurable: true, value: type });

      const result = await typedFetch("https://example.invalid/type", {
        fetch: resolving(response),
      });

      expect(result.error).toBe(null);
      expect(result.response?.type).toBe(type);
    },
  );

  test("a status of 399 is a success — the boundary is pinned from BELOW too", async () => {
    // `400 → 401` was killed; `400 → 399` was not. Nothing asserted that the
    // largest status below the boundary stays on the success branch.
    const response = new Response("{}", { status: 399 });

    const result = await typedFetch("https://example.invalid/399", {
      fetch: resolving(response),
    });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(399);
  });

  test("a structurally complete object with no Response tag is refused", async () => {
    // The tag gate could be made to never refuse, and a plain object with the
    // whole surface then became a NotFoundError — or, on the success path, a
    // TypedResponse.
    const untagged = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: false,
      redirected: false,
      status: 404,
      statusText: "Not Found",
      type: "basic",
      url: "https://example.invalid/untagged",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => untagged,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };

    const result = await typedFetch("https://example.invalid/untagged", {
      fetch: resolving(untagged as unknown as Response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
  });

  test("a Response-tagged double missing ok, redirected, and type is refused", async () => {
    // The FOREIGN_RESPONSE_FIELDS presence gate. Without it a 404 double
    // missing three fields became a NotFoundError instead of a NetworkError.
    const partial = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      status: 404,
      statusText: "Not Found",
      url: "https://example.invalid/partial",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => partial,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };

    const result = await typedFetch("https://example.invalid/partial", {
      fetch: resolving(partial as unknown as Response),
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
  });

  test("TF-23: a value refused by a LATER identity read keeps nothing from the earlier one", async () => {
    // Ordering the identity reads cannot close this on its own. Whichever runs
    // first is filed before the second can refuse the value, so a refused call
    // always left something behind; reading `headers` before `status` only
    // moved WHICH field was stranded.
    //
    // A stranded `headers` is not harmless. `hasCompatibleSuccessSurface` reads
    // through the same cache, so it validated the `Headers` from the refused
    // call — and a value whose `headers` is a plain `{ notHeaders: true }`
    // escaped as a typed success whose `headers` had no `get`.
    let statusThrows = true;
    const shapeshifter: Record<string, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      ok: true,
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "https://example.invalid/late-identity",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => shapeshifter,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };
    Object.defineProperty(shapeshifter, "headers", {
      configurable: true,
      get: () => new Headers({ "content-type": "application/json" }),
    });
    Object.defineProperty(shapeshifter, "status", {
      configurable: true,
      get() {
        if (statusThrows) throw new Error("status getter exploded");
        return 200;
      },
    });

    const fetch = resolving(shapeshifter as unknown as Response);

    const refused = await typedFetch("https://example.invalid/late-identity", { fetch });
    expect(refused.error).toBeInstanceOf(NetworkError);

    // The same object, now honest and STABLE — plain data properties, no
    // shifting getter — but carrying a `headers` that is not a `Headers`.
    statusThrows = false;
    Object.defineProperty(shapeshifter, "status", { configurable: true, value: 200 });
    Object.defineProperty(shapeshifter, "headers", {
      configurable: true,
      value: { notHeaders: true },
    });

    const second = await typedFetch("https://example.invalid/late-identity", { fetch });

    expect(second.response).toBe(null);
    expect(second.error).toBeInstanceOf(NetworkError);
  });

  // TF-21 and TF-23 both refuse INSIDE `isResponse`, and the staging only ever
  // spanned that call. `hasCompatibleSuccessSurface` is a refusal point too,
  // and it reads `ok`, `redirected`, and `type` WITHOUT the identity cache —
  // the only three reads in this phase a value can answer differently on a
  // second presentation. So a value refused there kept `status`, `headers`,
  // `statusText`, and `url` filed from the refused call.
  //
  // TF-21's comment says "the success-surface check cannot catch it either",
  // which was true and also the hole: the surface check was itself unstaged.
  describe("TF-24: a value refused by the SUCCESS-SURFACE check files nothing either", () => {
    function shapeshifterRefusedOn(field: "type" | "ok" | "redirected") {
      const bad = { type: "not-a-type", ok: "yes", redirected: "no" } as const;
      const shapeshifter: Record<string, unknown> = {
        [Symbol.toStringTag]: "Response",
        body: null,
        bodyUsed: false,
        headers: new Headers({ "content-type": "application/json" }),
        ok: true,
        redirected: false,
        status: 200,
        statusText: "OK",
        type: "basic",
        url: "https://example.invalid/late-surface",
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        clone: () => shapeshifter,
        formData: async () => new FormData(),
        json: async () => ({}),
        text: async () => "",
      };
      // One member off the standard, so only the surface check refuses it.
      shapeshifter[field] = bad[field];
      return shapeshifter;
    }

    test.each(["type", "ok", "redirected"] as const)(
      "refused on `%s`, then re-presented as a 404, is not answered as a success",
      async (field) => {
        const shapeshifter = shapeshifterRefusedOn(field);
        const fetch = resolving(shapeshifter as unknown as Response);

        const refused = await typedFetch("https://example.invalid/late-surface", { fetch });
        expect(refused.response).toBe(null);
        expect(refused.error).toBeInstanceOf(NetworkError);

        // Now honest, and reporting a FAILED request. The filed `status: 200`
        // from the refused call must not answer for it.
        shapeshifter[field] = { type: "basic", ok: false, redirected: false }[field];
        shapeshifter.status = 404;
        shapeshifter.ok = false;

        const second = await typedFetch("https://example.invalid/late-surface", { fetch });
        expect(second.response).toBe(null);
        expect(second.error).toBeInstanceOf(NotFoundError);
        if (isHttpError(second.error)) {
          expect(second.error.status).toBe(404);
          await second.error.cancel();
        }
      },
    );

    test("the stale headers record cannot let a headerless object escape as a success", async () => {
      // TF-23's exact failure, one refusal point later.
      const shapeshifter = shapeshifterRefusedOn("type");
      const fetch = resolving(shapeshifter as unknown as Response);

      expect(
        (await typedFetch("https://example.invalid/late-surface", { fetch })).error,
      ).toBeInstanceOf(NetworkError);

      shapeshifter.type = "basic";
      shapeshifter.headers = { notHeaders: true };

      const second = await typedFetch("https://example.invalid/late-surface", { fetch });
      expect(second.response).toBe(null);
      expect(second.error).toBeInstanceOf(NetworkError);
    });

    // The construction is a refusal point too. `new Headers(identity.headers)`
    // refuses a value that READ fine — `[["a"]]` is a legal read and an illegal
    // `HeadersInit` — and the caller gets a NetworkError. The bad `headers` and
    // the `status` beside it used to stay filed, so the same object presented
    // later as a healthy 200 was answered with that NetworkError forever.
    test("a throwing error CONSTRUCTOR files nothing either", async () => {
      const shapeshifter: Record<string, unknown> = {
        [Symbol.toStringTag]: "Response",
        body: null,
        bodyUsed: false,
        headers: [["a"]],
        ok: false,
        redirected: false,
        status: 404,
        statusText: "Not Found",
        type: "basic",
        url: "https://example.invalid/bad-headers",
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        clone: () => shapeshifter,
        formData: async () => new FormData(),
        json: async () => ({}),
        text: async () => "",
      };
      const fetch = resolving(shapeshifter as unknown as Response);

      const refused = await typedFetch("https://example.invalid/bad-headers", { fetch });
      expect(refused.error).toBeInstanceOf(NetworkError);

      // The same object, now healthy.
      shapeshifter.headers = new Headers({ "content-type": "application/json" });
      shapeshifter.status = 200;
      shapeshifter.ok = true;

      const second = await typedFetch("https://example.invalid/bad-headers", { fetch });
      expect(second.error).toBe(null);
      expect(second.response?.status).toBe(200);
    });

    // The surface check refuses in TWO ways, and only one of them was covered.
    // Every read inside it can THROW instead of reporting a bad value, and that
    // path skipped the rollback. The flag now starts true and only an
    // acceptance clears it, so a refusal added later is covered by omission.
    test.each(["type", "statusText", "url", "ok", "redirected"] as const)(
      "a THROWING `%s` getter files nothing either",
      async (member) => {
        let throws = true;
        const shapeshifter: Record<string, unknown> = {
          [Symbol.toStringTag]: "Response",
          body: null,
          bodyUsed: false,
          headers: new Headers({ "content-type": "application/json" }),
          ok: true,
          redirected: false,
          status: 200,
          statusText: "OK",
          type: "basic",
          url: "https://example.invalid/throwing-surface",
          arrayBuffer: async () => new ArrayBuffer(0),
          blob: async () => new Blob(),
          clone: () => shapeshifter,
          formData: async () => new FormData(),
          json: async () => ({}),
          text: async () => "",
        };
        const honest = shapeshifter[member];
        Object.defineProperty(shapeshifter, member, {
          configurable: true,
          get() {
            if (throws) throw new Error(`${member} getter exploded`);
            return honest;
          },
        });
        const fetch = resolving(shapeshifter as unknown as Response);

        const refused = await typedFetch("https://example.invalid/throwing-surface", { fetch });
        expect(refused.response).toBe(null);
        expect(refused.error).toBeInstanceOf(NetworkError);

        // Now honest, and reporting a FAILED request. `defineProperty` for
        // every slot: the getter above replaced one of them, and a plain
        // assignment to a non-writable data property throws.
        throws = false;
        for (const [key, value] of [
          [member, honest],
          ["status", 404],
          ["ok", false],
        ] as const) {
          Object.defineProperty(shapeshifter, key, { configurable: true, writable: true, value });
        }

        const second = await typedFetch("https://example.invalid/throwing-surface", { fetch });
        expect(second.response).toBe(null);
        expect(second.error).toBeInstanceOf(NotFoundError);
        if (isHttpError(second.error)) await second.error.cancel();
      },
    );

    test("an ACCEPTED call still fixes the identity it read", async () => {
      // The rollback drops only what the refused call recorded. A field fixed
      // by an earlier accepted call is that response's identity and stays.
      const shapeshifter = shapeshifterRefusedOn("type");
      shapeshifter.type = "basic";
      shapeshifter.status = 404;
      shapeshifter.ok = false;
      const fetch = resolving(shapeshifter as unknown as Response);

      const first = await typedFetch("https://example.invalid/late-surface", { fetch });
      expect(first.error).toBeInstanceOf(NotFoundError);
      if (isHttpError(first.error)) await first.error.cancel();

      shapeshifter.status = 500;
      const second = await typedFetch("https://example.invalid/late-surface", { fetch });
      expect(second.error).toBeInstanceOf(NotFoundError);
      if (isHttpError(second.error)) await second.error.cancel();
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
// input reaches `message`, `stack`, `String(error)`, `JSON.stringify(error)`,
// or `util.inspect(error)`. The platform's own text stays reachable through
// `error.cause`, which a caller reads deliberately.
/**
 * The five channels a reader reaches an error through without asking for a
 * member by name. `util.inspect` runs with the library's hook installed, which
 * is what `console.log(error)` uses; the hook signposts `cause` instead of
 * printing it.
 */
function automaticChannels(error: unknown): readonly string[] {
  const value = error as Error;
  return [
    value.message,
    value.stack ?? "",
    String(value),
    JSON.stringify(value),
    inspect(value, { depth: null }),
  ];
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

// ── Only a rejected transport call can be an abort or a timeout ──────────
//
// `typedFetch` runs three phases: it reads the caller's options, it awaits the
// transport, and it inspects what the transport resolved. One `try` covered all
// three, and the classifier — which trusts the governing signal by design —
// therefore saw a phase-1 or phase-3 exception as if the transport had rejected.
//
// A getter is caller code. A getter that aborts the signal and then throws an
// abort-shaped exception made `typedFetch` answer with an AbortedError for a
// failure the abort never caused, and with a TimeoutError when the abort reason
// was a timeout. A consumer's retry policy reads that class.
/** A response-shaped value whose `field` getter aborts the signal and throws. */
function abortingResponse(field: string, controller: AbortController): Response {
  const response: Record<string, unknown> = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers({ "content-type": "application/json" }),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: "https://example.invalid/aborting-getter",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
  };
  Object.defineProperty(response, field, {
    configurable: true,
    get(): never {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    },
  });
  return response as unknown as Response;
}

describe("typedFetch — only the transport phase can produce an abort or a timeout", () => {
  test.each(["status", "headers", "bodyUsed", "ok", "type"])(
    "a `%s` getter that aborts the signal and throws is a NetworkError",
    async (field) => {
      const controller = new AbortController();

      const result = await typedFetch("https://example.invalid/aborting-getter", {
        fetch: resolving(abortingResponse(field, controller)),
        signal: controller.signal,
      });

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(NetworkError);
      expect(isNetworkError(result.error)).toBe(true);
      expect(isAbortError(result.error)).toBe(false);
      expect(controller.signal.aborted).toBe(true);
    },
  );

  test("a response getter that aborts with a timeout reason is still a NetworkError", async () => {
    // The timeout arm reads the signal's REASON, so a getter that aborts with a
    // real `DOMException` named "TimeoutError" reached it directly.
    const controller = new AbortController();
    const response: Record<string, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "https://example.invalid/timeout-getter",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => response,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };
    Object.defineProperty(response, "status", {
      configurable: true,
      get(): never {
        const reason = new DOMException("The operation timed out.", "TimeoutError");
        controller.abort(reason);
        throw reason;
      },
    });

    const result = await typedFetch("https://example.invalid/timeout-getter", {
      fetch: resolving(response as unknown as Response),
      signal: controller.signal,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isTimeoutError(result.error)).toBe(false);
  });

  test("an options read that aborts the signal and throws is a NetworkError", async () => {
    // Phase 1. The descriptor pass runs after the signal slot has been read, so
    // the governing signal is already known when this exception is raised.
    const controller = new AbortController();
    const target = {
      fetch: resolving(new Response(null, { status: 200 })),
      signal: controller.signal,
    };
    const options = new Proxy(target, {
      ownKeys(): never {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });

    const result = await typedFetch("https://example.invalid/hostile-options", options);

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isAbortError(result.error)).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  test("a transport rejection while the signal is aborted is still an abort", async () => {
    // The counterpart. Phase 2 is where an abort belongs, and this pins that
    // the phase split did not take the abort path away from it.
    const controller = new AbortController();

    const result = await typedFetch("https://example.invalid/real-abort", {
      signal: controller.signal,
      fetch: (async () => {
        controller.abort();
        throw controller.signal.reason;
      }) as unknown as typeof fetch,
    });

    expect(result.response).toBe(null);
    expect(isAbortError(result.error)).toBe(true);
  });
});
