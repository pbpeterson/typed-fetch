import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, test, expect, beforeAll, afterAll, expectTypeOf, vi } from "vitest";
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
import type { StrictHeaders, TypedHeaders } from "./src/headers";
import type { HttpMethods } from "./src/methods";
import type { TypedFetchOptions, TypedFetchReturnType, TypedResponse } from "./index";

// ── Test HTTP server ─────────────────────────────────────────────────
// Spins up a real server on a random port. Query params control the response:
//   ?status=404          → respond with that status code
//   ?body={"err":"..."}  → respond with that body (sets Content-Type: application/json)
//   ?header=Key:Value    → set a response header (repeatable)
// The server also always echoes the received request method back via an
// X-Echo-Method response header, so tests can assert an arbitrary method
// (e.g. "REPORT") actually reached the server unchanged.
//   ?echoHeader=Name     → echo request header `Name` back as X-Echo-Header
//                           (proves an arbitrary request header reached the server)
//   ?delay=<ms>          → wait this many milliseconds before responding
//                           (used to reliably trigger AbortSignal.timeout())
// The received request body is always echoed back via an X-Echo-Body
// response header, so tests can assert the body actually reached the server.

let baseURL: string;
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url!, `http://${req.headers.host}`);
    const status = Number(requestUrl.searchParams.get("status") ?? 200);
    const body = requestUrl.searchParams.get("body");
    const headerEntries = requestUrl.searchParams.getAll("header");
    const delay = Number(requestUrl.searchParams.get("delay") ?? 0);
    const echoHeader = requestUrl.searchParams.get("echoHeader");

    for (const entry of headerEntries) {
      const [key = "", value = ""] = entry.split(":");
      res.setHeader(key.trim(), value.trim());
    }

    res.setHeader("X-Echo-Method", req.method ?? "");

    if (echoHeader) {
      const received = req.headers[echoHeader.toLowerCase()];
      res.setHeader("X-Echo-Header", typeof received === "string" ? received : "");
    }

    if (!res.getHeader("content-type") && body) {
      res.setHeader("Content-Type", "application/json");
    }

    // Buffer the request body so tests can assert it reached the server. The
    // body is echoed back via a response header (URL-encoded to stay a valid
    // header value regardless of the payload's bytes).
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const received = Buffer.concat(chunks).toString("utf8");
      res.setHeader("X-Echo-Body", encodeURIComponent(received));

      const respond = () => {
        res.writeHead(status);
        res.end(body ?? null);
      };

      if (delay > 0) {
        setTimeout(respond, delay);
      } else {
        respond();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const address = server.address() as { port: number };
  baseURL = `http://localhost:${address.port}`;
});

afterAll(() => {
  server.close();
});

function url(params: Record<string, string | number> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  return `${baseURL}?${search}`;
}

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
    const [, init] = stubFetch.mock.calls[0] ?? [];
    expect(init).toBeDefined();
    expect(init && "fetch" in init).toBe(false);
    expect(init).toMatchObject({ method: "POST" });
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

  // False-positive guard: detection must NOT key on the rejected error's
  // `.name`. An injected fetch that throws something merely *named*
  // "AbortError", with NO AbortSignal anywhere, is a plain network failure —
  // it must classify as NetworkError, never AbortedError.
  test("error named 'AbortError' with no signal → NetworkError, not AbortedError", async () => {
    const fakeAbort = Object.assign(new Error("x"), { name: "AbortError" });
    const stubFetch = vi.fn(async () => Promise.reject(fakeAbort)) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/fake-abort", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);

    if (isNetworkError(result.error)) {
      expect(result.error.cause).toBe(fakeAbort);
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

  test("pre-aborted signal + unrelated TypeError rejection → NetworkError, not AbortedError", async () => {
    const controller = new AbortController();
    controller.abort();
    // fetch rejects with something OTHER than signal.reason (a TypeError, as if
    // thrown during Request construction). The signal is aborted, but this
    // rejection is not the abort, so it must NOT be classified as AbortedError.
    const unrelated = new TypeError("bad header name");
    const stubFetch = vi.fn(async () => Promise.reject(unrelated)) as unknown as typeof fetch;

    const result = await typedFetch(url({ status: 200 }), {
      signal: controller.signal,
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
    if (isNetworkError(result.error)) {
      expect(result.error.cause).toBe(unrelated);
    }
  });

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
    // signal governs the call. With an injected fetch rejecting a TypeError and
    // no governing signal, this is a plain NetworkError, never AbortedError.
    const request = new Request(url({ status: 200 }), { signal: controller.signal });
    const unrelated = new TypeError("kaboom");
    const stubFetch = vi.fn(async () => Promise.reject(unrelated)) as unknown as typeof fetch;

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

  // ── A1/A2: polyfilled signals whose `reason` is undefined ──────────────
  // Some non-spec / polyfilled AbortSignals report `aborted: true` but never
  // set `reason`. Arm 2 of the classifier handles them, but must only claim
  // the abort when the rejection IS a platform abort DOMException
  // (name "AbortError" or "TimeoutError") — not any DOMException.
  const reasonlessAbortedSignal = () =>
    ({ aborted: true, reason: undefined }) as unknown as AbortSignal;

  test("A1: reason-less aborted signal + unrelated DOMException → NetworkError, not AbortedError", async () => {
    const unrelated = new DOMException("denied", "SecurityError");
    const stubFetch = vi.fn(async () => Promise.reject(unrelated)) as unknown as typeof fetch;

    const result = await typedFetch(url({ status: 200 }), {
      signal: reasonlessAbortedSignal(),
      fetch: stubFetch,
    });

    expect(result.error).toBeInstanceOf(NetworkError);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
    if (isNetworkError(result.error)) {
      expect(result.error.cause).toBe(unrelated);
    }
  });

  test("A1: reason-less aborted signal + DOMException named 'AbortError' → AbortedError", async () => {
    const aborted = new DOMException("aborted", "AbortError");
    const stubFetch = vi.fn(async () => Promise.reject(aborted)) as unknown as typeof fetch;

    const result = await typedFetch(url({ status: 200 }), {
      signal: reasonlessAbortedSignal(),
      fetch: stubFetch,
    });

    expect(result.error).toBeInstanceOf(AbortedError);
    expect(isAbortError(result.error)).toBe(true);
    expect(isTimeoutError(result.error)).toBe(false);
  });

  test("A2: reason-less (polyfilled) timeout signal + DOMException named 'TimeoutError' → TimeoutError", async () => {
    const timedOut = new DOMException("timed out", "TimeoutError");
    const stubFetch = vi.fn(async () => Promise.reject(timedOut)) as unknown as typeof fetch;

    const result = await typedFetch(url({ status: 200 }), {
      signal: reasonlessAbortedSignal(),
      fetch: stubFetch,
    });

    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
    if (isTimeoutError(result.error)) {
      expect(result.error.cause).toBe(timedOut);
    }
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
      // "this is a 404" — assert on .status, not on "404" appearing in .message.
      expect(result.error.status).toBe(404);
      // "the request url is captured" — .url is the structural field for this
      // (localhost lives in the url); message text is not part of the contract.
      expect(result.error.url).toBe(new URL(requestUrl).toString());
      expect(result.error.url).toContain("localhost");
    }
  });

  test("BaseHttpError takes the no-url message branch when response.url is empty", () => {
    // A directly-constructed Response has `url === ""`, so BaseHttpError's
    // `response.url ? `${line} (${url})` : line` branch takes the no-url path.
    // The structural observable of that branch is `error.url === ""` (there is
    // no url to append). We assert on that and on the status fields, never on
    // the constructed message text (per RELEASING.md: message is not contract).
    const error = new NotFoundError(new Response(null, { status: 404, statusText: "Not Found" }));

    expect(error.url).toBe("");
    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
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

    if (isHttpError(result.error)) {
      const cloned = result.error.clone();

      expect(await result.error.json()).toEqual({ error: "bad request" });
      expect(await cloned.json()).toEqual({ error: "bad request" });
    }
  });

  // ── P1-07: enumerated coverage gaps ──────────────────────────────────

  test("network-error catch: non-Error rejection falls back to 'Network error'", async () => {
    const stubFetch = vi.fn(async () => Promise.reject("boom")) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/non-error-rejection", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    // The non-Error rejection path produces a NetworkError; `cause` is the
    // structural observable that carries the original (non-Error) rejection.
    expect(result.error).toBeInstanceOf(NetworkError);

    if (isNetworkError(result.error)) {
      expect(result.error.cause).toBe("boom");
    }
  });

  test("network-error catch: empty Error.message falls back to Error.name", async () => {
    // Deliberately NOT named "AbortError" or "TimeoutError" — those names are
    // now intercepted earlier in the catch block and classified as
    // AbortedError/TimeoutError (see the dedicated tests for that). This
    // test exercises the remaining NetworkError fallback branch.
    const dnsLike = new Error("");
    dnsLike.name = "ENOTFOUND";
    const stubFetch = vi.fn(async () => Promise.reject(dnsLike)) as unknown as typeof fetch;

    const result = await typedFetch("https://example.invalid/empty-message-rejection", {
      fetch: stubFetch,
    });

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);

    if (isNetworkError(result.error)) {
      // The fallback (`err.message || err.name`) picked up `.name` because the
      // Error's message was empty. `cause` is the structural observable: it is
      // the exact rejected Error, whose `.name` is what the fallback used.
      expect(result.error.cause).toBe(dnsLike);
      expect((result.error.cause as Error).name).toBe("ENOTFOUND");
    }
  });

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

// ── Type guards ──────────────────────────────────────────────────────

describe("isHttpError", () => {
  test("true for any BaseHttpError subclass", () => {
    expect(isHttpError(new NotFoundError(new Response(null, { status: 404 })))).toBe(true);
    expect(isHttpError(new BadRequestError(new Response(null, { status: 400 })))).toBe(true);
    expect(isHttpError(new InternalServerError(new Response(null, { status: 500 })))).toBe(true);
    expect(isHttpError(new BadGatewayError(new Response(null, { status: 502 })))).toBe(true);
  });

  test("false for NetworkError, plain Error, and non-errors", () => {
    expect(isHttpError(new NetworkError("fail"))).toBe(false);
    expect(isHttpError(new Error("something"))).toBe(false);
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(undefined)).toBe(false);
    expect(isHttpError("string")).toBe(false);
    expect(isHttpError(42)).toBe(false);
    expect(isHttpError({})).toBe(false);
  });
});

describe("isNetworkError", () => {
  test("true for NetworkError", () => {
    expect(isNetworkError(new NetworkError("fail"))).toBe(true);
  });

  test("false for HTTP errors, plain Error, and non-errors", () => {
    expect(isNetworkError(new NotFoundError(new Response(null, { status: 404 })))).toBe(false);
    expect(isNetworkError(new Error("something"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError("string")).toBe(false);
  });
});

describe("isAbortError", () => {
  test("true for AbortedError", () => {
    expect(isAbortError(new AbortedError("aborted"))).toBe(true);
  });

  test("false for TimeoutError, NetworkError, HTTP errors, plain Error, and non-errors", () => {
    expect(isAbortError(new TimeoutError("timed out"))).toBe(false);
    expect(isAbortError(new NetworkError("fail"))).toBe(false);
    expect(isAbortError(new NotFoundError(new Response(null, { status: 404 })))).toBe(false);
    expect(isAbortError(new Error("something"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("string")).toBe(false);
  });
});

describe("isTimeoutError", () => {
  test("true for TimeoutError", () => {
    expect(isTimeoutError(new TimeoutError("timed out"))).toBe(true);
  });

  test("false for AbortedError, NetworkError, HTTP errors, plain Error, and non-errors", () => {
    expect(isTimeoutError(new AbortedError("aborted"))).toBe(false);
    expect(isTimeoutError(new NetworkError("fail"))).toBe(false);
    expect(isTimeoutError(new NotFoundError(new Response(null, { status: 404 })))).toBe(false);
    expect(isTimeoutError(new Error("something"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("string")).toBe(false);
  });
});

describe("isKnownHttpError", () => {
  test("true for a dedicated HTTP error class instance", () => {
    expect(isKnownHttpError(new NotFoundError(new Response(null, { status: 404 })))).toBe(true);
  });

  test("false for UnknownHttpError, NetworkError, plain Error, and non-errors", () => {
    expect(isKnownHttpError(new UnknownHttpError(new Response(null, { status: 420 })))).toBe(false);
    expect(isKnownHttpError(new NetworkError("fail"))).toBe(false);
    expect(isKnownHttpError(new Error("something"))).toBe(false);
    expect(isKnownHttpError(null)).toBe(false);
    expect(isKnownHttpError(undefined)).toBe(false);
    expect(isKnownHttpError({})).toBe(false);
  });

  test("narrows error.status exhaustively to a single dedicated class (type test)", () => {
    const error = new NotFoundError(new Response(null, { status: 404 })) as
      | ClientErrors
      | ServerErrors
      | UnknownHttpError
      | NetworkError;
    if (isKnownHttpError(error)) {
      if (error.status === 404) {
        expectTypeOf(error).toEqualTypeOf<NotFoundError>();
      }
    }
  });
});

describe("cross-copy brands", () => {
  // The guards must key off a `Symbol.for`-brand, not `instanceof`, so they
  // survive multiple copies of the classes in one process. These tests forge a
  // "foreign copy" of each root error: a class carrying the SAME well-known
  // brand symbol but NO prototype link to this module's classes. If a guard
  // still used `instanceof`, every case below would fail.
  const httpBrand = Symbol.for("@pbpeterson/typed-fetch.BaseHttpError");
  const unknownBrand = Symbol.for("@pbpeterson/typed-fetch.UnknownHttpError");
  const networkBrand = Symbol.for("@pbpeterson/typed-fetch.NetworkError");
  const abortBrand = Symbol.for("@pbpeterson/typed-fetch.AbortedError");
  const timeoutBrand = Symbol.for("@pbpeterson/typed-fetch.TimeoutError");

  const foreign = (...brands: symbol[]): Error => {
    const e = new Error("foreign copy");
    for (const b of brands) Object.defineProperty(e, b, { value: true });
    return e;
  };

  test("isHttpError matches a foreign-copy HTTP error (no instanceof link)", () => {
    const e = foreign(httpBrand);
    expect(e instanceof BaseHttpError).toBe(false); // proves it is NOT the same copy
    expect(isHttpError(e)).toBe(true);
  });

  test("isKnownHttpError matches a foreign known error but not a foreign UnknownHttpError", () => {
    expect(isKnownHttpError(foreign(httpBrand))).toBe(true);
    expect(isKnownHttpError(foreign(httpBrand, unknownBrand))).toBe(false);
  });

  test("isNetworkError / isAbortError / isTimeoutError match their foreign copies", () => {
    expect(isNetworkError(foreign(networkBrand))).toBe(true);
    expect(isAbortError(foreign(abortBrand))).toBe(true);
    expect(isTimeoutError(foreign(timeoutBrand))).toBe(true);
  });

  test("guard exclusivity holds across foreign copies (no cross-family overlap)", () => {
    const samples = {
      http: foreign(httpBrand),
      unknown: foreign(httpBrand, unknownBrand),
      network: foreign(networkBrand),
      abort: foreign(abortBrand),
      timeout: foreign(timeoutBrand),
    };
    // Each row: [isHttpError, isKnownHttpError, isNetworkError, isAbortError, isTimeoutError]
    expect([
      isHttpError(samples.http),
      isKnownHttpError(samples.http),
      isNetworkError(samples.http),
      isAbortError(samples.http),
      isTimeoutError(samples.http),
    ]).toEqual([true, true, false, false, false]);
    expect([
      isHttpError(samples.unknown),
      isKnownHttpError(samples.unknown),
      isNetworkError(samples.unknown),
      isAbortError(samples.unknown),
      isTimeoutError(samples.unknown),
    ]).toEqual([true, false, false, false, false]);
    expect([
      isNetworkError(samples.network),
      isHttpError(samples.network),
      isAbortError(samples.network),
      isTimeoutError(samples.network),
    ]).toEqual([true, false, false, false]);
    expect([
      isAbortError(samples.abort),
      isHttpError(samples.abort),
      isNetworkError(samples.abort),
      isTimeoutError(samples.abort),
    ]).toEqual([true, false, false, false]);
    expect([
      isTimeoutError(samples.timeout),
      isHttpError(samples.timeout),
      isNetworkError(samples.timeout),
      isAbortError(samples.timeout),
    ]).toEqual([true, false, false, false]);
  });

  test("brands are non-enumerable (never leak into JSON / spread / keys)", () => {
    const e = new NotFoundError(new Response(null, { status: 404 }));
    expect(Object.keys(e)).not.toContain(httpBrand.toString());
    expect(Object.getOwnPropertySymbols({ ...e })).not.toContain(httpBrand);
    // The brand lives on the prototype, not the instance.
    expect(Object.prototype.hasOwnProperty.call(e, httpBrand)).toBe(false);
    expect((e as unknown as Record<symbol, unknown>)[httpBrand]).toBe(true);
  });

  test("guards reject values with no brand", () => {
    for (const v of [null, undefined, {}, new Error("x"), 42, "s"]) {
      expect(isHttpError(v)).toBe(false);
      expect(isNetworkError(v)).toBe(false);
      expect(isAbortError(v)).toBe(false);
      expect(isTimeoutError(v)).toBe(false);
      expect(isKnownHttpError(v)).toBe(false);
    }
  });
});

// ── B2: cause/reason presence is honest (`declare`, no phantom undefined) ──
describe("NetworkError / AbortedError / TimeoutError — cause & reason presence", () => {
  test("cause is absent (not present-undefined) when none is given", () => {
    for (const e of [new NetworkError("x"), new TimeoutError("x"), new AbortedError("x")]) {
      expect("cause" in e).toBe(false);
      expect(Object.keys(e)).not.toContain("cause");
    }
    // AbortedError.reason is equally absent when not supplied.
    const aborted = new AbortedError("x");
    expect("reason" in aborted).toBe(false);
    expect(Object.keys(aborted)).not.toContain("reason");
  });

  test("an explicitly supplied cause/reason is recorded (guard preserved)", () => {
    const net = new NetworkError("x", { cause: undefined });
    expect("cause" in net).toBe(true);
    expect(net.cause).toBeUndefined();

    const boom = new Error("boom");
    const aborted = new AbortedError("x", { cause: boom, reason: "stop" });
    expect(aborted.cause).toBe(boom);
    expect("reason" in aborted).toBe(true);
    expect(aborted.reason).toBe("stop");
  });
});

// ── Error class invariants ───────────────────────────────────────────

// Shared by "error class consistency" and "roster sync" — one row per
// concrete HTTP error class. This table is authored independently of the
// hand-written error classes and their registries in src/, so it acts as a
// second source of truth to diff the roster against.
const allErrors = [
  { Class: BadRequestError, status: 400 },
  { Class: UnauthorizedError, status: 401 },
  { Class: PaymentRequiredError, status: 402 },
  { Class: ForbiddenError, status: 403 },
  { Class: NotFoundError, status: 404 },
  { Class: MethodNotAllowedError, status: 405 },
  { Class: NotAcceptableError, status: 406 },
  { Class: ProxyAuthenticationRequiredError, status: 407 },
  { Class: RequestTimeoutError, status: 408 },
  { Class: ConflictError, status: 409 },
  { Class: GoneError, status: 410 },
  { Class: LengthRequiredError, status: 411 },
  { Class: PreconditionFailedError, status: 412 },
  { Class: RequestTooLongError, status: 413 },
  { Class: RequestUriTooLongError, status: 414 },
  { Class: UnsupportedMediaTypeError, status: 415 },
  { Class: RequestedRangeNotSatisfiableError, status: 416 },
  { Class: ExpectationFailedError, status: 417 },
  { Class: ImATeapotError, status: 418 },
  { Class: MisdirectedRequestError, status: 421 },
  { Class: UnprocessableEntityError, status: 422 },
  { Class: LockedError, status: 423 },
  { Class: FailedDependencyError, status: 424 },
  { Class: TooEarlyError, status: 425 },
  { Class: UpgradeRequiredError, status: 426 },
  { Class: PreconditionRequiredError, status: 428 },
  { Class: TooManyRequestsError, status: 429 },
  { Class: RequestHeaderFieldsTooLargeError, status: 431 },
  { Class: UnavailableForLegalReasonsError, status: 451 },
  { Class: InternalServerError, status: 500 },
  { Class: NotImplementedError, status: 501 },
  { Class: BadGatewayError, status: 502 },
  { Class: ServiceUnavailableError, status: 503 },
  { Class: GatewayTimeoutError, status: 504 },
  { Class: HttpVersionNotSupportedError, status: 505 },
  { Class: VariantAlsoNegotiatesError, status: 506 },
  { Class: InsufficientStorageError, status: 507 },
  { Class: LoopDetectedError, status: 508 },
  { Class: NotExtendedError, status: 510 },
  { Class: NetworkAuthenticationRequiredError, status: 511 },
] as const;

describe("error class consistency", () => {
  test.each(allErrors)(
    "$Class.name ($status): static and instance properties match",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));

      expect(Class.status).toBe(status);
      expect(instance.status).toBe(Class.status);
      expect(instance.statusText).toBe(Class.statusText);
    },
  );

  test.each(allErrors)("$Class.name extends BaseHttpError and Error", ({ Class, status }) => {
    const instance = new Class(new Response(null, { status }));

    expect(instance).toBeInstanceOf(BaseHttpError);
    expect(instance).toBeInstanceOf(Error);
  });

  test.each(allErrors)(
    "$Class.name.clone() returns a distinct instance of the same class",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));
      const cloned = instance.clone();

      expect(cloned).toBeInstanceOf(Class);
      expect(cloned).not.toBe(instance);
      expect(cloned.status).toBe(instance.status);
      expect(cloned.statusText).toBe(instance.statusText);
    },
  );

  test.each(allErrors)("$Class.name.name equals the class name", ({ Class, status }) => {
    const instance = new Class(new Response(null, { status }));
    expect(instance.name).toBe(Class.name);
  });

  test("NetworkError.name equals 'NetworkError'", () => {
    expect(new NetworkError("fail").name).toBe("NetworkError");
  });

  test("NetworkError preserves cause", () => {
    const original = new TypeError("fetch failed");
    const error = new NetworkError("fetch failed", { cause: original });
    expect(error.cause).toBe(original);
  });

  test("AbortedError.name equals 'AbortedError'", () => {
    expect(new AbortedError("aborted").name).toBe("AbortedError");
  });

  test("AbortedError preserves cause and reason and does not extend NetworkError", () => {
    const original = new DOMException("This operation was aborted", "AbortError");
    const reason = { code: "ROUTE_CHANGE" };
    const error = new AbortedError("aborted", { cause: original, reason });
    expect(error.cause).toBe(original);
    expect(error.reason).toBe(reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(BaseHttpError);
  });

  test("AbortedError.reason is undefined when no reason is supplied", () => {
    const error = new AbortedError("aborted");
    expect(error.reason).toBeUndefined();
  });

  test("TimeoutError.name equals 'TimeoutError'", () => {
    expect(new TimeoutError("timed out").name).toBe("TimeoutError");
  });

  test("TimeoutError preserves cause and does not extend NetworkError", () => {
    const original = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const error = new TimeoutError("timed out", { cause: original });
    expect(error.cause).toBe(original);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(BaseHttpError);
  });

  test("UnknownHttpError reflects the actual response status and clones", () => {
    const instance = new UnknownHttpError(
      new Response(null, { status: 599, statusText: "Custom" }),
    );

    expect(instance.status).toBe(599);
    expect(instance.statusText).toBe("Custom");
    expect(instance.name).toBe("UnknownHttpError");
    expect(instance).toBeInstanceOf(BaseHttpError);

    const cloned = instance.clone();
    expect(cloned).toBeInstanceOf(UnknownHttpError);
    expect(cloned).not.toBe(instance);
    expect(cloned.status).toBe(599);
  });
});

// ── json<T>() generic ────────────────────────────────────────────────

describe("json<T>()", () => {
  test("returns typed json from error body", async () => {
    const body = { message: "not found", code: "NOT_FOUND" };
    const error = new NotFoundError(new Response(JSON.stringify(body), { status: 404 }));

    const result = await error.json<{ message: string; code: string }>();
    expect(result).toEqual(body);
  });

  test("defaults to unknown when no type parameter is given", async () => {
    const error = new BadRequestError(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    );

    const result = await error.json();
    expectTypeOf(result).toEqualTypeOf<unknown>();
    expect(result).toEqual({ error: "bad" });
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
    expectTypeOf<RequestTooLongError["statusText"]>().toEqualTypeOf<"Payload Too Large">();
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
    expectTypeOf<UnprocessableEntityError["statusText"]>().toEqualTypeOf<"Unprocessable Entity">();
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

test("error .name is a hardcoded string literal, not this.constructor.name", () => {
  const src = readFileSync("src/errors/base-http-error.ts", "utf8");
  expect(src).not.toMatch(/this\.name\s*=\s*this\.constructor\.name/);
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
    expect(Object.keys(mod).sort()).toMatchSnapshot();
  });

  test("./errors subpath named exports", async () => {
    const mod = await importDist("./dist/errors/index.mjs");
    // Same as above: sorting the fresh Object.keys() array in place is fine.
    expect(Object.keys(mod).sort()).toMatchSnapshot();
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
    .sort();
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
  const mkResp = (status: number) => new Response(null, { status });

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
      fetch: async () => mkResp(404),
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
      fetch: async () => mkResp(404),
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
      fetch: async () => mkResp(404),
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
    expect(row(new cjs.NotFoundError(mkResp(404)))).toEqual([true, true, false, false, false]);
    expect(row(new cjs.InternalServerError(mkResp(500)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    // axis 6: UnknownHttpError is http but NOT known, across copies.
    expect(row(new cjs.UnknownHttpError(mkResp(499)))).toEqual([true, false, false, false, false]);
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
