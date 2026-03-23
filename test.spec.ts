import http from "node:http";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  expectTypeOf,
} from "vitest";
import { typedFetch, isHttpError, isNetworkError } from "./src/index";
import { statusCodeErrorMap } from "./src/http-status-codes";
import { httpErrors } from "./src/errors/helpers";
import {
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
  TooEarlyError,
  TooManyRequestsError,
  UnauthorizedError,
  UnavailableForLegalReasonsError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  UpgradeRequiredError,
  VariantAlsoNegotiatesError,
} from "./src/errors";
import type { ClientErrors, ServerErrors } from "./src/errors";
import type { StrictHeaders } from "./src/headers";
import type { HttpMethods } from "./src/methods";

// ── Test HTTP server ─────────────────────────────────────────────────
// Spins up a real server on a random port. Query params control the response:
//   ?status=404          → respond with that status code
//   ?body={"err":"..."}  → respond with that body (sets Content-Type: application/json)
//   ?header=Key:Value    → set a response header (repeatable)

let baseURL: string;
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const status = Number(url.searchParams.get("status") ?? 200);
    const body = url.searchParams.get("body");
    const headerEntries = url.searchParams.getAll("header");

    for (const entry of headerEntries) {
      const [key, value] = entry.split(":");
      res.setHeader(key.trim(), value.trim());
    }

    if (!res.getHeader("content-type") && body) {
      res.setHeader("Content-Type", "application/json");
    }

    res.writeHead(status);
    res.end(body ?? null);
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
    const result = await typedFetch<{ users: { id: number }[] }>(
      url({ status: 200, body }),
    );

    const data = await result.response?.json();
    expect(data?.users).toHaveLength(2);
    expect(data?.users[0].id).toBe(1);
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

  test.each(errorCases)(
    "$status → $Class.name",
    async ({ status, Class }) => {
      const result = await typedFetch(url({ status }));

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(Class);

      if (isHttpError(result.error)) {
        expect(result.error.status).toBe(status);
      }
    },
  );

  test("407 → ProxyAuthenticationRequiredError (constructed directly, Node rejects 407 at network level)", async () => {
    const error = new ProxyAuthenticationRequiredError(
      new Response(null, { status: 407 }),
    );

    expect(error.status).toBe(407);
    expect(error).toBeInstanceOf(BaseHttpError);
    expect(isHttpError(error)).toBe(true);
  });

  test("unmapped status codes pass through as a successful response", async () => {
    const result = await typedFetch(url({ status: 299 }));

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);
  });

  test("connection refused → NetworkError", async () => {
    const result = await typedFetch("http://localhost:1");

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
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
    const result = await typedFetch(
      url({ status: 429, header: "Retry-After:60" }),
    );

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

// ── Error class invariants ───────────────────────────────────────────

describe("error class consistency", () => {
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
  ];

  test.each(allErrors)(
    "$Class.name ($status): static and instance properties match",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));

      expect(Class.status).toBe(status);
      expect(instance.status).toBe(Class.status);
      expect(instance.statusText).toBe(Class.statusText);
    },
  );

  test.each(allErrors)(
    "$Class.name extends BaseHttpError and Error",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));

      expect(instance).toBeInstanceOf(BaseHttpError);
      expect(instance).toBeInstanceOf(Error);
    },
  );

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

  test.each(allErrors)(
    "$Class.name.name equals the class name",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));
      expect(instance.name).toBe(Class.name);
    },
  );

  test("NetworkError.name equals 'NetworkError'", () => {
    expect(new NetworkError("fail").name).toBe("NetworkError");
  });
});

// ── json<T>() generic ────────────────────────────────────────────────

describe("json<T>()", () => {
  test("returns typed json from error body", async () => {
    const body = { message: "not found", code: "NOT_FOUND" };
    const error = new NotFoundError(
      new Response(JSON.stringify(body), { status: 404 }),
    );

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
    expectTypeOf<"CONNECT">().toExtend<HttpMethods>();
    expectTypeOf<"TRACE">().toExtend<HttpMethods>();
  });

  test("HttpMethods rejects invalid strings", () => {
    expectTypeOf<"INVALID">().not.toExtend<HttpMethods>();
    expectTypeOf<"get">().not.toExtend<HttpMethods>();
    expectTypeOf<string>().not.toExtend<HttpMethods>();
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
      expectTypeOf(result.error).toExtend<ClientErrors | ServerErrors | NetworkError>();
    }
  });

  test("second generic narrows the error type", async () => {
    const result = await typedFetch<{ id: number }, NotFoundError>(
      url({ status: 200, body: JSON.stringify({ id: 1 }) }),
    );

    if (result.error !== null) {
      expectTypeOf(result.error).toExtend<NotFoundError | ServerErrors | NetworkError>();
    }
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

  test("error.status is a literal number type", () => {
    expectTypeOf<NotFoundError["status"]>().toEqualTypeOf<404>();
    expectTypeOf<BadRequestError["status"]>().toEqualTypeOf<400>();
    expectTypeOf<InternalServerError["status"]>().toEqualTypeOf<500>();
  });

  test("error.statusText is a literal string type", () => {
    expectTypeOf<NotFoundError["statusText"]>().toEqualTypeOf<"Not Found">();
    expectTypeOf<BadRequestError["statusText"]>().toEqualTypeOf<"Bad Request">();
    expectTypeOf<InternalServerError["statusText"]>().toEqualTypeOf<"Internal Server Error">();
  });

  test("json<T>() returns Promise<T>", () => {
    const error = new NotFoundError(
      new Response(JSON.stringify({}), { status: 404 }),
    );
    expectTypeOf(error.json<{ message: string }>()).toEqualTypeOf<
      Promise<{ message: string }>
    >();
  });
});
