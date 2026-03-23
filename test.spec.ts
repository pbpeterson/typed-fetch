import { describe, test, expect, vi, afterEach, expectTypeOf } from "vitest";
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

function createBlobURL(data: unknown): string {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  return URL.createObjectURL(blob);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("typedFetch", () => {
  test("should return data for successful response", async () => {
    const url = createBlobURL({ id: 1, name: "test" });

    const result = await typedFetch<{ id: number; name: string }>(url);

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);
    expect(result.response?.status).toBe(200);

    const data = await result.response?.json();
    expect(data).toEqual({ id: 1, name: "test" });
  });

  test("should return typed json from successful response", async () => {
    const url = createBlobURL({ users: [{ id: 1 }, { id: 2 }] });

    const result = await typedFetch<{ users: { id: number }[] }>(url);

    expect(result.error).toBe(null);

    const data = await result.response?.json();
    expect(data?.users).toHaveLength(2);
    expect(data?.users[0].id).toBe(1);
  });

  test("should work with optional RequestInit parameter", async () => {
    const url = createBlobURL({ ok: true });
    const spy = vi.spyOn(globalThis, "fetch");

    await typedFetch(url);

    expect(spy).toHaveBeenCalledWith(url, {});
  });

  test("should pass request options to fetch", async () => {
    const url = createBlobURL({ ok: true });
    const spy = vi.spyOn(globalThis, "fetch");

    await typedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(spy).toHaveBeenCalledWith(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });

  // Error status codes — need spyOn since blob URLs always return 200
  const errorCases = [
    { status: 400, Class: BadRequestError },
    { status: 401, Class: UnauthorizedError },
    { status: 402, Class: PaymentRequiredError },
    { status: 403, Class: ForbiddenError },
    { status: 404, Class: NotFoundError },
    { status: 405, Class: MethodNotAllowedError },
    { status: 406, Class: NotAcceptableError },
    { status: 407, Class: ProxyAuthenticationRequiredError },
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
    "should return $Class.name for status $status",
    async ({ status, Class }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status })
      );

      const result = await typedFetch("https://api.example.com");

      expect(result.response).toBe(null);
      expect(result.error).toBeInstanceOf(Class);

      if (isHttpError(result.error)) {
        expect(result.error.status).toBe(status);
      }
    }
  );

  test("should treat unmapped error status codes as success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 499 })
    );

    const result = await typedFetch("https://api.example.com");

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);
  });

  // Network errors
  test("should handle network errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    const result = await typedFetch("https://api.example.com");

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.message).toBe("Failed to fetch");
  });

  test("should handle unknown thrown values as NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("something went wrong");

    const result = await typedFetch("https://api.example.com");

    expect(result.response).toBe(null);
    expect(result.error).toBeInstanceOf(NetworkError);
    expect(result.error?.message).toBe("Unknown error");
  });
});

describe("error body parsing", () => {
  test("json() should parse the response body", async () => {
    const body = { message: "Validation failed", field: "email" };
    const response = new Response(JSON.stringify(body), { status: 400 });
    const error = new BadRequestError(response);

    const json = await error.json();
    expect(json).toEqual(body);
  });

  test("text() should return the response body as text", async () => {
    const response = new Response("Not Found", { status: 404 });
    const error = new NotFoundError(response);

    const text = await error.text();
    expect(text).toBe("Not Found");
  });

  test("blob() should return the response body as Blob", async () => {
    const response = new Response("data", { status: 500 });
    const error = new InternalServerError(response);

    const blob = await error.blob();
    expect(blob).toBeInstanceOf(Blob);
  });

  test("arrayBuffer() should return the response body as ArrayBuffer", async () => {
    const response = new Response("data", { status: 502 });
    const error = new BadGatewayError(response);

    const buffer = await error.arrayBuffer();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  test("headers should expose the response headers", async () => {
    const response = new Response(null, {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="api"' },
    });
    const error = new UnauthorizedError(response);

    expect(error.headers.get("WWW-Authenticate")).toBe('Bearer realm="api"');
  });
});

describe("isHttpError", () => {
  test("should return true for HTTP error instances", () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));
    expect(isHttpError(error)).toBe(true);
  });

  test("should return true for client errors", () => {
    const res = new Response(null, { status: 400 });
    expect(isHttpError(new BadRequestError(res))).toBe(true);
    expect(isHttpError(new ForbiddenError(res))).toBe(true);
    expect(isHttpError(new ConflictError(res))).toBe(true);
  });

  test("should return true for server errors", () => {
    const res = new Response(null, { status: 500 });
    expect(isHttpError(new InternalServerError(res))).toBe(true);
    expect(isHttpError(new BadGatewayError(res))).toBe(true);
    expect(isHttpError(new ServiceUnavailableError(res))).toBe(true);
  });

  test("should return false for NetworkError", () => {
    expect(isHttpError(new NetworkError("fail"))).toBe(false);
  });

  test("should return false for plain Error", () => {
    expect(isHttpError(new Error("something"))).toBe(false);
  });

  test("should return false for non-error values", () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(undefined)).toBe(false);
    expect(isHttpError("string")).toBe(false);
    expect(isHttpError(42)).toBe(false);
    expect(isHttpError({})).toBe(false);
  });
});

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
    "$Class.name static and instance status should match ($status)",
    ({ Class, status }) => {
      expect(Class.status).toBe(status);

      const instance = new Class(new Response(null, { status }));

      expect(instance.status).toBe(status);
      expect(instance.status).toBe(Class.status);
      expect(instance.statusText).toBe(Class.statusText);
    }
  );

  test.each(allErrors)(
    "$Class.name should extend BaseHttpError and Error",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));

      expect(instance).toBeInstanceOf(BaseHttpError);
      expect(instance).toBeInstanceOf(Error);
    }
  );

  test.each(allErrors)(
    "$Class.name clone() should return a new instance of the same class",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));
      const cloned = instance.clone();

      expect(cloned).toBeInstanceOf(Class);
      expect(cloned).not.toBe(instance);
      expect(cloned.status).toBe(instance.status);
      expect(cloned.statusText).toBe(instance.statusText);
    }
  );
});

describe("type-level tests", () => {
  test("HttpMethods accepts valid HTTP methods", () => {
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

  test("HttpMethods rejects invalid methods", () => {
    expectTypeOf<"INVALID">().not.toExtend<HttpMethods>();
    expectTypeOf<"get">().not.toExtend<HttpMethods>();
    expectTypeOf<string>().not.toExtend<HttpMethods>();
  });

  test("StrictHeaders accepts standard headers", () => {
    expectTypeOf<{ "Content-Type": "application/json" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ Authorization: "Bearer token" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ Accept: "application/json" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ "Cache-Control": "no-cache" }>().toExtend<StrictHeaders>();
  });

  test("StrictHeaders accepts custom headers via index signature", () => {
    expectTypeOf<{ "X-Custom-Header": "value" }>().toExtend<StrictHeaders>();
  });

  test("typedFetch return type is a discriminated union", async () => {
    const url = createBlobURL({ id: 1 });
    const result = await typedFetch<{ id: number }>(url);

    if (result.error === null) {
      expectTypeOf(result.response).not.toEqualTypeOf<null>();
      expectTypeOf(result.response.status).toBeNumber();
    } else {
      expectTypeOf(result.response).toEqualTypeOf<null>();
      expectTypeOf(result.error).toExtend<ClientErrors | ServerErrors | NetworkError>();
    }
  });

  test("typedFetch narrows error type with generic parameter", async () => {
    const url = createBlobURL({ id: 1 });
    const result = await typedFetch<{ id: number }, NotFoundError>(url);

    if (result.error !== null) {
      expectTypeOf(result.error).toExtend<NotFoundError | ServerErrors | NetworkError>();
    }
  });

  test("isHttpError narrows the type", () => {
    const error: unknown = {};
    if (isHttpError(error)) {
      expectTypeOf(error).toExtend<BaseHttpError>();
    }
  });

  test("NetworkError does not extend BaseHttpError", () => {
    expectTypeOf<NetworkError>().not.toExtend<BaseHttpError>();
  });

  test("isNetworkError narrows the type", () => {
    const error: unknown = {};
    if (isNetworkError(error)) {
      expectTypeOf(error).toExtend<NetworkError>();
    }
  });

  test("error status should be a literal type", () => {
    expectTypeOf<NotFoundError["status"]>().toEqualTypeOf<404>();
    expectTypeOf<BadRequestError["status"]>().toEqualTypeOf<400>();
    expectTypeOf<InternalServerError["status"]>().toEqualTypeOf<500>();
  });

  test("error statusText should be a literal type", () => {
    expectTypeOf<NotFoundError["statusText"]>().toEqualTypeOf<"Not Found">();
    expectTypeOf<BadRequestError["statusText"]>().toEqualTypeOf<"Bad Request">();
    expectTypeOf<InternalServerError["statusText"]>().toEqualTypeOf<"Internal Server Error">();
  });

  test("json() should accept a generic type parameter", () => {
    const error = new NotFoundError(new Response(JSON.stringify({}), { status: 404 }));
    expectTypeOf(error.json<{ message: string }>()).toEqualTypeOf<Promise<{ message: string }>>();
  });
});

describe("isNetworkError", () => {
  test("should return true for NetworkError instances", () => {
    expect(isNetworkError(new NetworkError("fail"))).toBe(true);
  });

  test("should return false for HTTP error instances", () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));
    expect(isNetworkError(error)).toBe(false);
  });

  test("should return false for plain Error", () => {
    expect(isNetworkError(new Error("something"))).toBe(false);
  });

  test("should return false for non-error values", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError("string")).toBe(false);
    expect(isNetworkError(42)).toBe(false);
  });
});

describe("error.name", () => {
  test("HTTP errors should have correct name", () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));
    expect(error.name).toBe("NotFoundError");
  });

  test("NetworkError should have correct name", () => {
    const error = new NetworkError("fail");
    expect(error.name).toBe("NetworkError");
  });

  test("all HTTP error classes should set name to class name", () => {
    const res = new Response(null, { status: 400 });
    expect(new BadRequestError(res).name).toBe("BadRequestError");
    expect(new InternalServerError(res).name).toBe("InternalServerError");
    expect(new BadGatewayError(res).name).toBe("BadGatewayError");
  });
});

describe("json() generic", () => {
  test("should return typed json from error response", async () => {
    const body = { message: "not found", code: "NOT_FOUND" };
    const error = new NotFoundError(
      new Response(JSON.stringify(body), { status: 404 })
    );

    const result = await error.json<{ message: string; code: string }>();
    expect(result).toEqual(body);
  });

  test("should default to unknown when no generic provided", async () => {
    const error = new BadRequestError(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 })
    );

    const result = await error.json();
    expectTypeOf(result).toEqualTypeOf<unknown>();
    expect(result).toEqual({ error: "bad" });
  });
});

describe("httpErrors and statusCodeErrorMap exports", () => {
  test("httpErrors should contain all 40 error classes", () => {
    expect(httpErrors).toHaveLength(40);
  });

  test("statusCodeErrorMap should contain all 40 status codes", () => {
    expect(statusCodeErrorMap.size).toBe(40);
  });

  test("statusCodeErrorMap should map status codes to correct classes", () => {
    expect(statusCodeErrorMap.get(404)).toBe(NotFoundError);
    expect(statusCodeErrorMap.get(500)).toBe(InternalServerError);
    expect(statusCodeErrorMap.get(400)).toBe(BadRequestError);
  });

  test("every httpErrors entry should be in statusCodeErrorMap", () => {
    for (const ErrorClass of httpErrors) {
      const mapped = statusCodeErrorMap.get(ErrorClass.status);
      expect(mapped).toBe(ErrorClass);
    }
  });
});
