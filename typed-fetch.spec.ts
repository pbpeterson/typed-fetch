import { describe, test, expect, expectTypeOf, vi } from "vitest";
import { useTestServer } from "./fixtures/http-server";
import { allErrors } from "./fixtures/error-roster";
import { typedFetch, isHttpError, isNetworkError, isAbortError, isTimeoutError } from "./src/index";
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
    const result = await typedFetch(url({ status: 200 }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(200);
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
    // The proxy traps hide `fetch` from a plain read, but the sanitized target
    // must not carry the descriptor either: reflection over the init object is
    // part of what a fetch implementation may legitimately do.
    expect(Reflect.ownKeys(init as object)).not.toContain("fetch");
    expect(Object.getOwnPropertyDescriptor(init as object, "fetch")).toBeUndefined();
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

  test("uses an inherited fetch override without forwarding it", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const options = Object.create({ fetch: stubFetch, method: "POST" }) as TypedFetchOptions;

    await typedFetch("https://example.invalid/inherited-fetch", options);

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [, init] = stubFetch.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init && "fetch" in init).toBe(false);
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
    Object.defineProperty(hostileResponse, "headers", {
      get() {
        throw cause;
      },
    });
    Object.defineProperty(hostileResponse, "body", {
      get() {
        throw releaseCause;
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

  test("407 → ProxyAuthenticationRequiredError (constructed directly, Node rejects 407 at network level)", async () => {
    const error = new ProxyAuthenticationRequiredError(new Response(null, { status: 407 }));

    expect(error.status).toBe(407);
    expect(error).toBeInstanceOf(BaseHttpError);
    expect(isHttpError(error)).toBe(true);
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

  test("status-0 Response.error() stays on the success branch with native body behavior", async () => {
    const errorResponse = Response.error();
    const result = await typedFetch("https://example.test/status-zero", {
      fetch: async () => errorResponse,
    });

    expect(result.error).toBe(null);
    expect(result.response).toBe(errorResponse);

    if (result.response) {
      expect(result.response.status).toBe(0);
      expect(result.response.type).toBe("error");
      expect(await result.response.clone().text()).toBe("");
      await expect(result.response.json()).rejects.toBeInstanceOf(SyntaxError);
    }
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

  test("connection refused → NetworkError with original error as cause", async () => {
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

  test("TypedHeaders accepts a Headers instance and sends it", async () => {
    const headers = new Headers();
    headers.set("X-Custom-Header", "headers-instance");

    const result = await typedFetch(url({ status: 200 }), { headers });

    expect(result.error).toBe(null);
    expectTypeOf(headers).toExtend<TypedFetchOptions["headers"]>();
  });

  test("TypedHeaders accepts tuple pairs and sends them", async () => {
    const headers: [string, string][] = [["X-Custom-Header", "tuple-pairs"]];

    const result = await typedFetch(url({ status: 200 }), { headers });

    expect(result.error).toBe(null);
    expectTypeOf(headers).toExtend<TypedFetchOptions["headers"]>();
  });

  test("TypedHeaders (Headers instance and tuple pairs) actually reach the server", async () => {
    const stubFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    const headersInstance = new Headers({ "X-Custom-Header": "from-headers-instance" });
    await typedFetch("https://example.invalid/headers-instance", {
      headers: headersInstance,
      fetch: stubFetch as unknown as typeof fetch,
    });

    const tuplePairs: [string, string][] = [["X-Custom-Header", "from-tuple-pairs"]];
    await typedFetch("https://example.invalid/headers-tuples", {
      headers: tuplePairs,
      fetch: stubFetch as unknown as typeof fetch,
    });

    expect(stubFetch).toHaveBeenCalledTimes(2);

    const [, initFromHeadersInstance] = stubFetch.mock.calls[0] ?? [];
    expect(initFromHeadersInstance?.headers).toBe(headersInstance);

    const [, initFromTuples] = stubFetch.mock.calls[1] ?? [];
    expect(initFromTuples?.headers).toBe(tuplePairs);
  });

  // ── Request objects passed as `options` (host-exotic-object passthrough) ──
  // A `Request`'s `method`/`headers`/`body`/`signal` are prototype getters,
  // not own enumerable properties. When a `Request` is passed in the `options`
  // slot, object rest spread (`...init`) copies NONE of them, silently
  // downgrading every request to a bodyless, header-less GET and dropping the
  // abort signal. These tests pass the `Request` as the second argument — the
  // exact slot the spread corrupts — and prove it now reaches fetch untouched.
  // Each fails on the pre-fix (spread) implementation.
  describe("Request passed as the options argument is preserved (not spread away)", () => {
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

    test("pre-aborted signal via Request → AbortedError (init.signal?.aborted reads the Request getter)", async () => {
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
