import { describe, test, expect, expectTypeOf } from "vitest";
import { useTestServer } from "./fixtures/http-server";
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isKnownHttpError,
  isAbortError,
  isTimeoutError,
} from "./src/index";
import {
  AbortedError,
  BaseHttpError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";
import type { ClientErrors, ServerErrors, TypedFetchError } from "./src/errors";
import type { StrictHeaders } from "./src/headers";
import type { HttpMethods } from "./src/methods";
import type { TypedFetchOptions, TypedFetchReturnType, TypedResponse } from "./index";

const { url } = useTestServer();

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
  // classes by, the "roster sync" describe block in roster-sync.spec.ts.

  test("json<T>() returns Promise<T>", () => {
    const error = new NotFoundError(new Response(JSON.stringify({}), { status: 404 }));
    expectTypeOf(error.json<{ message: string }>()).toEqualTypeOf<Promise<{ message: string }>>();
  });
});
