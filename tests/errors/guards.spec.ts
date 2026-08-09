import { describe, test, expect, expectTypeOf } from "vitest";
import {
  isHttpError,
  isNetworkError,
  isKnownHttpError,
  isAbortError,
  isTimeoutError,
  typedFetch,
} from "../../src/index";
import { hasBrand } from "../../src/errors/brand";
import {
  AbortedError,
  BadGatewayError,
  BadRequestError,
  BaseHttpError,
  InternalServerError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "../../src/errors";
import type { ClientErrors, ServerErrors } from "../../src/errors";

function foreignError(...brands: symbol[]): Error {
  const error = new Error("foreign copy");
  for (const brand of brands) Object.defineProperty(error, brand, { value: true });
  return error;
}

function foreignHttpError(status: number, ...brands: symbol[]): Error {
  const error = foreignError(...brands);
  Object.defineProperty(error, "status", { value: status });
  return error;
}

function responseReportingStatus(status: unknown): Response {
  const response = new Response(null);
  Object.defineProperty(response, "status", { get: () => status });
  return response;
}

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

  test("false for a consumer-defined BaseHttpError subclass", () => {
    class CustomHttpError extends BaseHttpError {
      override readonly name = "CustomHttpError" as const;
      readonly status = 599 as const;
      readonly statusText = "Custom Error" as const;
    }

    const error = new CustomHttpError(new Response(null, { status: 599 }));

    expect(isHttpError(error)).toBe(true);
    expect(isKnownHttpError(error)).toBe(false);
  });

  test("false for UnknownHttpError, NetworkError, plain Error, and non-errors", () => {
    // Status 404, not an unmapped one. Every negative case here used a status
    // OUTSIDE the roster, so a guard that consulted only `statusCodeErrorMap`
    // answered `false` for the same reason the real one does — and the brand
    // check it is supposed to pin could be deleted with the suite still green.
    // A 404 separates them: the status is in the roster, the brand is not on
    // this object, and only the brand check can tell.
    expect(isKnownHttpError(new UnknownHttpError(new Response(null, { status: 404 })))).toBe(false);
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
  const knownHttpBrand = Symbol.for("@pbpeterson/typed-fetch.KnownHttpError");
  const unknownBrand = Symbol.for("@pbpeterson/typed-fetch.UnknownHttpError");
  const networkBrand = Symbol.for("@pbpeterson/typed-fetch.NetworkError");
  const abortBrand = Symbol.for("@pbpeterson/typed-fetch.AbortedError");
  const timeoutBrand = Symbol.for("@pbpeterson/typed-fetch.TimeoutError");

  test("isHttpError matches a foreign-copy HTTP error (no instanceof link)", () => {
    const e = foreignError(httpBrand);
    expect(e instanceof BaseHttpError).toBe(false); // proves it is NOT the same copy
    expect(isHttpError(e)).toBe(true);
  });

  test("isKnownHttpError matches a foreign known error but not a foreign UnknownHttpError", () => {
    expect(isKnownHttpError(foreignHttpError(404, httpBrand, knownHttpBrand))).toBe(true);
    expect(isKnownHttpError(foreignHttpError(499, httpBrand))).toBe(false);
    expect(isKnownHttpError(foreignHttpError(499, httpBrand, unknownBrand))).toBe(false);
  });

  test("isKnownHttpError rejects a dedicated status unknown to this package version", () => {
    expect(isKnownHttpError(foreignHttpError(599, httpBrand, knownHttpBrand))).toBe(false);
  });

  test("isNetworkError / isAbortError / isTimeoutError match their foreign copies", () => {
    expect(isNetworkError(foreignError(networkBrand))).toBe(true);
    expect(isAbortError(foreignError(abortBrand))).toBe(true);
    expect(isTimeoutError(foreignError(timeoutBrand))).toBe(true);
  });

  test("guard exclusivity holds across foreign copies (no cross-family overlap)", () => {
    const samples = {
      http: foreignHttpError(404, httpBrand, knownHttpBrand),
      unknown: foreignHttpError(499, httpBrand, unknownBrand),
      network: foreignError(networkBrand),
      abort: foreignError(abortBrand),
      timeout: foreignError(timeoutBrand),
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

  // The assertions above are all structurally insensitive: Object.keys never
  // returns symbols, a spread copies own properties while the brand sits on the
  // prototype, and hasOwnProperty is false by construction. They pass whatever
  // descriptor `brand()` writes. Assert the descriptor itself — `writable` and
  // `configurable` are the security-relevant bits, because a writable brand
  // could be stripped from a real error or stamped onto a foreign one.
  test("brand descriptors are frozen on the prototype", () => {
    const cases: Array<[object, symbol]> = [
      [BaseHttpError.prototype, httpBrand],
      [NetworkError.prototype, networkBrand],
      [AbortedError.prototype, abortBrand],
      [TimeoutError.prototype, timeoutBrand],
      [UnknownHttpError.prototype, unknownBrand],
    ];
    for (const [prototype, brandSymbol] of cases) {
      expect(Object.getOwnPropertyDescriptor(prototype, brandSymbol)).toEqual({
        value: true,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
  });

  test("UnknownHttpError carries its own brand on a real instance", () => {
    // No library guard reads this brand, so only a direct assertion keeps the
    // documented cross-copy contract honest.
    const error = new UnknownHttpError(new Response(null, { status: 499 }));
    expect(hasBrand(error, unknownBrand)).toBe(true);
    expect(hasBrand(error, knownHttpBrand)).toBe(false);
  });

  test("hasBrand requires the literal value true, not merely a truthy one", () => {
    expect(hasBrand({ [httpBrand]: 1 }, httpBrand)).toBe(false);
    expect(hasBrand({ [httpBrand]: "yes" }, httpBrand)).toBe(false);
    expect(hasBrand({ [httpBrand]: true }, httpBrand)).toBe(true);
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

describe("the guards accept a status a custom Fetch reported as a string", () => {
  test("GD-01: a string status is a known HTTP error with a numeric status", async () => {
    // Before the status was normalized, `{ status: "404" }` missed
    // `statusCodeErrorMap` (which is keyed by numbers), reached the consumer as
    // an `UnknownHttpError` carrying the STRING "404", and `isKnownHttpError`
    // returned false for what is plainly a 404 — because it requires
    // `typeof status === "number"`.
    const response = responseReportingStatus("404");
    const { error } = await typedFetch("https://example.invalid/string-status", {
      fetch: (async () => response) as typeof fetch,
    });

    expect(isKnownHttpError(error)).toBe(true);

    let reached = "none";
    if (isKnownHttpError(error)) {
      switch (error.status) {
        case 404:
          reached = "404";
          break;
        default:
          reached = "default";
          break;
      }
    }
    expect(reached).toBe("404");
  });

  test("GD-02: a numeric status the map does not hold stays unknown", async () => {
    // The status is NOT truncated and NOT range-checked, so 404.7 does not
    // become a 404 and Infinity does not become a 599. Both miss the map and
    // land where an unmapped status belongs.
    for (const status of [404.7, Infinity]) {
      const response = responseReportingStatus(status);
      const { error } = await typedFetch("https://example.invalid/unmapped-number", {
        fetch: (async () => response) as typeof fetch,
      });

      expect(error).toBeInstanceOf(UnknownHttpError);
      expect(isHttpError(error)).toBe(true);
      expect(isKnownHttpError(error)).toBe(false);
    }
  });
});
