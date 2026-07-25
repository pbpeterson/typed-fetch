import { readFileSync } from "node:fs";
import { describe, test, expect, expectTypeOf } from "vitest";
import {
  AbortedError,
  BadRequestError,
  BaseHttpError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";
import { isAbortError, isNetworkError, isTimeoutError } from "./src/index";
import { allErrors } from "./fixtures/error-roster";

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

  // A PARTIAL options object is the case an `if (options)` guard cannot tell
  // apart from a supplied cause. Constructing with no options at all exercises
  // neither branch of the `"cause" in options` test.
  test("a partial options object still leaves the absent members absent", () => {
    const net = new NetworkError("x", { url: "https://example.test/a" });
    expect("cause" in net).toBe(false);
    expect(net.url).toBe("https://example.test/a");

    const timedOut = new TimeoutError("x", { url: "https://example.test/b" });
    expect("cause" in timedOut).toBe(false);
    expect(timedOut.url).toBe("https://example.test/b");

    const causeOnly = new AbortedError("x", { cause: new Error("c") });
    expect("reason" in causeOnly).toBe(false);

    const reasonOnly = new AbortedError("x", { reason: "r" });
    expect("cause" in reasonOnly).toBe(false);
    expect(reasonOnly.reason).toBe("r");
  });

  // ── cause/reason are non-enumerable, as the platform defines them ──
  test("cause and reason carry the descriptor `new Error(m, { cause })` writes", () => {
    // The reference: the platform's own installation of `cause`.
    expect(Object.getOwnPropertyDescriptor(new Error("x", { cause: "c" }), "cause")).toEqual({
      value: "c",
      writable: true,
      enumerable: false,
      configurable: true,
    });

    const cases: Array<[Error, string]> = [
      [new NetworkError("x", { cause: "c" }), "cause"],
      [new TimeoutError("x", { cause: "c" }), "cause"],
      [new AbortedError("x", { cause: "c" }), "cause"],
      [new AbortedError("x", { reason: "c" }), "reason"],
    ];
    for (const [error, key] of cases) {
      expect(Object.getOwnPropertyDescriptor(error, key)).toEqual({
        value: "c",
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  });

  test("a cause never reaches JSON.stringify, a spread, or Object.keys", () => {
    // undici's cause chain carries socket detail — addresses and ports — and an
    // enumerable `cause` puts all of it into any structured log.
    const cause = new Error("socket", { cause: { localAddress: "10.0.0.1", localPort: 51234 } });
    const errors = [
      new NetworkError("fetch failed", { cause, url: "https://example.test/a" }),
      new TimeoutError("timed out", { cause }),
      new AbortedError("aborted", { cause, reason: { token: "secret-value" } }),
    ];

    for (const error of errors) {
      expect(Object.keys(error)).not.toContain("cause");
      expect(Object.keys(error)).not.toContain("reason");
      expect({ ...error }).not.toHaveProperty("cause");
      expect({ ...error }).not.toHaveProperty("reason");
      expect(JSON.stringify(error)).not.toContain("localAddress");
      expect(JSON.stringify(error)).not.toContain("secret-value");
    }
  });

  test("a non-enumerable cause is still readable and still writable", () => {
    const first = new Error("first");
    const error = new NetworkError("x", { cause: first });

    expect(error.cause).toBe(first);
    expect("cause" in error).toBe(true);

    const second = new Error("second");
    error.cause = second;
    expect(error.cause).toBe(second);
  });

  test("the brands and the guards are untouched by the descriptor change", () => {
    const net = new NetworkError("x", { cause: "c" });
    const aborted = new AbortedError("x", { cause: "c", reason: "r" });
    const timedOut = new TimeoutError("x", { cause: "c" });

    expect(net).toBeInstanceOf(NetworkError);
    expect(aborted).toBeInstanceOf(AbortedError);
    expect(timedOut).toBeInstanceOf(TimeoutError);
    expect([isNetworkError(net), isAbortError(aborted), isTimeoutError(timedOut)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  // ── toJSON ──
  test("toJSON records the message and the url, never the cause or the reason", () => {
    const cause = new TypeError("fetch failed");

    expect(
      new NetworkError("fetch failed", { cause, url: "https://example.test/a" }).toJSON(),
    ).toEqual({
      name: "NetworkError",
      message: "fetch failed",
      url: "https://example.test/a",
    });
    expect(new TimeoutError("timed out", { cause }).toJSON()).toEqual({
      name: "TimeoutError",
      message: "timed out",
      url: "",
    });
    expect(new AbortedError("aborted", { cause, reason: "stop" }).toJSON()).toEqual({
      name: "AbortedError",
      message: "aborted",
      url: "",
    });
  });

  test("a cyclic abort reason no longer makes JSON.stringify throw", () => {
    const reason: Record<string, unknown> = {};
    reason.self = reason;
    const aborted = new AbortedError("aborted", { reason });

    // An enumerable `reason` made every logger that serialized this error throw
    // `TypeError: Converting circular structure to JSON`.
    expect(() => JSON.stringify(aborted)).not.toThrow();
    expect(JSON.parse(JSON.stringify(aborted))).toEqual({
      name: "AbortedError",
      message: "aborted",
      url: "",
    });
  });

  test("url defaults to the empty string, including for an explicit undefined", () => {
    for (const e of [new NetworkError("x"), new AbortedError("x"), new TimeoutError("x")]) {
      expect(e.url).toBe("");
    }
    expect(new NetworkError("x", { url: undefined }).url).toBe("");
    expect(new AbortedError("x", { url: undefined }).url).toBe("");
    expect(new TimeoutError("x", { url: undefined }).url).toBe("");
  });
});

// ── Error class invariants ───────────────────────────────────────────

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

test("error .name is a hardcoded string literal, not this.constructor.name", () => {
  const src = readFileSync("src/errors/base-http-error.ts", "utf8");
  expect(src).not.toMatch(/this\.name\s*=\s*this\.constructor\.name/);
});

describe("message and url agree on what they disclose", () => {
  test("BaseHttpError: the message carries the redacted URL, the property the full href", () => {
    const response = new Response(null, { status: 404, statusText: "Not Found" });
    Object.defineProperty(response, "url", {
      value: "https://api.test/v1/things?access_token=SECRET",
    });
    const error = new NotFoundError(response);

    expect(error.message).toBe("HTTP 404 Not Found (https://api.test/v1/things)");
    expect(error.toJSON().url).toBe("https://api.test/v1/things");
    // The record's message and its url describe the same URL.
    expect(error.toJSON().message).toContain(error.toJSON().url);
    // The escape hatch is untouched.
    expect(error.url).toBe("https://api.test/v1/things?access_token=SECRET");
  });

  test("NetworkError: undici's credential message loses the password", () => {
    const url = "http://alice:hunter2@api.test/v1/things";
    const error = new NetworkError(
      `Request cannot be constructed from a URL that includes credentials: ${url}`,
      { url },
    );

    expect(error.message).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(error.url).toBe(url);
  });
});
