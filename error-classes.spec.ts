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
