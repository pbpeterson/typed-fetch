import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, test, expect, expectTypeOf, vi } from "vitest";
import { useTestServer } from "./fixtures/http-server";
import { allErrors } from "./fixtures/error-roster";
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isKnownHttpError,
  isAbortError,
  isTimeoutError,
} from "./src/index";
import { statusCodeErrorMap } from "./src/http-status-codes";
import { httpErrors } from "./src/errors/helpers";
import type { HttpErrors } from "./src/errors/helpers";
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
import type { ClientErrors, ServerErrors, TypedFetchError } from "./src/errors";
import type { StrictHeaders } from "./src/headers";
import type { HttpMethods } from "./src/methods";
import {
  RequestTooLongError as PublicRequestTooLongError,
  typedFetch as publicTypedFetch,
  UnprocessableEntityError as PublicUnprocessableEntityError,
  type TypedFetchOptions,
  type TypedFetchReturnType,
  type TypedResponse,
} from "./index";

function responseWithStatus(status: number): Response {
  return new Response(null, { status });
}

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
  test("AbortSignal.any(): timeout wins → TimeoutError", async () => {
    const userController = new AbortController();
    const combined = AbortSignal.any([userController.signal, AbortSignal.timeout(1)]);

    const result = await typedFetch(url({ status: 200, delay: 200 }), {
      signal: combined,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(result.error)).toBe(true);
  });

  test("AbortSignal.any(): user abort wins → AbortedError with the user's reason", async () => {
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
  });

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

// ── Exported registries ──────────────────────────────────────────────

describe("httpErrors & statusCodeErrorMap", () => {
  test("httpErrors contains all 40 error classes", () => {
    expect(httpErrors).toHaveLength(40);
  });

  test("statusCodeErrorMap contains all 40 status codes", () => {
    expect(statusCodeErrorMap.size).toBe(40);
  });

  test("every httpErrors class maps to the correct status code", () => {
    for (const ErrorClass of httpErrors) {
      expect(statusCodeErrorMap.get(ErrorClass.status)).toBe(ErrorClass);
    }
  });
});

// ── Roster sync guardrail ────────────────────────────────────────────
// The error roster is hand-maintained across several files (per-class
// files under src/errors/, the httpErrors array, the ClientErrors/
// ServerErrors unions, and statusCodeErrorMap). Nothing at the language
// level forces those files to stay in agreement: a hand-edit can widen a
// literal or drop a class from a union in one place without the others
// noticing. These tests ARE that enforcement — the independent check that
// every one of those artifacts still agrees with the others. They are the
// safety net that makes adding a status code by hand safe (see
// CONTRIBUTING.md, "Adding a new HTTP status code").
//
// IMPORTANT — what each check actually proves (verified by deliberately
// widening NotFoundError's instance `status` field to `number` and
// confirming which of these checks fails to compile):
//
//   - Check 1 (InstanceType<HttpErrors> vs ClientErrors | ServerErrors)
//     catches ROSTER MEMBERSHIP drift only: a class added to/removed from
//     the `httpErrors` array without a matching change to the
//     ClientErrors/ServerErrors unions. It does NOT catch a single
//     already-listed class's field being widened, because both sides of
//     the comparison reference the SAME class symbol — widen the class
//     once and both the array-derived side and the hand-written union
//     side see the widened type simultaneously, so they still compare
//     equal to each other. Verified empirically: widening
//     NotFoundError.status to `number` left this check green.
//   - Check 3's `test.each` loop asserts against `Class.status` where
//     `Class: HttpErrors` — a union of all 40 constructors — so
//     `Class.status` is already the union of all 40 status literals.
//     `.not.toEqualTypeOf<number>()` on that union only fails to compile
//     if EVERY member is widened (the union collapses to plain `number`);
//     a single widened class is invisible inside the union. This loop is
//     a coarse whole-roster sanity net, not per-class coverage.
//   - The only construct that actually proves per-class literal
//     narrowness is an explicit `expectTypeOf<SpecificClass["status"]>()
//     .toEqualTypeOf<404>()` against that class's own type in isolation.
//     Verified empirically: this DOES fail to compile when
//     NotFoundError.status is widened. So full 40-class coverage below is
//     written as 40 explicit assertions, not derived from the union or
//     from test.each.

describe("roster sync", () => {
  // 1. Union <-> array exhaustiveness (compile-time). Catches a class
  // added to (or removed from) the `httpErrors` array without a matching
  // update to `ClientErrors`/`ServerErrors` (see caveat above: this does
  // NOT catch field-level widening on an already-listed class).
  test("HttpErrors instance union matches ClientErrors | ServerErrors", () => {
    expectTypeOf<InstanceType<HttpErrors>>().toEqualTypeOf<ClientErrors | ServerErrors>();
  });

  // 2. Cardinality + map<->array agreement (runtime). Guards against a
  // class present in one artifact but not the other, or a status code
  // whose map entry disagrees with the class's own static `status`.
  test("roster cardinality is exactly 40 and map <-> array agree", () => {
    expect(httpErrors.length).toBe(40);
    expect(statusCodeErrorMap.size).toBe(40);

    const arrayStatuses = new Set(httpErrors.map((C) => C.status));
    const mapStatuses = new Set(statusCodeErrorMap.keys());
    expect(arrayStatuses).toEqual(mapStatuses);

    for (const [code, C] of statusCodeErrorMap) {
      expect(C.status).toBe(code);
    }
  });

  // 3. Coarse whole-roster literal sanity net (compile-time + runtime).
  // See the block comment above: this only fails if EVERY class's status
  // (or statusText) is widened at once, since `Class` is typed as the
  // union `HttpErrors` inside test.each. Kept as a cheap net plus a
  // runtime cross-check against the independently hand-authored
  // `allErrors` table, but it is NOT the primary guardrail — see check 4.
  test.each(allErrors)(
    "$Class.name ($status): static status/statusText are not fully-widened and match the table",
    ({ Class, status }) => {
      expectTypeOf(Class.status).not.toEqualTypeOf<number>();
      expectTypeOf(Class.statusText).not.toEqualTypeOf<string>();
      expect(Number.isInteger(Class.status)).toBe(true);
      expect(Class.status).toBe(status);
    },
  );

  // 4. Per-class literal status/statusText for ALL 40 classes
  // (compile-time). This is the actual guardrail against a single class's
  // literal being widened: each assertion below instantiates
  // `expectTypeOf` against ONE specific, non-union class's own type, so
  // widening exactly that class's `status`/`statusText` field to
  // `number`/`string` fails to compile right here, independent of the
  // other 39 classes and independent of checks 1-3 above.
  test("every class's status and statusText are their own literal type, not number/string", () => {
    expectTypeOf<BadRequestError["status"]>().toEqualTypeOf<400>();
    expectTypeOf<BadRequestError["statusText"]>().toEqualTypeOf<"Bad Request">();
    expectTypeOf<UnauthorizedError["status"]>().toEqualTypeOf<401>();
    expectTypeOf<UnauthorizedError["statusText"]>().toEqualTypeOf<"Unauthorized">();
    expectTypeOf<PaymentRequiredError["status"]>().toEqualTypeOf<402>();
    expectTypeOf<PaymentRequiredError["statusText"]>().toEqualTypeOf<"Payment Required">();
    expectTypeOf<ForbiddenError["status"]>().toEqualTypeOf<403>();
    expectTypeOf<ForbiddenError["statusText"]>().toEqualTypeOf<"Forbidden">();
    expectTypeOf<NotFoundError["status"]>().toEqualTypeOf<404>();
    expectTypeOf<NotFoundError["statusText"]>().toEqualTypeOf<"Not Found">();
    expectTypeOf<MethodNotAllowedError["status"]>().toEqualTypeOf<405>();
    expectTypeOf<MethodNotAllowedError["statusText"]>().toEqualTypeOf<"Method Not Allowed">();
    expectTypeOf<NotAcceptableError["status"]>().toEqualTypeOf<406>();
    expectTypeOf<NotAcceptableError["statusText"]>().toEqualTypeOf<"Not Acceptable">();
    expectTypeOf<ProxyAuthenticationRequiredError["status"]>().toEqualTypeOf<407>();
    expectTypeOf<
      ProxyAuthenticationRequiredError["statusText"]
    >().toEqualTypeOf<"Proxy Authentication Required">();
    expectTypeOf<RequestTimeoutError["status"]>().toEqualTypeOf<408>();
    expectTypeOf<RequestTimeoutError["statusText"]>().toEqualTypeOf<"Request Timeout">();
    expectTypeOf<ConflictError["status"]>().toEqualTypeOf<409>();
    expectTypeOf<ConflictError["statusText"]>().toEqualTypeOf<"Conflict">();
    expectTypeOf<GoneError["status"]>().toEqualTypeOf<410>();
    expectTypeOf<GoneError["statusText"]>().toEqualTypeOf<"Gone">();
    expectTypeOf<LengthRequiredError["status"]>().toEqualTypeOf<411>();
    expectTypeOf<LengthRequiredError["statusText"]>().toEqualTypeOf<"Length Required">();
    expectTypeOf<PreconditionFailedError["status"]>().toEqualTypeOf<412>();
    expectTypeOf<PreconditionFailedError["statusText"]>().toEqualTypeOf<"Precondition Failed">();
    expectTypeOf<RequestTooLongError["status"]>().toEqualTypeOf<413>();
    expectTypeOf<RequestTooLongError["statusText"]>().toEqualTypeOf<"Content Too Large">();
    expectTypeOf<RequestUriTooLongError["status"]>().toEqualTypeOf<414>();
    expectTypeOf<RequestUriTooLongError["statusText"]>().toEqualTypeOf<"URI Too Long">();
    expectTypeOf<UnsupportedMediaTypeError["status"]>().toEqualTypeOf<415>();
    expectTypeOf<
      UnsupportedMediaTypeError["statusText"]
    >().toEqualTypeOf<"Unsupported Media Type">();
    expectTypeOf<RequestedRangeNotSatisfiableError["status"]>().toEqualTypeOf<416>();
    expectTypeOf<
      RequestedRangeNotSatisfiableError["statusText"]
    >().toEqualTypeOf<"Range Not Satisfiable">();
    expectTypeOf<ExpectationFailedError["status"]>().toEqualTypeOf<417>();
    expectTypeOf<ExpectationFailedError["statusText"]>().toEqualTypeOf<"Expectation Failed">();
    expectTypeOf<ImATeapotError["status"]>().toEqualTypeOf<418>();
    expectTypeOf<ImATeapotError["statusText"]>().toEqualTypeOf<"I'm a teapot">();
    expectTypeOf<MisdirectedRequestError["status"]>().toEqualTypeOf<421>();
    expectTypeOf<MisdirectedRequestError["statusText"]>().toEqualTypeOf<"Misdirected Request">();
    expectTypeOf<UnprocessableEntityError["status"]>().toEqualTypeOf<422>();
    expectTypeOf<UnprocessableEntityError["statusText"]>().toEqualTypeOf<"Unprocessable Content">();
    expectTypeOf<LockedError["status"]>().toEqualTypeOf<423>();
    expectTypeOf<LockedError["statusText"]>().toEqualTypeOf<"Locked">();
    expectTypeOf<FailedDependencyError["status"]>().toEqualTypeOf<424>();
    expectTypeOf<FailedDependencyError["statusText"]>().toEqualTypeOf<"Failed Dependency">();
    expectTypeOf<TooEarlyError["status"]>().toEqualTypeOf<425>();
    expectTypeOf<TooEarlyError["statusText"]>().toEqualTypeOf<"Too Early">();
    expectTypeOf<UpgradeRequiredError["status"]>().toEqualTypeOf<426>();
    expectTypeOf<UpgradeRequiredError["statusText"]>().toEqualTypeOf<"Upgrade Required">();
    expectTypeOf<PreconditionRequiredError["status"]>().toEqualTypeOf<428>();
    expectTypeOf<
      PreconditionRequiredError["statusText"]
    >().toEqualTypeOf<"Precondition Required">();
    expectTypeOf<TooManyRequestsError["status"]>().toEqualTypeOf<429>();
    expectTypeOf<TooManyRequestsError["statusText"]>().toEqualTypeOf<"Too Many Requests">();
    expectTypeOf<RequestHeaderFieldsTooLargeError["status"]>().toEqualTypeOf<431>();
    expectTypeOf<
      RequestHeaderFieldsTooLargeError["statusText"]
    >().toEqualTypeOf<"Request Header Fields Too Large">();
    expectTypeOf<UnavailableForLegalReasonsError["status"]>().toEqualTypeOf<451>();
    expectTypeOf<
      UnavailableForLegalReasonsError["statusText"]
    >().toEqualTypeOf<"Unavailable For Legal Reasons">();
    expectTypeOf<InternalServerError["status"]>().toEqualTypeOf<500>();
    expectTypeOf<InternalServerError["statusText"]>().toEqualTypeOf<"Internal Server Error">();
    expectTypeOf<NotImplementedError["status"]>().toEqualTypeOf<501>();
    expectTypeOf<NotImplementedError["statusText"]>().toEqualTypeOf<"Not Implemented">();
    expectTypeOf<BadGatewayError["status"]>().toEqualTypeOf<502>();
    expectTypeOf<BadGatewayError["statusText"]>().toEqualTypeOf<"Bad Gateway">();
    expectTypeOf<ServiceUnavailableError["status"]>().toEqualTypeOf<503>();
    expectTypeOf<ServiceUnavailableError["statusText"]>().toEqualTypeOf<"Service Unavailable">();
    expectTypeOf<GatewayTimeoutError["status"]>().toEqualTypeOf<504>();
    expectTypeOf<GatewayTimeoutError["statusText"]>().toEqualTypeOf<"Gateway Timeout">();
    expectTypeOf<HttpVersionNotSupportedError["status"]>().toEqualTypeOf<505>();
    expectTypeOf<
      HttpVersionNotSupportedError["statusText"]
    >().toEqualTypeOf<"HTTP Version Not Supported">();
    expectTypeOf<VariantAlsoNegotiatesError["status"]>().toEqualTypeOf<506>();
    expectTypeOf<
      VariantAlsoNegotiatesError["statusText"]
    >().toEqualTypeOf<"Variant Also Negotiates">();
    expectTypeOf<InsufficientStorageError["status"]>().toEqualTypeOf<507>();
    expectTypeOf<InsufficientStorageError["statusText"]>().toEqualTypeOf<"Insufficient Storage">();
    expectTypeOf<LoopDetectedError["status"]>().toEqualTypeOf<508>();
    expectTypeOf<LoopDetectedError["statusText"]>().toEqualTypeOf<"Loop Detected">();
    expectTypeOf<NotExtendedError["status"]>().toEqualTypeOf<510>();
    expectTypeOf<NotExtendedError["statusText"]>().toEqualTypeOf<"Not Extended">();
    expectTypeOf<NetworkAuthenticationRequiredError["status"]>().toEqualTypeOf<511>();
    expectTypeOf<
      NetworkAuthenticationRequiredError["statusText"]
    >().toEqualTypeOf<"Network Authentication Required">();
  });
});

// ── Compile-time type checks ─────────────────────────────────────────

describe("type-level", () => {
  test("HttpMethods accepts all standard methods", () => {
    expectTypeOf<"GET">().toExtend<HttpMethods>();
    expectTypeOf<"POST">().toExtend<HttpMethods>();
    expectTypeOf<"PUT">().toExtend<HttpMethods>();
    expectTypeOf<"PATCH">().toExtend<HttpMethods>();
    expectTypeOf<"DELETE">().toExtend<HttpMethods>();
    expectTypeOf<"HEAD">().toExtend<HttpMethods>();
    expectTypeOf<"OPTIONS">().toExtend<HttpMethods>();
  });

  test("HttpMethods rejects invalid and fetch-forbidden methods", () => {
    expectTypeOf<"INVALID">().not.toExtend<HttpMethods>();
    expectTypeOf<"get">().not.toExtend<HttpMethods>();
    expectTypeOf<string>().not.toExtend<HttpMethods>();
    // the Fetch spec forbids these — fetch() throws TypeError on them
    expectTypeOf<"CONNECT">().not.toExtend<HttpMethods>();
    expectTypeOf<"TRACE">().not.toExtend<HttpMethods>();
  });

  test("StrictHeaders accepts known and custom headers", () => {
    expectTypeOf<{ "Content-Type": "application/json" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ Authorization: "Bearer token" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ "X-Custom": "value" }>().toExtend<StrictHeaders>();
  });

  test("typedFetch return is a discriminated union", async () => {
    const result = await typedFetch<{ id: number }>(
      url({ status: 200, body: JSON.stringify({ id: 1 }) }),
    );

    if (result.error === null) {
      expectTypeOf(result.response).not.toEqualTypeOf<null>();
      expectTypeOf(result.response.status).toBeNumber();
    } else {
      expectTypeOf(result.response).toEqualTypeOf<null>();
      expectTypeOf(result.error).toExtend<
        ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError
      >();
    }
  });

  test("isKnownHttpError narrows error.status to a single class", async () => {
    const { error } = await typedFetch<{ id: number }>(url());
    if (error && isKnownHttpError(error)) {
      if (error.status === 403) expectTypeOf(error).toEqualTypeOf<ForbiddenError>();
    }
  });

  test("the removed second type argument no longer compiles", async () => {
    // @ts-expect-error — ErrorType generic was removed from typedFetch (P3-01);
    // typedFetch<T, E> is no longer a valid instantiation.
    await typedFetch<{ id: number }, NotFoundError>(url());
  });

  test("response.clone() keeps the typed json()", async () => {
    const result = await typedFetch<{ id: number }>(
      url({ status: 200, body: JSON.stringify({ id: 1 }) }),
    );

    if (result.error === null) {
      const cloned = result.response.clone();
      expectTypeOf(cloned.json).returns.toEqualTypeOf<Promise<{ id: number }>>();
      expect(await cloned.json()).toEqual({ id: 1 });
    }
  });

  test("public types are exported from the main entry", () => {
    expectTypeOf<TypedFetchOptions>().toExtend<RequestInit>();
    expectTypeOf<TypedResponse<{ a: 1 }>["json"]>().returns.toEqualTypeOf<Promise<{ a: 1 }>>();
    expectTypeOf<TypedFetchReturnType<{ a: 1 }>>().toExtend<{
      response: TypedResponse<{ a: 1 }> | null;
    }>();
  });

  test("isHttpError narrows to BaseHttpError", () => {
    const error: unknown = {};
    if (isHttpError(error)) {
      expectTypeOf(error).toExtend<BaseHttpError>();
    }
  });

  test("isNetworkError narrows to NetworkError", () => {
    const error: unknown = {};
    if (isNetworkError(error)) {
      expectTypeOf(error).toExtend<NetworkError>();
    }
  });

  test("NetworkError does not extend BaseHttpError", () => {
    expectTypeOf<NetworkError>().not.toExtend<BaseHttpError>();
  });

  test("AbortedError.reason is typed unknown (the consumer must narrow it)", () => {
    expectTypeOf<AbortedError["reason"]>().toEqualTypeOf<unknown>();
  });

  test("AbortedError and TimeoutError do not extend NetworkError or BaseHttpError", () => {
    expectTypeOf<AbortedError>().not.toExtend<NetworkError>();
    expectTypeOf<AbortedError>().not.toExtend<BaseHttpError>();
    expectTypeOf<TimeoutError>().not.toExtend<NetworkError>();
    expectTypeOf<TimeoutError>().not.toExtend<BaseHttpError>();
  });

  test("TypedFetchError includes AbortedError and TimeoutError", () => {
    expectTypeOf<AbortedError>().toExtend<
      ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError
    >();
    expectTypeOf<TimeoutError>().toExtend<
      ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError
    >();
  });

  test("error.url is string on every TypedFetchError family, readable unconditionally", () => {
    // Previously impossible: `url` lived only on BaseHttpError, so code written
    // against the full union could not read `error.url` without narrowing. Now
    // all six families carry `readonly url: string`, so the union's `url` is a
    // plain `string` and this compiles with no guard — a real DX win.
    expectTypeOf<TypedFetchError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<NetworkError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<AbortedError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<TimeoutError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<BaseHttpError["url"]>().toEqualTypeOf<string>();
    // Reading `.url` off the bare union — no narrowing — must type as string.
    const anyError = {} as TypedFetchError;
    expectTypeOf(anyError.url).toEqualTypeOf<string>();
  });

  test("isAbortError narrows to AbortedError", () => {
    const error: unknown = {};
    if (isAbortError(error)) {
      expectTypeOf(error).toExtend<AbortedError>();
    }
  });

  test("isTimeoutError narrows to TimeoutError", () => {
    const error: unknown = {};
    if (isTimeoutError(error)) {
      expectTypeOf(error).toExtend<TimeoutError>();
    }
  });

  // NOTE: the per-class status/statusText literal coverage that used to
  // live here (3/40 classes) has moved to, and been extended to all 40
  // classes by, the "roster sync" describe block above.

  test("json<T>() returns Promise<T>", () => {
    const error = new NotFoundError(new Response(JSON.stringify({}), { status: 404 }));
    expectTypeOf(error.json<{ message: string }>()).toEqualTypeOf<Promise<{ message: string }>>();
  });
});

// P3-03: freeze the public API surface. This machinery owns TWO axes of
// "the public surface changed", each with its own snapshot pair:
//
//   Axis A — the VALUE surface (the block just below): the set of runtime
//   named exports, read via `Object.keys(await import("dist/index.mjs"))`.
//   Object.keys() sees only bindings that exist at runtime.
//
//   Axis B — the TYPE surface (the block after that): the set of type-only
//   exports, read via the TypeScript compiler API against the built
//   `.d.mts`. Type-only exports (`export type { … }`, re-exported interfaces
//   and type aliases) NEVER exist at runtime, so `Object.keys()` is
//   STRUCTURALLY BLIND to them — deleting `export type { HttpMethods }` from
//   the barrel left all runtime tests, check-consumer, check-docs and
//   verify-pack green. Axis B closes that hole.
//
// Both snapshot the exact set of names from the BUILT package so an accidental
// addition/removal is a red test (and a reviewable snapshot diff), not a
// silent minor/major. To change the surface on purpose, update the code and
// re-run with `-u` (see CONTRIBUTING.md → "Updating the public-surface
// snapshots").
//
// A separate roster → barrel invariant in the value-surface suite derives the
// dedicated class names/statuses from `httpErrors` and requires both built
// entry points to expose exactly that roster. Snapshots alone cannot catch a
// future class registered internally but accidentally omitted from a barrel,
// because the unchanged export list would still match the old snapshot.
//
// dist/-ordering: this reads from `dist/`, which only exists after
// `pnpm build`. `dist/` is gitignored, so on a fresh local checkout it is
// absent until you build. In CI it is present: .github/workflows/ci.yml runs
// `pnpm build` BEFORE `pnpm test` in the same job, so these suites run for
// real there. The two cases are therefore handled differently below: locally,
// a missing dist/ skips gracefully (with an explicit console message, so it's
// visible rather than silently vanishing); in CI, a missing dist/ is a hard
// error, because it would mean the workflow lost the `build`-before-`test`
// ordering and the surface would silently stop being checked. Present dist/
// runs for real everywhere — e.g. the documented verification flow
// `pnpm build && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.
const distExists = existsSync(new URL("./dist/index.mjs", import.meta.url));

if (!distExists) {
  if (process.env.CI) {
    throw new Error(
      "[api-surface] dist/ not found in CI — .github/workflows/ci.yml must run " +
        "`pnpm build` before `pnpm test` so the dist-gated suites run for real.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "\n[api-surface] dist/ not found — skipping the public API surface snapshot tests. " +
      "Run `pnpm build` first (e.g. `pnpm build && pnpm test`) to exercise them.\n",
  );
}

// The specifier is built at runtime so `tsc` does not try to resolve dist/,
// which does not exist until `pnpm build` has run.
const importDist = (path: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ new URL(path, import.meta.url).href);

describe.skipIf(!distExists)("public API surface is frozen", () => {
  test("main entry named exports", async () => {
    const mod = await importDist("./dist/index.mjs");
    // Object.keys() returns a fresh array each call, so sorting it in place
    // (oxlint's unicorn/no-array-sort warning, not an error) is harmless.
    expect(Object.keys(mod).toSorted()).toMatchSnapshot();
  });

  test("./errors subpath named exports", async () => {
    const mod = await importDist("./dist/errors/index.mjs");
    // Same as above: sorting the fresh Object.keys() array in place is fine.
    expect(Object.keys(mod).toSorted()).toMatchSnapshot();
  });

  test.each([
    ["main entry", "./dist/index.mjs"],
    ["./errors subpath", "./dist/errors/index.mjs"],
  ])("%s exports every dedicated class in the internal roster", async (_entry, path) => {
    const mod = await importDist(path);

    for (const ErrorClass of httpErrors) {
      expect(Object.hasOwn(mod, ErrorClass.name)).toBe(true);
      const exported = mod[ErrorClass.name] as { readonly status?: unknown };
      expect(exported.status).toBe(ErrorClass.status);
    }
  });
});

// Axis B — freeze the TYPE-ONLY surface (see the header comment above for why
// the value snapshot cannot). `Object.keys()` of the runtime module is blind
// to `export type { … }` and re-exported interfaces/type aliases, so this
// block reads the shipped `.d.mts` with the TypeScript compiler API — the
// honest tool. `getExportsOfModule` returns EVERY exported symbol; we keep the
// ones that carry a type meaning but NO value meaning (following aliases to
// their target), i.e. the names that ship purely as types. That set is
// snapshotted per entry point, so:
//   • removing a type export (e.g. `HttpMethods`)     → snapshot diff → RED
//   • adding an unreviewed type export                 → snapshot diff → RED
//   • re-adding a deliberately-cut type (TypedHeaders) → snapshot diff → RED
// It runs against `dist/*.d.mts` (the artifact that ships), never `src/` —
// this whole class of bug came from a guard that read `src/` instead of dist/.
function typeOnlyExportsOf(dtsRelPath: string): string[] {
  const abs = fileURLToPath(new URL(dtsRelPath, import.meta.url));
  const program = ts.createProgram([abs], {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(abs);
  if (!source) throw new Error(`could not load ${abs} into the TS program`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`no module symbol for ${abs}`);

  const F = ts.SymbolFlags;
  const TYPE_MEANING = F.Type | F.Interface | F.TypeAlias | F.Class | F.Enum;

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((sym) => {
      // Follow re-export aliases to the symbol they actually point at, so a
      // barrel `export type { ClientErrors } from "./helpers"` is classified
      // by the target's meaning, not the alias's.
      const flags = sym.flags & F.Alias ? checker.getAliasedSymbol(sym).flags : sym.flags;
      const hasValue = (flags & F.Value) !== 0;
      const hasType = (flags & TYPE_MEANING) !== 0;
      // A CLASS carries both a value and a type meaning; it ships as a runtime
      // binding and is already frozen by the value snapshot. Keep only names
      // with a type meaning and NO value meaning — the ones invisible at
      // runtime and therefore only guardable here.
      return hasType && !hasValue ? sym.getName() : null;
    })
    .filter((name): name is string => name !== null)
    .toSorted();
}

describe.skipIf(!distExists)("public TYPE surface is frozen", () => {
  test("main entry type-only exports", () => {
    expect(typeOnlyExportsOf("./dist/index.d.mts")).toMatchSnapshot();
  });

  test("./errors subpath type-only exports", () => {
    expect(typeOnlyExportsOf("./dist/errors/index.d.mts")).toMatchSnapshot();
  });
});

// ── Cross-copy / cross-format guards against the BUILT artifacts ─────
//
// The whole reason branding exists: exercise the guards against errors created
// by a DIFFERENT copy of the classes than the one that owns the guard. The
// src/ tests above cannot catch a regression to `instanceof` because every
// import there resolves to the same module object. These tests import the two
// ESM entry points (`.` and `./errors`) and the two CJS entry points via
// createRequire, then cross the wires. On a clean checkout dist/ is absent and
// this block skips (see distExists rationale above).
describe.skipIf(!distExists)("guards work across module copies (dist)", () => {
  const require = createRequire(import.meta.url);

  test("axis 1 — ESM cross-entry: typedFetch from `.`, NotFoundError from `./errors`", async () => {
    const main = (await importDist("./dist/index.mjs")) as {
      typedFetch: typeof typedFetch;
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const errors = (await importDist("./dist/errors/index.mjs")) as {
      NotFoundError: typeof NotFoundError;
    };
    const { error } = await main.typedFetch("http://x/y", {
      fetch: async () => responseWithStatus(404),
    });
    expect(main.isHttpError(error)).toBe(true);
    expect(main.isKnownHttpError(error)).toBe(true);
    // With code-splitting the two entries share a chunk, so raw instanceof
    // holds too within a single ESM graph.
    expect(error instanceof errors.NotFoundError).toBe(true);
  });

  test("axis 2 — CJS cross-entry: typedFetch and NotFoundError via require()", async () => {
    const main = require("./dist/index.js") as {
      typedFetch: typeof typedFetch;
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const errors = require("./dist/errors/index.js") as {
      NotFoundError: typeof NotFoundError;
    };
    const { error } = await main.typedFetch("http://x/y", {
      fetch: async () => responseWithStatus(404),
    });
    expect(main.isHttpError(error)).toBe(true);
    expect(main.isKnownHttpError(error)).toBe(true);
    expect(error instanceof errors.NotFoundError).toBe(true);
  });

  test("axis 3 — cross-format: CJS isHttpError on an ESM-created HTTP error", async () => {
    const esm = (await importDist("./dist/index.mjs")) as { typedFetch: typeof typedFetch };
    const cjs = require("./dist/index.js") as {
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const { error } = await esm.typedFetch("http://x/y", {
      fetch: async () => responseWithStatus(404),
    });
    expect(cjs.isHttpError(error)).toBe(true); // was false before the brand
    expect(cjs.isKnownHttpError(error)).toBe(true);
  });

  test("axis 4 — cross-format reverse: ESM isNetworkError on a CJS-built NetworkError", async () => {
    const cjsErrors = require("./dist/errors/index.js") as {
      NetworkError: typeof NetworkError;
    };
    const esm = (await importDist("./dist/index.mjs")) as {
      isNetworkError: typeof isNetworkError;
      isHttpError: typeof isHttpError;
    };
    const err = new cjsErrors.NetworkError("boom");
    expect(esm.isNetworkError(err)).toBe(true);
    expect(esm.isHttpError(err)).toBe(false);
  });

  test("axis 5/6 — full exclusivity matrix (instances CJS, guards ESM)", async () => {
    const cjs = require("./dist/errors/index.js") as {
      NotFoundError: typeof NotFoundError;
      InternalServerError: typeof InternalServerError;
      UnknownHttpError: typeof UnknownHttpError;
      NetworkError: typeof NetworkError;
      AbortedError: typeof AbortedError;
      TimeoutError: typeof TimeoutError;
    };
    const g = (await importDist("./dist/index.mjs")) as {
      isHttpError: typeof isHttpError;
      isKnownHttpError: typeof isKnownHttpError;
      isNetworkError: typeof isNetworkError;
      isAbortError: typeof isAbortError;
      isTimeoutError: typeof isTimeoutError;
    };
    const row = (v: unknown) => [
      g.isHttpError(v),
      g.isKnownHttpError(v),
      g.isNetworkError(v),
      g.isAbortError(v),
      g.isTimeoutError(v),
    ];
    expect(row(new cjs.NotFoundError(responseWithStatus(404)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(row(new cjs.InternalServerError(responseWithStatus(500)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    // axis 6: UnknownHttpError is http but NOT known, across copies.
    expect(row(new cjs.UnknownHttpError(responseWithStatus(499)))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(row(new cjs.NetworkError("x"))).toEqual([false, false, true, false, false]);
    expect(row(new cjs.AbortedError("x"))).toEqual([false, false, false, true, false]);
    expect(row(new cjs.TimeoutError("x"))).toEqual([false, false, false, false, true]);
  });

  test("axis 8 — clone() returns the right subclass across copies; switch narrows", async () => {
    const main = (await importDist("./dist/index.mjs")) as {
      typedFetch: typeof typedFetch;
      isKnownHttpError: typeof isKnownHttpError;
    };
    const errors = (await importDist("./dist/errors/index.mjs")) as {
      NotFoundError: typeof NotFoundError;
    };
    const { error } = await main.typedFetch("http://x/y", {
      fetch: async () => new Response(JSON.stringify({ a: 1 }), { status: 404 }),
    });
    const cloned = (error as NotFoundError).clone();
    expect(cloned instanceof errors.NotFoundError).toBe(true);
    expect(cloned.status).toBe(404);
    expect(await cloned.json()).toEqual({ a: 1 });
    let label = "other";
    if (main.isKnownHttpError(error)) {
      switch (error.status) {
        case 404:
          label = "nf";
          break;
      }
    }
    expect(label).toBe("nf");
  });
});
